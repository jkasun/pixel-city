// Canvas File Handlers — L0 (Main Process IPC)
// Disk-backed storage for the live canvas + version history.
// Path: <projectDir>/.pixelcity/canvases/<buildingId>/<agentId>/sessions/<sessionId>/
//   current.html              — most recent canvas
//   meta.json                 — { title, latestVersionId, latestVersionAt }
//   versions/v<NNN>-<ts>.html — history snapshots
//
// Atomic writes (writeFile to .tmp + rename). 3s coalesce window so a burst of
// progressive-render patches collapses into a single version. 50-cap eviction.
//
// Patching itself happens in L2 (renderer); this module only stores bytes.

import { IpcMain } from 'electron'
import path from 'path'
import fs from 'fs'

const COALESCE_WINDOW_MS = 3000
const MAX_VERSIONS = 50
const VERSION_FILE_RE = /^v(\d+)-(\d+)\.html$/

interface CanvasMeta {
  title: string | null
  latestVersionId: number
  latestVersionAt: number
}

interface CanvasKey {
  projectDir: string
  buildingId: string
  agentId: string
  sessionId: string
}

interface VersionEntry {
  id: number
  title: string | null
  timestamp: number
}

function sanitiseSegment(seg: string): string {
  // Defensive against weird MCP input. Allow letters, digits, dot, dash, underscore.
  return seg.replace(/[^A-Za-z0-9._-]/g, '_')
}

function sessionDir(key: CanvasKey): string {
  return path.join(
    key.projectDir,
    '.pixelcity',
    'canvases',
    sanitiseSegment(key.buildingId || 'default'),
    sanitiseSegment(key.agentId),
    'sessions',
    sanitiseSegment(key.sessionId || '_default'),
  )
}

function versionsDir(key: CanvasKey): string {
  return path.join(sessionDir(key), 'versions')
}

function currentHtmlPath(key: CanvasKey): string {
  return path.join(sessionDir(key), 'current.html')
}

function metaPath(key: CanvasKey): string {
  return path.join(sessionDir(key), 'meta.json')
}

function versionFileName(id: number, timestamp: number): string {
  return `v${String(id).padStart(4, '0')}-${timestamp}.html`
}

function versionPath(key: CanvasKey, id: number, timestamp: number): string {
  return path.join(versionsDir(key), versionFileName(id, timestamp))
}

function readMeta(key: CanvasKey): CanvasMeta | null {
  try {
    const raw = fs.readFileSync(metaPath(key), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      return {
        title: parsed.title ?? null,
        latestVersionId: Number(parsed.latestVersionId) || 0,
        latestVersionAt: Number(parsed.latestVersionAt) || 0,
      }
    }
  } catch {
    // Missing or malformed
  }
  return null
}

function writeFileAtomicSync(target: string, data: string | Buffer): void {
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, target)
}

function writeMeta(key: CanvasKey, meta: CanvasMeta): void {
  writeFileAtomicSync(metaPath(key), JSON.stringify(meta, null, 2))
}

function ensureSessionDir(key: CanvasKey): void {
  fs.mkdirSync(versionsDir(key), { recursive: true })
}

function listVersionFiles(key: CanvasKey): { id: number; ts: number; file: string }[] {
  const dir = versionsDir(key)
  let files: string[]
  try {
    files = fs.readdirSync(dir)
  } catch {
    return []
  }
  const out: { id: number; ts: number; file: string }[] = []
  for (const f of files) {
    const m = VERSION_FILE_RE.exec(f)
    if (!m) continue
    out.push({ id: parseInt(m[1], 10), ts: parseInt(m[2], 10), file: f })
  }
  // Sort ascending by id
  out.sort((a, b) => a.id - b.id)
  return out
}

function evictOldVersions(key: CanvasKey): void {
  const versions = listVersionFiles(key)
  if (versions.length <= MAX_VERSIONS) return
  const excess = versions.length - MAX_VERSIONS
  for (let i = 0; i < excess; i++) {
    try { fs.unlinkSync(path.join(versionsDir(key), versions[i].file)) } catch {}
  }
}

function captureVersion(
  key: CanvasKey,
  html: string,
  title: string | null,
  meta: CanvasMeta | null,
  now: number,
): { id: number; timestamp: number } {
  ensureSessionDir(key)

  // Coalesce: if the most recent version was written within the window,
  // replace it in place rather than creating a new one. Keeps bursty
  // progressive renders from blowing through the 50-cap.
  if (meta && meta.latestVersionId > 0 && now - meta.latestVersionAt < COALESCE_WINDOW_MS) {
    // Find the existing latest file (timestamp may differ from current `now`).
    const versions = listVersionFiles(key)
    const latest = versions[versions.length - 1]
    if (latest && latest.id === meta.latestVersionId) {
      // Overwrite in place. Keep the same filename so file count stays stable.
      const existingPath = path.join(versionsDir(key), latest.file)
      writeFileAtomicSync(existingPath, html)
      return { id: latest.id, timestamp: latest.ts }
    }
    // Fallthrough: meta said a latest exists but we couldn't find the file.
    // Treat as a fresh version.
  }

  const nextId = (meta?.latestVersionId ?? 0) + 1
  const target = versionPath(key, nextId, now)
  writeFileAtomicSync(target, html)
  evictOldVersions(key)
  return { id: nextId, timestamp: now }
}

// ── IPC Handlers ────────────────────────────────────────────────

export function register(ipcMain: IpcMain) {
  // Write a full canvas. Captures a version (subject to 3s coalesce).
  ipcMain.handle('canvas-write', async (_event, args: any) => {
    try {
      const key: CanvasKey = {
        projectDir: args.projectDir,
        buildingId: args.buildingId || 'default',
        agentId: args.agentId,
        sessionId: args.sessionId || '_default',
      }
      const html = String(args.html ?? '')
      const title: string | null = args.title ?? null
      if (!key.projectDir || !key.agentId) {
        return { success: false, error: 'Missing projectDir or agentId' }
      }

      ensureSessionDir(key)
      const now = Date.now()
      const prevMeta = readMeta(key)
      const version = captureVersion(key, html, title, prevMeta, now)
      writeFileAtomicSync(currentHtmlPath(key), html)
      writeMeta(key, {
        title,
        latestVersionId: version.id,
        latestVersionAt: version.timestamp,
      })
      return {
        success: true,
        data: { versionId: version.id, timestamp: version.timestamp, title },
      }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Read the current canvas + title. Returns null if no canvas exists.
  ipcMain.handle('canvas-read', async (_event, args: any) => {
    try {
      const key: CanvasKey = {
        projectDir: args.projectDir,
        buildingId: args.buildingId || 'default',
        agentId: args.agentId,
        sessionId: args.sessionId || '_default',
      }
      if (!key.projectDir || !key.agentId) {
        return { success: false, error: 'Missing projectDir or agentId' }
      }
      let html: string
      try {
        html = fs.readFileSync(currentHtmlPath(key), 'utf8')
      } catch {
        return { success: true, data: null }
      }
      const meta = readMeta(key)
      return {
        success: true,
        data: { html, title: meta?.title ?? null },
      }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // List version metadata (no html). Sorted ascending by id.
  ipcMain.handle('canvas-list-versions', async (_event, args: any) => {
    try {
      const key: CanvasKey = {
        projectDir: args.projectDir,
        buildingId: args.buildingId || 'default',
        agentId: args.agentId,
        sessionId: args.sessionId || '_default',
      }
      if (!key.projectDir || !key.agentId) {
        return { success: false, error: 'Missing projectDir or agentId' }
      }
      const meta = readMeta(key)
      const files = listVersionFiles(key)
      const versions: VersionEntry[] = files.map((f) => ({
        id: f.id,
        title: meta?.title ?? null, // title is only persisted for the latest write
        timestamp: f.ts,
      }))
      return { success: true, data: versions }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Read a specific version's html.
  ipcMain.handle('canvas-read-version', async (_event, args: any) => {
    try {
      const key: CanvasKey = {
        projectDir: args.projectDir,
        buildingId: args.buildingId || 'default',
        agentId: args.agentId,
        sessionId: args.sessionId || '_default',
      }
      const versionId: number = Number(args.versionId)
      if (!key.projectDir || !key.agentId || !Number.isFinite(versionId)) {
        return { success: false, error: 'Missing projectDir, agentId, or versionId' }
      }
      const files = listVersionFiles(key)
      const match = files.find((f) => f.id === versionId)
      if (!match) return { success: false, error: 'Version not found' }
      const html = fs.readFileSync(path.join(versionsDir(key), match.file), 'utf8')
      return { success: true, data: { html, versionId, timestamp: match.ts } }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Restore a version: copies the version file to current.html. Bumps meta's
  // latestVersionAt so a follow-up write creates a fresh version slot rather
  // than coalescing into the restored one.
  ipcMain.handle('canvas-restore-version', async (_event, args: any) => {
    try {
      const key: CanvasKey = {
        projectDir: args.projectDir,
        buildingId: args.buildingId || 'default',
        agentId: args.agentId,
        sessionId: args.sessionId || '_default',
      }
      const versionId: number = Number(args.versionId)
      if (!key.projectDir || !key.agentId || !Number.isFinite(versionId)) {
        return { success: false, error: 'Missing projectDir, agentId, or versionId' }
      }
      const files = listVersionFiles(key)
      const match = files.find((f) => f.id === versionId)
      if (!match) return { success: false, error: 'Version not found' }
      const html = fs.readFileSync(path.join(versionsDir(key), match.file), 'utf8')
      const meta = readMeta(key)
      writeFileAtomicSync(currentHtmlPath(key), html)
      // Set latestVersionAt to 0 so the next write definitely starts a new slot
      writeMeta(key, {
        title: meta?.title ?? null,
        latestVersionId: meta?.latestVersionId ?? versionId,
        latestVersionAt: 0,
      })
      return { success: true, data: { html, title: meta?.title ?? null } }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Clear a session's canvas (deletes current + versions for this session).
  ipcMain.handle('canvas-clear-disk', async (_event, args: any) => {
    try {
      const key: CanvasKey = {
        projectDir: args.projectDir,
        buildingId: args.buildingId || 'default',
        agentId: args.agentId,
        sessionId: args.sessionId || '_default',
      }
      if (!key.projectDir || !key.agentId) {
        return { success: false, error: 'Missing projectDir or agentId' }
      }
      try {
        fs.rmSync(sessionDir(key), { recursive: true, force: true })
      } catch {
        // Best-effort
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // List all (agentId, sessionId) pairs that have a canvas on disk in this
  // building. Used at boot to hydrate the store.
  ipcMain.handle('canvas-list-all', async (_event, args: any) => {
    try {
      const projectDir: string = args.projectDir
      const buildingId: string = sanitiseSegment(args.buildingId || 'default')
      if (!projectDir) return { success: false, error: 'Missing projectDir' }

      const buildingDir = path.join(projectDir, '.pixelcity', 'canvases', buildingId)
      let agentDirs: string[]
      try {
        agentDirs = fs.readdirSync(buildingDir)
      } catch {
        return { success: true, data: [] }
      }

      const out: Array<{ agentId: string; sessionId: string; title: string | null }> = []
      for (const agentId of agentDirs) {
        const sessionsRoot = path.join(buildingDir, agentId, 'sessions')
        let sessions: string[]
        try { sessions = fs.readdirSync(sessionsRoot) } catch { continue }
        for (const sessionId of sessions) {
          const cur = path.join(sessionsRoot, sessionId, 'current.html')
          if (!fs.existsSync(cur)) continue
          const meta = readMeta({ projectDir, buildingId, agentId, sessionId })
          out.push({ agentId, sessionId, title: meta?.title ?? null })
        }
      }
      return { success: true, data: out }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}
