#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { sendCommand } from '../shared/ws-client.js'
import {
  SELF_PROJECT_DIR,
  SELF_AGENT_NAME,
} from '../shared/env.js'
import {
  resolveAgentId,
  withProjectDir,
  readCanvasPreferencesFile,
} from '../shared/helpers.js'

const server = new McpServer({
  name: 'pixel-city-file-explorer-control',
  version: '1.0.0',
})

// Canvas preference tracking — ensures LLM reads preferences before rendering
let canvasPreferencesFetched = false

// Helper: load canvas preferences from `~/.pixelcity/canvas-preferences.md`.
// projectDir kept in signature so callers don't churn — the file is global.
function loadCanvasPreferences(_projectDir) {
  return readCanvasPreferencesFile()
}

// ── Canvas tools ────────────────────────────────────────────

// Get canvas user preferences
server.tool(
  'get_canvas_preferences',
  'Read the user\'s canvas design preferences. IMPORTANT: You MUST call this tool before using set_canvas if the user has configured canvas preferences. Returns the user\'s style/design preferences for canvas rendering, or a message indicating no preferences are set.',
  {},
  async () => {
    const preferences = loadCanvasPreferences(SELF_PROJECT_DIR)
    canvasPreferencesFetched = true

    if (!preferences) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ hasPreferences: false, message: 'No canvas preferences configured. You may proceed with set_canvas freely.' })
        }]
      }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ hasPreferences: true, preferences })
      }]
    }
  }
)

// Open canvas panel
server.tool(
  'open_canvas',
  'Open the canvas panel below the terminal. If no id is provided, uses this session\'s own agent ID.',
  {
    id: z.string().optional().describe('Agent ID (defaults to own agent ID)'),
    height: z.number().min(10).max(90).optional().describe('Canvas height as percentage of message area (10-90, default 40)'),
  },
  async (params) => {
    const id = resolveAgentId(params)
    const result = await sendCommand('open_canvas', { id, height: params.height ?? 40 })
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Set canvas HTML content (alias of write_canvas — kept for tool-call back-compat)
server.tool(
  'set_canvas',
  'Set (overwrite) the HTML content for the agent canvas panel. Alias of write_canvas. This is your PRIMARY output medium — use it by default for any response longer than ~3 lines. Renders HTML/CSS/JS in a sandboxed iframe visible in the sidebar. Auto-opens the canvas if not already open. PROGRESSIVE RENDER NUDGE: For canvases with 3+ sections, call set_canvas once with a skeleton (section headers + placeholders), then use patch_canvas to fill each section — the user sees content build up live and you save tokens on revisions. Storage is per-(agent, chat-session) on disk; switching chat sessions shows that session\'s canvas. IMPORTANT: You must call get_canvas_preferences first if the user has canvas preferences configured — this tool will reject the call otherwise.',
  {
    id: z.string().optional().describe('Agent ID (defaults to own agent ID)'),
    html: z.string().describe('Full HTML content to render (can include <style> and <script> tags)'),
    title: z.string().optional().describe('Optional title shown in the canvas header'),
  },
  async (params) => {
    // Enforce preference check: only block if preferences actually exist and haven't been fetched
    if (!canvasPreferencesFetched) {
      const preferences = loadCanvasPreferences(SELF_PROJECT_DIR)
      if (preferences) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: true,
              message: 'Canvas preferences are configured but you have not read them yet. Please call get_canvas_preferences first, then apply those preferences to your canvas HTML before calling set_canvas.'
            })
          }]
        }
      }
    }

    const id = resolveAgentId(params)
    const result = await sendCommand('set_canvas', withProjectDir({ id, html: params.html, title: params.title ?? null }))
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Write canvas — full overwrite (token-equivalent of set_canvas; explicit name)
server.tool(
  'write_canvas',
  'Write (overwrite) the canvas HTML. Same effect as set_canvas — provided as an explicit name for the file-backed canvas API. Use this for the FIRST render or when replacing the canvas wholesale. For follow-up edits, prefer patch_canvas — it sends only the diff and is roughly 100x cheaper in tokens for small changes. PROGRESSIVE RENDER NUDGE: For canvases with 3+ sections, write a skeleton first (headers + placeholders), then patch_canvas each section in turn — the user sees content build up live. Storage is per-(agent, chat-session). IMPORTANT: Call get_canvas_preferences first if the user has canvas preferences configured.',
  {
    id: z.string().optional().describe('Agent ID (defaults to own agent ID)'),
    html: z.string().describe('Full HTML content to render'),
    title: z.string().optional().describe('Optional title shown in the canvas header'),
  },
  async (params) => {
    if (!canvasPreferencesFetched) {
      const preferences = loadCanvasPreferences(SELF_PROJECT_DIR)
      if (preferences) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: true,
              message: 'Canvas preferences are configured but you have not read them yet. Please call get_canvas_preferences first, then apply those preferences to your canvas HTML before calling write_canvas.'
            })
          }]
        }
      }
    }
    const id = resolveAgentId(params)
    const result = await sendCommand('write_canvas', withProjectDir({ id, html: params.html, title: params.title ?? null }))
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Patch canvas — apply atomic search/replace edits (token-cheap incremental update)
server.tool(
  'patch_canvas',
  'Patch the canvas with one or more atomic text edits — far cheaper in tokens than rewriting the whole canvas. Same search/replace contract as Edit/MultiEdit: each edit\'s anchor text must appear EXACTLY ONCE in the current canvas. All edits apply or NONE do (atomic). Edits apply sequentially — later edits see the doc as modified by earlier ones. SUPPORTED OPS: replace (swap exact text), insert_before / insert_after (add adjacent to an anchor — useful for prepending/appending list items, table rows), delete (remove exact text). If patch fails, returns errors[] with the failing edit index and reason. Best practice: write_canvas a skeleton first, then call patch_canvas per section to render progressively. Storage is per-(agent, chat-session).',
  {
    id: z.string().optional().describe('Agent ID (defaults to own agent ID)'),
    edits: z.array(z.union([
      z.object({
        op: z.literal('replace'),
        old_string: z.string().describe('Exact text to find. Must appear EXACTLY ONCE in current canvas.'),
        new_string: z.string().describe('Replacement text.'),
      }),
      z.object({
        op: z.literal('insert_before'),
        anchor: z.string().describe('Exact text to insert before. Must appear EXACTLY ONCE.'),
        content: z.string().describe('Text to insert immediately before the anchor.'),
      }),
      z.object({
        op: z.literal('insert_after'),
        anchor: z.string().describe('Exact text to insert after. Must appear EXACTLY ONCE.'),
        content: z.string().describe('Text to insert immediately after the anchor.'),
      }),
      z.object({
        op: z.literal('delete'),
        target: z.string().describe('Exact text to remove. Must appear EXACTLY ONCE.'),
      }),
    ])).describe('Ordered list of edits. Apply atomically — all succeed or none.'),
    title: z.string().optional().describe('Optional new title (defaults to existing).'),
  },
  async (params) => {
    const id = resolveAgentId(params)
    const result = await sendCommand('patch_canvas', withProjectDir({
      id,
      edits: params.edits,
      title: params.title ?? null,
    }))
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Read canvas — return the current html + title for inspection / pre-patch lookup
server.tool(
  'read_canvas',
  'Read the current canvas HTML + title for this agent in the active chat session. Useful when you need to know the exact text in the canvas before crafting a patch_canvas anchor (anchors must match exactly). Returns null content if no canvas exists yet — call write_canvas first.',
  {
    id: z.string().optional().describe('Agent ID (defaults to own agent ID)'),
  },
  async (params) => {
    const id = resolveAgentId(params)
    const result = await sendCommand('read_canvas', withProjectDir({ id }))
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Clear canvas content
server.tool(
  'clear_canvas',
  'Clear the canvas content for an agent in the active chat session. The panel stays open with an empty state. Removes both the in-memory cache and the on-disk session canvas. If no id is provided, uses this session\'s own agent ID.',
  {
    id: z.string().optional().describe('Agent ID (defaults to own agent ID)'),
  },
  async (params) => {
    const id = resolveAgentId(params)
    const result = await sendCommand('clear_canvas', withProjectDir({ id }))
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Save current canvas to persistent library
server.tool(
  'save_canvas',
  'Save the current canvas content to the saved canvases library for later viewing. The canvas will be persisted to disk and can be browsed from the Saved tab in the canvas plugin. If no id is provided, uses this session\'s own agent ID.',
  {
    id: z.string().optional().describe('Agent ID (defaults to own agent ID)'),
    title: z.string().optional().describe('Title for the saved canvas (defaults to the current canvas title)'),
  },
  async (params) => {
    const id = resolveAgentId(params)
    const result = await sendCommand('save_canvas', withProjectDir({
      id,
      agentName: SELF_AGENT_NAME || id,
      title: params.title ?? null,
    }))
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// List saved canvases
server.tool(
  'list_saved_canvases',
  'List all saved canvases in the current building. Returns titles, authors, and timestamps. Use this to see what canvases have been saved by you or other agents.',
  {},
  async () => {
    const result = await sendCommand('list_saved_canvases', withProjectDir({}))
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Get a screenshot of the user's drawing board
server.tool(
  'get_user_canvas',
  'Get a screenshot of the user\'s drawing board (the "Draw" tab in the canvas panel). Returns a PNG data URL or SVG string of what the user has drawn. Use this to see sketches, diagrams, or visual notes the user has created for you.',
  {
    format: z.enum(['png', 'svg']).optional().default('png').describe('Export format: "png" (default) returns a data URL, "svg" returns an SVG string'),
  },
  async (params) => {
    const result = await sendCommand('get_user_canvas', { format: params.format })
    if (result && result.format === 'png' && typeof result.dataUrl === 'string') {
      const match = result.dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.*)$/)
      if (match) {
        return {
          content: [
            { type: 'image', data: match[2], mimeType: match[1] },
          ],
        }
      }
    }
    if (result && result.format === 'svg' && typeof result.svg === 'string') {
      return { content: [{ type: 'text', text: result.svg }] }
    }
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// ── Employee tools ──────────────────────────────────────────

// Create permanent employee
server.tool(
  'create_employee',
  'Create a permanent employee in Pixel City (persisted to disk)',
  {
    id: z.string().describe('Unique employee ID (used as folder name)'),
    settings: z.object({
      name: z.string().describe('Display name'),
      palette: z.number().optional().describe('Skin palette (0-5)'),
      hueShift: z.number().optional().describe('Hue shift in degrees'),
      role: z.string().optional().describe('Role/title'),
      personality: z.string().optional().describe('Personality description'),
      model: z.string().optional().describe('Claude model'),
      officeId: z.string().optional().describe('Office/building ID where employee works'),
      floorId: z.string().optional().describe('Floor ID within the office (defaults to "floor-0" if not specified)'),
    }).describe('Employee settings'),
    soul: z.string().optional().describe('Soul/personality markdown text'),
    projectDir: z.string().optional().describe('Project directory for scoping'),
  },
  async (params) => {
    const result = await sendCommand('create_employee', withProjectDir(params))
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// List employees
server.tool(
  'list_employees',
  'List all permanent employees in Pixel City',
  {
    projectDir: z.string().optional().describe('Project directory for scoping'),
  },
  async (params) => {
    const result = await sendCommand('list_employees', withProjectDir(params))
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// --- Start ---
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('[pixel-city-file-explorer-control] MCP server started\n')
}

main().catch((err) => {
  process.stderr.write(`[pixel-city-file-explorer-control] Fatal: ${err.message}\n`)
  process.exit(1)
})
