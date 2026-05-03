/**
 * room.ts — "The Room" MCP tools.
 *
 * The Room is a persistent philosophical visualization scene graph that lives
 * inside the Pixel City Electron app. Scenes are JSON documents composed of
 * visual primitives (nodes, edges, tensions, orbits, stages, stacks,
 * timelines, drawer cards, annotations).
 *
 * Scenes persist as mempalace drawers under `wing_room`. Each save creates a
 * new drawer (a new version); the latest version of a given `scene.id` wins
 * on open/list. Drawer ids are scoped with a `scene_{scene_id}_v{version}`
 * naming convention so versions can be resolved by naming alone.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import crypto from 'crypto'

import { DrawerStore } from './storage.js'
import { KnowledgeGraph } from './knowledge-graph.js'

// ── Scene schema (mirror of renderer/room/schema.ts) ────────────────────

export type PrimitiveId = string
export type DrawerRef = string
export type Vec2 = { x: number; y: number }
export type Tint = 'gold' | 'ember' | 'cool' | 'muted' | 'ghost'

export type PrimitiveKind =
  | 'node'
  | 'edge'
  | 'tension'
  | 'orbit'
  | 'stage'
  | 'stack'
  | 'timeline'
  | 'drawerCard'
  | 'annotation'

export type EdgeKind =
  | 'causes'
  | 'reinforces'
  | 'protects'
  | 'conceals'
  | 'same_as'
  | 'fades_into'
  | 'tensions_with'
  | 'becomes'
  | 'reframes'

export interface BasePrimitive {
  id: PrimitiveId
  kind: PrimitiveKind
  pos?: Vec2
  weight?: number
  tint?: Tint
  note?: string
  drawer?: DrawerRef
  locked?: boolean
}

export interface Node extends BasePrimitive {
  kind: 'node'
  label: string
  subtitle?: string
  shape?: 'circle' | 'diamond' | 'square' | 'star'
}

export interface Edge extends BasePrimitive {
  kind: 'edge'
  from: PrimitiveId
  to: PrimitiveId
  relation: EdgeKind
  label?: string
}

export interface Tension extends BasePrimitive {
  kind: 'tension'
  poleA: string
  poleB: string
  position: number
  figureLabel?: string
  axis?: 'horizontal' | 'vertical'
}

export interface Orbit extends BasePrimitive {
  kind: 'orbit'
  center: PrimitiveId
  satellites: Array<{ node: PrimitiveId; distance: number; angle?: number }>
}

export interface Stage extends BasePrimitive {
  kind: 'stage'
  title?: string
  background?: 'night' | 'day' | 'void' | 'room'
  figures: Array<{
    label: string
    pos: Vec2
    facing?: 'left' | 'right' | 'up' | 'down'
    drawer?: DrawerRef
  }>
}

export interface Stack extends BasePrimitive {
  kind: 'stack'
  layers: Array<{ label: string; meta?: string }>
}

export interface Timeline extends BasePrimitive {
  kind: 'timeline'
  events: Array<{
    id: PrimitiveId
    when: string
    label: string
    branch?: string
    drawer?: DrawerRef
  }>
}

export interface DrawerCard extends BasePrimitive {
  kind: 'drawerCard'
  drawer: DrawerRef
  collapsed?: boolean
  maxLines?: number
}

export interface Annotation extends BasePrimitive {
  kind: 'annotation'
  targets: PrimitiveId[]
  text: string
  emphasis?: 'whisper' | 'plain' | 'underline' | 'glow'
}

export type Primitive =
  | Node
  | Edge
  | Tension
  | Orbit
  | Stage
  | Stack
  | Timeline
  | DrawerCard
  | Annotation

export type Author = 'agent' | 'user' | 'shared'
export type Layout = 'free' | 'force' | 'stacked' | 'timeline'

export interface Scene {
  id: string
  title: string
  subtitle?: string
  author: Author
  version: number
  createdAt: string
  updatedAt: string
  derivedFrom?: string
  camera?: { center: Vec2; zoom: number }
  layout?: Layout
  primitives: Primitive[]
  references?: DrawerRef[]
}

// ── Zod schemas ─────────────────────────────────────────────────────────

const vec2Schema = z.object({ x: z.number(), y: z.number() })
const tintSchema = z.enum(['gold', 'ember', 'cool', 'muted', 'ghost'])
const edgeKindSchema = z.enum([
  'causes',
  'reinforces',
  'protects',
  'conceals',
  'same_as',
  'fades_into',
  'tensions_with',
  'becomes',
  'reframes',
])

const baseShape = {
  id: z.string(),
  pos: vec2Schema.optional(),
  weight: z.number().optional(),
  tint: tintSchema.optional(),
  note: z.string().optional(),
  drawer: z.string().optional(),
  locked: z.boolean().optional(),
}

const nodeSchema = z.object({
  ...baseShape,
  kind: z.literal('node'),
  label: z.string(),
  subtitle: z.string().optional(),
  shape: z.enum(['circle', 'diamond', 'square', 'star']).optional(),
})

const edgeSchema = z.object({
  ...baseShape,
  kind: z.literal('edge'),
  from: z.string(),
  to: z.string(),
  relation: edgeKindSchema,
  label: z.string().optional(),
})

const tensionSchema = z.object({
  ...baseShape,
  kind: z.literal('tension'),
  poleA: z.string(),
  poleB: z.string(),
  position: z.number(),
  figureLabel: z.string().optional(),
  axis: z.enum(['horizontal', 'vertical']).optional(),
})

const orbitSchema = z.object({
  ...baseShape,
  kind: z.literal('orbit'),
  center: z.string(),
  satellites: z.array(
    z.object({ node: z.string(), distance: z.number(), angle: z.number().optional() }),
  ),
})

const stageSchema = z.object({
  ...baseShape,
  kind: z.literal('stage'),
  title: z.string().optional(),
  background: z.enum(['night', 'day', 'void', 'room']).optional(),
  figures: z.array(
    z.object({
      label: z.string(),
      pos: vec2Schema,
      facing: z.enum(['left', 'right', 'up', 'down']).optional(),
      drawer: z.string().optional(),
    }),
  ),
})

const stackSchema = z.object({
  ...baseShape,
  kind: z.literal('stack'),
  layers: z.array(z.object({ label: z.string(), meta: z.string().optional() })),
})

const timelineSchema = z.object({
  ...baseShape,
  kind: z.literal('timeline'),
  events: z.array(
    z.object({
      id: z.string(),
      when: z.string(),
      label: z.string(),
      branch: z.string().optional(),
      drawer: z.string().optional(),
    }),
  ),
})

const drawerCardSchema = z.object({
  ...baseShape,
  kind: z.literal('drawerCard'),
  drawer: z.string(),
  collapsed: z.boolean().optional(),
  maxLines: z.number().optional(),
})

const annotationSchema = z.object({
  ...baseShape,
  kind: z.literal('annotation'),
  targets: z.array(z.string()),
  text: z.string(),
  emphasis: z.enum(['whisper', 'plain', 'underline', 'glow']).optional(),
})

const primitiveSchema = z.discriminatedUnion('kind', [
  nodeSchema,
  edgeSchema,
  tensionSchema,
  orbitSchema,
  stageSchema,
  stackSchema,
  timelineSchema,
  drawerCardSchema,
  annotationSchema,
])

const sceneSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  author: z.enum(['agent', 'user', 'shared']),
  version: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
  derivedFrom: z.string().optional(),
  camera: z.object({ center: vec2Schema, zoom: z.number() }).optional(),
  layout: z.enum(['free', 'force', 'stacked', 'timeline']).optional(),
  primitives: z.array(primitiveSchema),
  references: z.array(z.string()).optional(),
})

// ── Constants & helpers ─────────────────────────────────────────────────

export const ROOM_WING = 'wing_room'
const SCENE_TYPE = 'room_scene'

function json(obj: any): string {
  return JSON.stringify(obj, null, 2)
}

function sanitizeRoomSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'unnamed'
}

function shortHash(input: string): string {
  return crypto.createHash('md5').update(input).digest('hex').slice(0, 8)
}

function makeSceneDrawerId(scene: Scene): string {
  const suffix = shortHash(`${scene.id}:${scene.version}:${new Date().toISOString()}`)
  return `drawer_${ROOM_WING}_scene_${scene.id}_v${scene.version}_${suffix}`
}

interface StoredScene {
  drawer_id: string
  scene: Scene
}

function parseSceneDrawer(drawerId: string, content: string): StoredScene | null {
  try {
    const parsed = JSON.parse(content)
    const result = sceneSchema.safeParse(parsed)
    if (!result.success) return null
    return { drawer_id: drawerId, scene: result.data as Scene }
  } catch {
    return null
  }
}

/** Return every room-wing drawer that is a parseable scene. */
function loadAllScenes(store: DrawerStore): StoredScene[] {
  const drawers = store.getAll(ROOM_WING, undefined, 10000)
  const out: StoredScene[] = []
  for (const d of drawers) {
    if (d.metadata.type && d.metadata.type !== SCENE_TYPE) continue
    const parsed = parseSceneDrawer(d.id, d.content)
    if (parsed) out.push(parsed)
  }
  return out
}

/** Find the latest version of a scene by scene.id. */
function findLatestScene(store: DrawerStore, sceneId: string): StoredScene | null {
  const all = loadAllScenes(store)
  let best: StoredScene | null = null
  for (const s of all) {
    if (s.scene.id !== sceneId) continue
    if (!best || s.scene.version > best.scene.version) best = s
  }
  return best
}

function findByDrawerId(store: DrawerStore, drawerId: string): StoredScene | null {
  const d = store.get(drawerId)
  if (!d) return null
  return parseSceneDrawer(d.id, d.content)
}

function storeScene(
  store: DrawerStore,
  scene: Scene,
  extraMeta: Record<string, string> = {},
): string {
  const drawerId = makeSceneDrawerId(scene)
  const room = sanitizeRoomSlug(scene.title)
  store.add(drawerId, JSON.stringify(scene, null, 2), {
    wing: ROOM_WING,
    room,
    type: SCENE_TYPE,
    topic: scene.id,
    added_by: 'room_mcp',
    filed_at: new Date().toISOString(),
    ...extraMeta,
  })
  return drawerId
}

function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: json({ success: false, error: message }) }],
    isError: true,
  }
}

function okResult(payload: any) {
  return {
    content: [{ type: 'text' as const, text: json({ success: true, ...payload }) }],
  }
}

function validateSceneInternal(scene: Scene): string | null {
  // Reject edges / annotations / orbits that reference unknown primitives.
  const ids = new Set(scene.primitives.map(p => p.id))
  for (const p of scene.primitives) {
    if (p.kind === 'edge') {
      if (!ids.has(p.from)) return `edge ${p.id} references unknown 'from' primitive: ${p.from}`
      if (!ids.has(p.to)) return `edge ${p.id} references unknown 'to' primitive: ${p.to}`
    } else if (p.kind === 'annotation') {
      for (const t of p.targets) {
        if (!ids.has(t)) return `annotation ${p.id} references unknown target: ${t}`
      }
    } else if (p.kind === 'orbit') {
      if (!ids.has(p.center)) return `orbit ${p.id} references unknown center: ${p.center}`
      for (const sat of p.satellites) {
        if (!ids.has(sat.node)) return `orbit ${p.id} references unknown satellite: ${sat.node}`
      }
    }
  }
  return null
}

// ── Tool registration ───────────────────────────────────────────────────

export function registerRoomTools(
  server: McpServer,
  store: DrawerStore,
  kg: KnowledgeGraph,
): void {
  // ── mempalace_room_create ─────────────────────────────────────────────
  server.registerTool(
    'mempalace_room_create',
    {
      title: 'Room: Create Scene',
      description:
        'Create a new Room scene. Stores the full Scene JSON as a drawer under wing_room. Returns the new drawer id and a scene ref.',
      inputSchema: {
        scene: sceneSchema.describe('Full Scene JSON (see Room schema in this file)'),
      },
    },
    async ({ scene }) => {
      const semErr = validateSceneInternal(scene as Scene)
      if (semErr) return errorResult(`invalid scene: ${semErr}`)

      const drawerId = storeScene(store, scene as Scene)
      return okResult({
        drawer_id: drawerId,
        scene_id: scene.id,
        scene_ref: `scene:${drawerId}`,
        wing: ROOM_WING,
        room: sanitizeRoomSlug(scene.title),
        version: scene.version,
      })
    },
  )

  // ── mempalace_room_save ───────────────────────────────────────────────
  server.registerTool(
    'mempalace_room_save',
    {
      title: 'Room: Save Scene Version',
      description:
        'Save an update to an existing scene as a new version. Increments scene.version, sets derivedFrom, and records a KG `derived_from` edge back to the previous drawer.',
      inputSchema: {
        scene: sceneSchema.describe('Full Scene JSON — scene.id must already exist in wing_room'),
      },
    },
    async ({ scene }) => {
      const semErr = validateSceneInternal(scene as Scene)
      if (semErr) return errorResult(`invalid scene: ${semErr}`)

      const prev = findLatestScene(store, scene.id)
      if (!prev) {
        return errorResult(
          `no existing scene with id '${scene.id}' — use mempalace_room_create for new scenes`,
        )
      }

      const nextVersion = Math.max(prev.scene.version + 1, scene.version + 1)
      const nextScene: Scene = {
        ...(scene as Scene),
        version: nextVersion,
        derivedFrom: prev.drawer_id,
        createdAt: prev.scene.createdAt,
        updatedAt: new Date().toISOString(),
      }

      const drawerId = storeScene(store, nextScene)

      // KG edge: new_drawer → derived_from → old_drawer
      let tripleId: string | null = null
      try {
        tripleId = kg.addTriple(drawerId, 'derived_from', prev.drawer_id, undefined, undefined, 1.0, drawerId)
      } catch {
        // non-fatal: scene is already persisted
      }

      return okResult({
        drawer_id: drawerId,
        scene_id: nextScene.id,
        scene_ref: `scene:${drawerId}`,
        version: nextScene.version,
        derived_from: prev.drawer_id,
        kg_triple_id: tripleId,
      })
    },
  )

  // ── mempalace_room_open ───────────────────────────────────────────────
  server.registerTool(
    'mempalace_room_open',
    {
      title: 'Room: Open Scene',
      description:
        'Fetch a scene by scene_id (returns the latest version) or by drawer_id (returns that exact version).',
      inputSchema: {
        scene_id: z.string().optional().describe('Logical scene id — returns latest version'),
        drawer_id: z.string().optional().describe('Exact drawer id — returns that version'),
      },
    },
    async ({ scene_id, drawer_id }) => {
      if (!scene_id && !drawer_id) {
        return errorResult('provide scene_id or drawer_id')
      }

      let stored: StoredScene | null = null
      if (drawer_id) {
        stored = findByDrawerId(store, drawer_id)
        if (!stored) return errorResult(`drawer not found or not a valid scene: ${drawer_id}`)
      } else if (scene_id) {
        stored = findLatestScene(store, scene_id)
        if (!stored) return errorResult(`no scene found with id: ${scene_id}`)
      }

      return okResult({
        drawer_id: stored!.drawer_id,
        scene: stored!.scene,
      })
    },
  )

  // ── mempalace_room_list ───────────────────────────────────────────────
  server.registerTool(
    'mempalace_room_list',
    {
      title: 'Room: List Scenes',
      description:
        'List the latest version of each unique scene stored under wing_room, newest first.',
      inputSchema: {
        limit: z.number().optional().describe('Max scenes to return (default 20)'),
      },
    },
    async ({ limit }) => {
      const all = loadAllScenes(store)
      const latestById = new Map<string, StoredScene>()
      for (const s of all) {
        const existing = latestById.get(s.scene.id)
        if (!existing || s.scene.version > existing.scene.version) {
          latestById.set(s.scene.id, s)
        }
      }
      const rows = [...latestById.values()]
        .map(s => ({
          scene_id: s.scene.id,
          title: s.scene.title,
          subtitle: s.scene.subtitle || '',
          version: s.scene.version,
          updatedAt: s.scene.updatedAt,
          drawer_id: s.drawer_id,
        }))
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
        .slice(0, limit || 20)

      return okResult({ count: rows.length, scenes: rows })
    },
  )

  // Shared helper: load latest, mutate, save as new version (used by
  // add_primitive / connect / annotate).
  async function mutateSceneAndSave(
    sceneId: string,
    mutate: (scene: Scene) => string | null,
  ) {
    const prev = findLatestScene(store, sceneId)
    if (!prev) return errorResult(`no scene found with id: ${sceneId}`)

    // Clone to avoid mutating the cached parse.
    const next: Scene = JSON.parse(JSON.stringify(prev.scene))
    const mutErr = mutate(next)
    if (mutErr) return errorResult(mutErr)

    next.version = prev.scene.version + 1
    next.derivedFrom = prev.drawer_id
    next.updatedAt = new Date().toISOString()

    const semErr = validateSceneInternal(next)
    if (semErr) return errorResult(`invalid scene after mutation: ${semErr}`)

    const drawerId = storeScene(store, next, {})
    try {
      kg.addTriple(drawerId, 'derived_from', prev.drawer_id, undefined, undefined, 1.0, drawerId)
    } catch {
      // non-fatal
    }

    return okResult({
      drawer_id: drawerId,
      scene_id: next.id,
      version: next.version,
      derived_from: prev.drawer_id,
      scene: next,
    })
  }

  // ── mempalace_room_add_primitive ──────────────────────────────────────
  server.registerTool(
    'mempalace_room_add_primitive',
    {
      title: 'Room: Add Primitive',
      description:
        'Append a primitive to a scene and save as a new version. Rejects primitive ids that already exist in the scene.',
      inputSchema: {
        scene_id: z.string().describe('Logical scene id'),
        primitive: primitiveSchema.describe('Primitive to append'),
      },
    },
    async ({ scene_id, primitive }) => {
      return mutateSceneAndSave(scene_id, (scene) => {
        if (scene.primitives.some(p => p.id === (primitive as Primitive).id)) {
          return `primitive id '${(primitive as Primitive).id}' already exists in scene`
        }
        scene.primitives.push(primitive as Primitive)
        return null
      })
    },
  )

  // ── mempalace_room_connect ────────────────────────────────────────────
  server.registerTool(
    'mempalace_room_connect',
    {
      title: 'Room: Connect',
      description:
        'Convenience: append an Edge primitive between two existing primitives in a scene and save as a new version.',
      inputSchema: {
        scene_id: z.string().describe('Logical scene id'),
        from: z.string().describe('from primitive id'),
        to: z.string().describe('to primitive id'),
        relation: edgeKindSchema.describe('edge relation kind'),
        label: z.string().optional().describe('optional label on the edge'),
        id: z.string().optional().describe('optional edge id (auto-generated if omitted)'),
      },
    },
    async ({ scene_id, from, to, relation, label, id }) => {
      return mutateSceneAndSave(scene_id, (scene) => {
        const ids = new Set(scene.primitives.map(p => p.id))
        if (!ids.has(from)) return `from primitive '${from}' not in scene`
        if (!ids.has(to)) return `to primitive '${to}' not in scene`
        const edgeId = id || `e_${shortHash(`${from}:${to}:${relation}:${Date.now()}`)}`
        if (ids.has(edgeId)) return `edge id '${edgeId}' already exists in scene`
        const edge: Edge = {
          id: edgeId,
          kind: 'edge',
          from,
          to,
          relation,
          ...(label ? { label } : {}),
        }
        scene.primitives.push(edge)
        return null
      })
    },
  )

  // ── mempalace_room_annotate ───────────────────────────────────────────
  server.registerTool(
    'mempalace_room_annotate',
    {
      title: 'Room: Annotate',
      description:
        'Convenience: append an Annotation primitive targeting existing primitives in a scene and save as a new version.',
      inputSchema: {
        scene_id: z.string().describe('Logical scene id'),
        targets: z.array(z.string()).min(1).describe('primitive ids the annotation points at'),
        text: z.string().describe('annotation text'),
        emphasis: z
          .enum(['whisper', 'plain', 'underline', 'glow'])
          .optional()
          .describe('visual emphasis'),
        tint: tintSchema.optional(),
        id: z.string().optional().describe('optional annotation id (auto-generated if omitted)'),
      },
    },
    async ({ scene_id, targets, text, emphasis, tint, id }) => {
      return mutateSceneAndSave(scene_id, (scene) => {
        const ids = new Set(scene.primitives.map(p => p.id))
        for (const t of targets) {
          if (!ids.has(t)) return `annotation target '${t}' not in scene`
        }
        const annId = id || `a_${shortHash(`${targets.join(',')}:${text}:${Date.now()}`)}`
        if (ids.has(annId)) return `annotation id '${annId}' already exists in scene`
        const ann: Annotation = {
          id: annId,
          kind: 'annotation',
          targets,
          text,
          ...(emphasis ? { emphasis } : {}),
          ...(tint ? { tint } : {}),
        }
        scene.primitives.push(ann)
        return null
      })
    },
  )
}
