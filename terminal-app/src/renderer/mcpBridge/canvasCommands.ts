/**
 * Canvas command handlers for the MCP Bridge — L2 Sync Layer.
 *
 * Bridges MCP tool calls (write_canvas / patch_canvas / read_canvas / set_canvas
 * / open_canvas / clear_canvas / get_user_canvas) to the L0 disk layer (IPC) and
 * the L1 in-memory store. Resolves the active sessionId for each call so canvas
 * state is scoped per (agentId, sessionId).
 *
 * Disk is the source of truth across restarts; the in-memory store is a hot
 * cache for fast UI rendering. set/patch flow:
 *   1. read current html (memory or disk)
 *   2. compute new html (overwrite for write, applyPatch for patch)
 *   3. write to disk → new version id
 *   4. mirror into in-memory store
 *
 * The store itself has zero DOM/IPC knowledge — all side-effects live here.
 */

import { getCanvasStore } from '@pixel-city/plugin-canvas'
import type { CanvasContent, CanvasVersion } from '@pixel-city/plugin-canvas/store'
import { applyPatch, type CanvasEdit } from '@pixel-city/plugin-canvas/patcher'
import { getDrawingEditor } from '@pixel-city/plugin-canvas/userDrawingEditorRef'
import { exportToCanvas, exportToSvg } from '@excalidraw/excalidraw'
import {
  resolveActiveSession,
  setActiveSessionForAgent,
} from './canvasSessionResolver.js'

type IpcInvoke = (channel: string, ...args: any[]) => Promise<any>

let cachedIpc: IpcInvoke | null = null
function getIpc(): IpcInvoke {
  if (cachedIpc) return cachedIpc
  const { ipcRenderer } = window.require('electron') as typeof import('electron')
  cachedIpc = (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args)
  return cachedIpc
}

interface CanvasContext {
  projectDir: string | null
  buildingId: string | null
  agentId: string
  sessionId: string
}

function ctxFromParams(params: Record<string, unknown>, agentId: string): CanvasContext {
  const projectDir = (params.projectDir as string) ?? null
  const buildingId = (params.buildingId as string) ?? null
  // sessionId may be passed explicitly (rare — for tests / forced session targets).
  // Otherwise resolve from the agent→session mapping populated by claude-code.
  const sessionId = (params.sessionId as string) ?? resolveActiveSession(agentId)
  return { projectDir, buildingId, agentId, sessionId }
}

function ipcArgs(ctx: CanvasContext): Record<string, unknown> {
  return {
    projectDir: ctx.projectDir,
    buildingId: ctx.buildingId,
    agentId: ctx.agentId,
    sessionId: ctx.sessionId,
  }
}

async function readCurrentHtml(ctx: CanvasContext): Promise<{ html: string; title: string | null } | null> {
  // Prefer memory cache for speed; fall through to disk if missing.
  const cached = getCanvasStore().get(ctx.agentId, ctx.sessionId)
  if (cached) return { html: cached.html, title: cached.title }
  if (!ctx.projectDir) return null
  const res = await getIpc()('canvas-read', ipcArgs(ctx))
  if (!res?.success || !res.data) return null
  return { html: res.data.html, title: res.data.title }
}

async function writeAndCache(
  ctx: CanvasContext,
  html: string,
  title: string | null,
): Promise<{ versionId: number | null }> {
  let versionId: number | null = null
  if (ctx.projectDir) {
    const res = await getIpc()('canvas-write', { ...ipcArgs(ctx), html, title })
    if (res?.success) {
      versionId = res.data?.versionId ?? null
    }
  }
  // Mirror into the in-memory store. Always — even if disk write failed —
  // so the agent sees their own update immediately.
  getCanvasStore().set(ctx.agentId, html, title, ctx.sessionId)
  return { versionId }
}

export async function executeCanvasAction(
  action: string,
  params: Record<string, unknown>,
  shouldFocus: boolean = true,
): Promise<unknown> {
  const store = getCanvasStore()

  switch (action) {
    case 'open_canvas': {
      const agentId = params.id as string
      if (!agentId) throw new Error('Missing agent id')
      if (shouldFocus) {
        window.dispatchEvent(new CustomEvent('pixelcity:canvas-show', { detail: { agentId } }))
      }
      return { success: true }
    }

    case 'set_canvas':
    case 'write_canvas': {
      const agentId = params.id as string
      const html = params.html as string
      const title = (params.title as string) ?? null
      if (!agentId) throw new Error('Missing agent id')
      if (!html) throw new Error('Missing html content')
      const ctx = ctxFromParams(params, agentId)
      const { versionId } = await writeAndCache(ctx, html, title)
      if (shouldFocus) {
        window.dispatchEvent(new CustomEvent('pixelcity:canvas-show', { detail: { agentId } }))
      }
      return { success: true, versionId, sessionId: ctx.sessionId }
    }

    case 'patch_canvas': {
      const agentId = params.id as string
      const edits = (params.edits as CanvasEdit[] | undefined) ?? []
      if (!agentId) throw new Error('Missing agent id')
      if (!Array.isArray(edits) || edits.length === 0) {
        throw new Error('patch_canvas requires a non-empty edits[] array')
      }
      const ctx = ctxFromParams(params, agentId)
      const current = await readCurrentHtml(ctx)
      if (!current) {
        return {
          success: false,
          error: 'No canvas exists for this agent yet — call write_canvas first to create one before patching.',
        }
      }
      const result = applyPatch(current.html, edits)
      if (!result.ok) {
        return { success: false, errors: result.errors, applied: 0 }
      }
      // Title may be optionally updated by the patch caller.
      const title = (params.title as string) ?? current.title
      const { versionId } = await writeAndCache(ctx, result.html, title)
      if (shouldFocus) {
        window.dispatchEvent(new CustomEvent('pixelcity:canvas-show', { detail: { agentId } }))
      }
      return {
        success: true,
        applied: result.applied,
        versionId,
        sessionId: ctx.sessionId,
      }
    }

    case 'read_canvas': {
      const agentId = params.id as string
      if (!agentId) throw new Error('Missing agent id')
      const ctx = ctxFromParams(params, agentId)
      const current = await readCurrentHtml(ctx)
      if (!current) {
        return { success: true, data: null, sessionId: ctx.sessionId }
      }
      return {
        success: true,
        data: { html: current.html, title: current.title },
        sessionId: ctx.sessionId,
      }
    }

    case 'clear_canvas': {
      const agentId = params.id as string
      if (!agentId) throw new Error('Missing agent id')
      const ctx = ctxFromParams(params, agentId)
      // Clear the in-memory cache first for instant UI feedback.
      store.clear(agentId, ctx.sessionId)
      // Then remove from disk if we have a project dir.
      if (ctx.projectDir) {
        try {
          await getIpc()('canvas-clear-disk', ipcArgs(ctx))
        } catch {
          // Best-effort — memory clear already happened.
        }
      }
      return { success: true, sessionId: ctx.sessionId }
    }

    case 'get_user_canvas': {
      const api = getDrawingEditor()
      if (!api) {
        return { empty: true, message: 'No drawing board is currently open. The user needs to open the Draw tab in the canvas panel first.' }
      }
      const elements = api.getSceneElements()
      if (elements.length === 0) {
        return { empty: true, message: 'The drawing board is open but empty — the user has not drawn anything yet.' }
      }
      const appState = api.getAppState()
      const files = api.getFiles()
      const format = (params.format as string) ?? 'png'
      if (format === 'svg') {
        const svg = await exportToSvg({ elements, appState, files, exportPadding: 16 })
        return { format: 'svg', data: svg.outerHTML }
      }
      const canvas = await exportToCanvas({ elements, appState, files, exportPadding: 16 })
      return { format: 'png', dataUrl: canvas.toDataURL('image/png', 0.9) }
    }

    default:
      throw new Error(`Unknown canvas action: ${action}`)
  }
}

/** All action names handled by this module. */
export const CANVAS_ACTIONS = new Set([
  'open_canvas',
  'set_canvas',
  'write_canvas',
  'patch_canvas',
  'read_canvas',
  'clear_canvas',
  'get_user_canvas',
])

/**
 * Hydrate the in-memory store from on-disk canvases for a given building.
 * Called at boot so permanent employees' canvases survive restart.
 */
export async function hydrateCanvasesFromDisk(
  projectDir: string | null,
  buildingId: string | null,
): Promise<void> {
  if (!projectDir) return
  let listRes: any
  try {
    listRes = await getIpc()('canvas-list-all', { projectDir, buildingId })
  } catch {
    return
  }
  if (!listRes?.success || !Array.isArray(listRes.data)) return

  const store = getCanvasStore()
  for (const entry of listRes.data as Array<{ agentId: string; sessionId: string; title: string | null }>) {
    const ctx: CanvasContext = {
      projectDir,
      buildingId,
      agentId: entry.agentId,
      sessionId: entry.sessionId,
    }
    try {
      const [readRes, versionsRes] = await Promise.all([
        getIpc()('canvas-read', ipcArgs(ctx)),
        getIpc()('canvas-list-versions', ipcArgs(ctx)),
      ])
      if (!readRes?.success || !readRes.data) continue
      const content: CanvasContent = {
        html: readRes.data.html,
        title: readRes.data.title,
      }
      // Disk versions don't carry html (we keep it lean over IPC). For UI
      // restoration we'd need to call canvas-read-version on demand. For now
      // hydrate metadata only — clicking a version triggers a fresh read.
      const versions: CanvasVersion[] = versionsRes?.success && Array.isArray(versionsRes.data)
        ? versionsRes.data.map((v: any) => ({
            id: v.id,
            html: '', // lazy — fetched on restoreVersion
            title: v.title ?? null,
            timestamp: v.timestamp,
          }))
        : []
      store.hydrateFromDisk(entry.agentId, entry.sessionId, content, versions, false)
    } catch {
      // Best-effort hydration — skip broken entries
    }
  }
}

/**
 * Switch the displayed canvas for an agent to a different session and load
 * its content from disk. Called when the user picks a different chat session
 * in the session chooser.
 */
export async function switchCanvasSession(
  projectDir: string | null,
  buildingId: string | null,
  agentId: string,
  sessionId: string,
): Promise<void> {
  setActiveSessionForAgent(agentId, sessionId)

  const store = getCanvasStore()
  // If we already have this session's content cached, just flip the active flag.
  if (store.get(agentId, sessionId)) {
    store.setActiveSession(agentId, sessionId)
    return
  }
  // Otherwise hydrate from disk.
  if (!projectDir) {
    store.setActiveSession(agentId, sessionId)
    return
  }
  const ctx: CanvasContext = { projectDir, buildingId, agentId, sessionId }
  try {
    const [readRes, versionsRes] = await Promise.all([
      getIpc()('canvas-read', ipcArgs(ctx)),
      getIpc()('canvas-list-versions', ipcArgs(ctx)),
    ])
    if (readRes?.success && readRes.data) {
      const versions: CanvasVersion[] = versionsRes?.success && Array.isArray(versionsRes.data)
        ? versionsRes.data.map((v: any) => ({
            id: v.id,
            html: '',
            title: v.title ?? null,
            timestamp: v.timestamp,
          }))
        : []
      store.hydrateFromDisk(
        agentId,
        sessionId,
        { html: readRes.data.html, title: readRes.data.title },
        versions,
        true,
      )
    } else {
      // No on-disk content for that session — make it active anyway so the
      // empty-state UI renders for the right (agent, session).
      store.setActiveSession(agentId, sessionId)
    }
  } catch {
    store.setActiveSession(agentId, sessionId)
  }
}
