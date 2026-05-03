#!/usr/bin/env node

/**
 * MemPalace MCP Server — TypeScript port
 *
 * Read/write palace access for Claude Code and Pixel City agents.
 * Replaces Python + ChromaDB with TypeScript + SQLite FTS5.
 *
 * Tools (read):
 *   mempalace_status, mempalace_list_wings, mempalace_list_rooms,
 *   mempalace_get_taxonomy, mempalace_get_aaak_spec, mempalace_search,
 *   mempalace_check_duplicate, mempalace_traverse, mempalace_find_tunnels,
 *   mempalace_graph_stats
 *
 * Tools (write):
 *   mempalace_add_drawer, mempalace_delete_drawer
 *
 * Knowledge graph:
 *   mempalace_kg_query, mempalace_kg_add, mempalace_kg_invalidate,
 *   mempalace_kg_timeline, mempalace_kg_stats
 *
 * Diary:
 *   mempalace_diary_write, mempalace_diary_read
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import crypto from 'crypto'
import path from 'path'

import { MempalaceConfig } from './src/config.js'
import { DrawerStore } from './src/storage.js'
import { KnowledgeGraph } from './src/knowledge-graph.js'
import { searchMemories } from './src/searcher.js'
import { traverse, findTunnels, graphStats } from './src/palace-graph.js'
import { Dialect } from './src/dialect.js'
import { registerRoomTools } from './src/room.js'
import { requirePermanentAgent } from './src/auth.js'

// ── Globals ──────────────────────────────────────────────────────────

const config = new MempalaceConfig()
let store: DrawerStore
let kg: KnowledgeGraph

try {
  store = new DrawerStore(config)
  kg = new KnowledgeGraph()
} catch (e: any) {
  console.error(`MemPalace init error: ${e.message}`)
  process.exit(1)
}

// ── Protocol & AAAK Spec ─────────────────────────────────────────────

const PALACE_PROTOCOL = `IMPORTANT — MemPalace Memory Protocol:
1. ON WAKE-UP: Call mempalace_status to load palace overview + AAAK spec.
2. BEFORE RESPONDING about any person, project, or past event: call mempalace_kg_query or mempalace_search FIRST. Never guess — verify.
3. IF UNSURE about a fact (name, gender, age, relationship): say "let me check" and query the palace. Wrong is worse than slow.
4. AFTER EACH SESSION: call mempalace_diary_write to record what happened, what you learned, what matters.
5. WHEN FACTS CHANGE: call mempalace_kg_invalidate on the old fact, mempalace_kg_add for the new one.

This protocol ensures the AI KNOWS before it speaks. Storage is not memory — but storage + this protocol = memory.`

const AAAK_SPEC = `AAAK is a compressed memory dialect that MemPalace uses for efficient storage.
It is designed to be readable by both humans and LLMs without decoding.

FORMAT:
  ENTITIES: 3-letter uppercase codes. ALC=Alice, JOR=Jordan, RIL=Riley, MAX=Max, BEN=Ben.
  EMOTIONS: *action markers* before/during text. *warm*=joy, *fierce*=determined, *raw*=vulnerable, *bloom*=tenderness.
  STRUCTURE: Pipe-separated fields. FAM: family | PROJ: projects | ⚠: warnings/reminders.
  DATES: ISO format (2026-03-31). COUNTS: Nx = N mentions (e.g., 570x).
  IMPORTANCE: ★ to ★★★★★ (1-5 scale).
  HALLS: hall_facts, hall_events, hall_discoveries, hall_preferences, hall_advice.
  WINGS: wing_user, wing_agent, wing_team, wing_code, wing_myproject, wing_hardware, wing_ue5, wing_ai_research.
  ROOMS: Hyphenated slugs representing named ideas (e.g., chromadb-setup, gpu-pricing).

EXAMPLE:
  FAM: ALC→♡JOR | 2D(kids): RIL(18,sports) MAX(11,chess+swimming) | BEN(contributor)

Read AAAK naturally — expand codes mentally, treat *markers* as emotional context.
When WRITING AAAK: use entity codes, mark emotions, keep structure tight.`

// ── Helper ───────────────────────────────────────────────────────────

function noPalace() {
  return {
    error: 'No palace found',
    palace_path: config.palacePath,
    hint: 'Run: mempalace init <dir> && mempalace mine <dir>',
  }
}

function json(obj: any): string {
  return JSON.stringify(obj, null, 2)
}

/**
 * Canonical wing name for an agent. Must match `buildWingName` in
 * `packages/shared/src/utils/agentAddress.ts` and the normalization in
 * `terminal-app/src/ipcHandlers/configHandlers.ts` so the MCP writer,
 * the system-prompt display, and the auto-loaded wake-up IPC all agree.
 */
function buildWingName(agent_id: string): string {
  const slug = agent_id.toLowerCase().replace(/[^a-z0-9]/g, '_')
  return `wing_${slug}`
}

function rejectNonPermanent(agentId: string | undefined) {
  const auth = requirePermanentAgent(agentId, config.configDir)
  if (auth.ok) return null
  return {
    content: [{
      type: 'text' as const,
      text: json({ success: false, reason: auth.reason, hint: 'Only permanent employees may write to the memory palace.' }),
    }],
  }
}

// ── MCP Server Setup ─────────────────────────────────────────────────

const server = new McpServer({
  name: 'mempalace',
  version: '1.0.0',
})

// ━━ READ TOOLS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.registerTool('mempalace_status', {
  title: 'Palace Status',
  description: 'Palace overview — total drawers, wing and room counts',
  inputSchema: {},
}, async () => {
  const total = store.count()
  const wings = store.getWingCounts()
  const rooms = store.getRoomCounts()
  return {
    content: [{
      type: 'text' as const,
      text: json({ total_drawers: total, wings, rooms, palace_path: config.palacePath, protocol: PALACE_PROTOCOL, aaak_dialect: AAAK_SPEC }),
    }],
  }
})

server.registerTool('mempalace_list_wings', {
  title: 'List Wings',
  description: 'List all wings with drawer counts',
  inputSchema: {},
}, async () => ({
  content: [{ type: 'text' as const, text: json({ wings: store.getWingCounts() }) }],
}))

server.registerTool('mempalace_list_rooms', {
  title: 'List Rooms',
  description: 'List rooms within a wing (or all rooms if no wing given)',
  inputSchema: {
    wing: z.string().optional().describe('Wing to list rooms for (optional)'),
  },
}, async ({ wing }) => ({
  content: [{ type: 'text' as const, text: json({ wing: wing || 'all', rooms: store.getRoomCounts(wing) }) }],
}))

server.registerTool('mempalace_get_taxonomy', {
  title: 'Get Taxonomy',
  description: 'Full taxonomy: wing → room → drawer count',
  inputSchema: {},
}, async () => ({
  content: [{ type: 'text' as const, text: json({ taxonomy: store.getTaxonomy() }) }],
}))

server.registerTool('mempalace_get_aaak_spec', {
  title: 'Get AAAK Spec',
  description: 'Get the AAAK dialect specification — the compressed memory format MemPalace uses.',
  inputSchema: {},
}, async () => ({
  content: [{ type: 'text' as const, text: json({ aaak_spec: AAAK_SPEC }) }],
}))

server.registerTool('mempalace_search', {
  title: 'Search',
  description: 'Full-text search. Returns verbatim drawer content with relevance scores.',
  inputSchema: {
    query: z.string().describe('What to search for'),
    limit: z.number().optional().describe('Max results (default 5)'),
    wing: z.string().optional().describe('Filter by wing (optional)'),
    room: z.string().optional().describe('Filter by room (optional)'),
  },
}, async ({ query, limit, wing, room }) => {
  const results = searchMemories(query, config.palacePath, wing, room, limit || 5)
  return { content: [{ type: 'text' as const, text: json(results) }] }
})

server.registerTool('mempalace_check_duplicate', {
  title: 'Check Duplicate',
  description: 'Check if content already exists in the palace before filing',
  inputSchema: {
    content: z.string().describe('Content to check'),
    threshold: z.number().optional().describe('Similarity threshold 0-1 (default 0.9)'),
  },
}, async ({ content, threshold }) => {
  const result = store.checkDuplicate(content, threshold || 0.9)
  return {
    content: [{ type: 'text' as const, text: json({ is_duplicate: result.isDuplicate, matches: result.matches }) }],
  }
})

server.registerTool('mempalace_traverse', {
  title: 'Traverse Graph',
  description: 'Walk the palace graph from a room. Shows connected ideas across wings — the tunnels.',
  inputSchema: {
    start_room: z.string().describe("Room to start from (e.g. 'chromadb-setup')"),
    max_hops: z.number().optional().describe('How many connections to follow (default: 2)'),
  },
}, async ({ start_room, max_hops }) => {
  const result = traverse(start_room, store, max_hops || 2)
  return { content: [{ type: 'text' as const, text: json(result) }] }
})

server.registerTool('mempalace_find_tunnels', {
  title: 'Find Tunnels',
  description: 'Find rooms that bridge two wings — the hallways connecting different domains.',
  inputSchema: {
    wing_a: z.string().optional().describe('First wing (optional)'),
    wing_b: z.string().optional().describe('Second wing (optional)'),
  },
}, async ({ wing_a, wing_b }) => {
  const result = findTunnels(wing_a, wing_b, store)
  return { content: [{ type: 'text' as const, text: json(result) }] }
})

server.registerTool('mempalace_graph_stats', {
  title: 'Graph Stats',
  description: 'Palace graph overview: total rooms, tunnel connections, edges between wings.',
  inputSchema: {},
}, async () => ({
  content: [{ type: 'text' as const, text: json(graphStats(store)) }],
}))

// ━━ WRITE TOOLS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.registerTool('mempalace_add_drawer', {
  title: 'Add Drawer',
  description: 'File verbatim content into the palace. Checks for duplicates first. Requires a permanent-employee agent_id.',
  inputSchema: {
    agent_id: z.string().describe('Your permanent-employee agent ID (from whoami). Temporary agents cannot write memory.'),
    wing: z.string().describe('Wing (project name)'),
    room: z.string().describe('Room (aspect: backend, decisions, meetings...)'),
    content: z.string().describe('Verbatim content to store — exact words, never summarized'),
    source_file: z.string().optional().describe('Where this came from (optional)'),
    added_by: z.string().optional().describe('Who is filing this (default: mcp)'),
  },
}, async ({ agent_id, wing, room, content, source_file, added_by }) => {
  const rejected = rejectNonPermanent(agent_id)
  if (rejected) return rejected

  // Duplicate check
  const dup = store.checkDuplicate(content, 0.9)
  if (dup.isDuplicate) {
    return {
      content: [{ type: 'text' as const, text: json({ success: false, reason: 'duplicate', matches: dup.matches }) }],
    }
  }

  const hash = crypto.createHash('md5')
    .update(content.slice(0, 100) + new Date().toISOString())
    .digest('hex').slice(0, 16)
  const drawerId = `drawer_${wing}_${room}_${hash}`

  store.add(drawerId, content, {
    wing,
    room,
    source_file: source_file || '',
    chunk_index: 0,
    added_by: added_by || agent_id,
    filed_at: new Date().toISOString(),
    agent: agent_id,
  })

  return {
    content: [{ type: 'text' as const, text: json({ success: true, drawer_id: drawerId, wing, room, agent: agent_id }) }],
  }
})

server.registerTool('mempalace_delete_drawer', {
  title: 'Delete Drawer',
  description: 'Delete a drawer by ID. Irreversible.',
  inputSchema: {
    drawer_id: z.string().describe('ID of the drawer to delete'),
  },
}, async ({ drawer_id }) => {
  const existing = store.get(drawer_id)
  if (!existing) {
    return { content: [{ type: 'text' as const, text: json({ success: false, error: `Drawer not found: ${drawer_id}` }) }] }
  }
  store.delete(drawer_id)
  return { content: [{ type: 'text' as const, text: json({ success: true, drawer_id }) }] }
})

// ━━ KNOWLEDGE GRAPH ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.registerTool('mempalace_kg_query', {
  title: 'KG Query',
  description: "Query the knowledge graph for an entity's relationships. Returns typed facts with temporal validity.",
  inputSchema: {
    entity: z.string().describe("Entity to query (e.g. 'Max', 'MyProject', 'Alice')"),
    as_of: z.string().optional().describe('Date filter — only facts valid at this date (YYYY-MM-DD)'),
    direction: z.string().optional().describe('outgoing, incoming, or both (default: both)'),
  },
}, async ({ entity, as_of, direction }) => {
  const results = kg.queryEntity(entity, as_of, direction || 'both')
  return {
    content: [{ type: 'text' as const, text: json({ entity, as_of: as_of || null, facts: results, count: results.length }) }],
  }
})

server.registerTool('mempalace_kg_add', {
  title: 'KG Add',
  description: "Add a fact to the knowledge graph. Subject → predicate → object with optional time window. Requires a permanent-employee agent_id.",
  inputSchema: {
    agent_id: z.string().describe('Your permanent-employee agent ID (from whoami). Temporary agents cannot write memory.'),
    subject: z.string().describe('The entity doing/being something'),
    predicate: z.string().describe("The relationship type (e.g. 'loves', 'works_on')"),
    object: z.string().describe('The entity being connected to'),
    valid_from: z.string().optional().describe('When this became true (YYYY-MM-DD)'),
    source_closet: z.string().optional().describe('Closet ID where this fact appears'),
  },
}, async ({ agent_id, subject, predicate, object, valid_from, source_closet }) => {
  const rejected = rejectNonPermanent(agent_id)
  if (rejected) return rejected

  const tripleId = kg.addTriple(subject, predicate, object, valid_from, undefined, 1.0, source_closet)
  return {
    content: [{ type: 'text' as const, text: json({ success: true, triple_id: tripleId, fact: `${subject} → ${predicate} → ${object}` }) }],
  }
})

server.registerTool('mempalace_kg_invalidate', {
  title: 'KG Invalidate',
  description: 'Mark a fact as no longer true. E.g. ankle injury resolved, job ended.',
  inputSchema: {
    subject: z.string().describe('Entity'),
    predicate: z.string().describe('Relationship'),
    object: z.string().describe('Connected entity'),
    ended: z.string().optional().describe('When it stopped being true (YYYY-MM-DD, default: today)'),
  },
}, async ({ subject, predicate, object, ended }) => {
  kg.invalidate(subject, predicate, object, ended)
  return {
    content: [{ type: 'text' as const, text: json({ success: true, fact: `${subject} → ${predicate} → ${object}`, ended: ended || 'today' }) }],
  }
})

server.registerTool('mempalace_kg_timeline', {
  title: 'KG Timeline',
  description: 'Chronological timeline of facts. Shows the story of an entity in order.',
  inputSchema: {
    entity: z.string().optional().describe('Entity to get timeline for (optional — omit for full timeline)'),
  },
}, async ({ entity }) => {
  const results = kg.timeline(entity)
  return {
    content: [{ type: 'text' as const, text: json({ entity: entity || 'all', timeline: results, count: results.length }) }],
  }
})

server.registerTool('mempalace_kg_stats', {
  title: 'KG Stats',
  description: 'Knowledge graph overview: entities, triples, current vs expired facts, relationship types.',
  inputSchema: {},
}, async () => ({
  content: [{ type: 'text' as const, text: json(kg.stats()) }],
}))

// ━━ DIARY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.registerTool('mempalace_diary_write', {
  title: 'Diary Write',
  description: "Write to your personal agent diary in AAAK format. Your observations, thoughts, what matters.",
  inputSchema: {
    agent_id: z.string().describe('Your unique agent ID (from whoami) — scopes your diary wing'),
    entry: z.string().describe('Your diary entry in AAAK format'),
    topic: z.string().optional().describe('Topic tag (optional, default: general)'),
  },
}, async ({ agent_id, entry, topic }) => {
  const rejected = rejectNonPermanent(agent_id)
  if (rejected) return rejected

  const wing = buildWingName(agent_id)
  const room = 'diary'
  const now = new Date()
  const hash = crypto.createHash('md5').update(entry.slice(0, 50)).digest('hex').slice(0, 8)
  const entryId = `diary_${wing}_${now.toISOString().replace(/[:.]/g, '').slice(0, 15)}_${hash}`

  store.add(entryId, entry, {
    wing,
    room,
    hall: 'hall_diary',
    topic: topic || 'general',
    type: 'diary_entry',
    agent: agent_id,
    filed_at: now.toISOString(),
    date: now.toISOString().split('T')[0],
  })

  return {
    content: [{
      type: 'text' as const,
      text: json({ success: true, entry_id: entryId, agent: agent_id, topic: topic || 'general', timestamp: now.toISOString() }),
    }],
  }
})

server.registerTool('mempalace_diary_read', {
  title: 'Diary Read',
  description: "Read your recent diary entries. See what past versions of yourself recorded.",
  inputSchema: {
    agent_id: z.string().describe('Your unique agent ID (from whoami) — scopes your diary wing'),
    last_n: z.number().optional().describe('Number of recent entries to read (default: 10)'),
  },
}, async ({ agent_id, last_n }) => {
  const wing = buildWingName(agent_id)
  const drawers = store.getAll(wing, 'diary', last_n || 10)

  const entries = drawers.map(d => ({
    date: d.metadata.date || '',
    timestamp: d.metadata.filed_at || '',
    topic: d.metadata.topic || '',
    content: d.content,
  }))

  entries.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
  const total = store.count(wing, 'diary')

  return {
    content: [{
      type: 'text' as const,
      text: json({ agent: agent_id, entries: entries.slice(0, last_n || 10), total, showing: entries.length }),
    }],
  }
})

// ━━ THE ROOM ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

registerRoomTools(server, store, kg)

// ━━ START ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const transport = new StdioServerTransport()
await server.connect(transport)
console.error('MemPalace MCP Server (TypeScript) started')
