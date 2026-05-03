// ── Codex CLI Session List Reader ───────────────────────────────────
// Reads rollout JSONLs from this project's CODEX_HOME and returns
// per-session metadata for the chooser.
//
// CodexCliProvider sets CODEX_HOME=<cwd>/.pixelcity/codex, so all
// sessions are project-local at <cwd>/.pixelcity/codex/sessions/YYYY/MM/DD/
// rollout-<TS>-<UUID>.jsonl. The session UUID is the trailing UUIDv7
// portion of the filename — Codex never accepts a --session-id flag
// (server-minted), but the filename surfaces it after creation.

const fs = window.require('fs') as typeof import('fs')
const path = window.require('path') as typeof import('path')

export interface CodexSessionSummary {
  /** Session UUID (UUIDv7 minted by Codex server, parsed from filename) */
  sessionId: string
  /** Absolute path to the rollout JSONL */
  jsonlPath: string
  /** mtime in ms — sort key for "most recent" ordering */
  mtimeMs: number
  /** Number of agent turns in the rollout */
  turnCount: number
  /** Last real user message, truncated to PREVIEW_MAX */
  preview: string
  /** ISO timestamp of session_meta.payload.timestamp (session start) */
  startedAt?: string
}

const PREVIEW_MAX = 120

/** Project-local sessions root (matches CODEX_HOME/sessions). */
function sessionsDir(cwd: string): string {
  return path.join(cwd, '.pixelcity', 'codex', 'sessions')
}

/**
 * Filename: rollout-<DATE>T<HH-MM-SS>-<UUIDv7>.jsonl
 * UUID is the LAST 5 hyphen-separated groups (8-4-4-4-12).
 */
const UUID_TAIL = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i

function extractSessionIdFromFilename(filename: string): string | null {
  const m = filename.match(UUID_TAIL)
  return m ? m[1] : null
}

/** Codex auto-injects AGENTS.md and environment_context as user messages. Skip them. */
function isAutoInjectedUserText(text: string): boolean {
  return (
    text.startsWith('# AGENTS.md instructions for') ||
    text.startsWith('<environment_context>') ||
    text.startsWith('<user_instructions>') ||
    text.startsWith('<command-') ||
    text.startsWith('<local-command-')
  )
}

/** Pull plain user prompt text from a response_item record, or null if not a real user message. */
function extractRealUserText(record: any): string | null {
  if (record?.type !== 'response_item') return null
  const payload = record.payload
  if (!payload || payload.type !== 'message' || payload.role !== 'user') return null
  const content = payload.content
  if (!Array.isArray(content)) return null
  let text = ''
  for (const block of content) {
    if (block?.type === 'input_text' && typeof block.text === 'string') {
      text += block.text
    }
  }
  text = text.trim()
  if (!text) return null
  if (isAutoInjectedUserText(text)) return null
  return text
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1).trimEnd() + '…'
}

function readSummary(jsonlPath: string, sessionId: string): CodexSessionSummary | null {
  let stat
  try {
    stat = fs.statSync(jsonlPath)
  } catch {
    return null
  }
  if (!stat.isFile() || stat.size === 0) return null

  let raw: string
  try {
    raw = fs.readFileSync(jsonlPath, 'utf8')
  } catch {
    return null
  }

  let firstUser: string | null = null
  let lastUser: string | null = null
  let startedAt: string | undefined
  let turnCount = 0
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let record: any
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (!startedAt) {
      if (record.type === 'session_meta' && typeof record.payload?.timestamp === 'string') {
        startedAt = record.payload.timestamp
      } else if (typeof record.timestamp === 'string') {
        startedAt = record.timestamp
      }
    }
    // task_started is the cleanest "one turn" signal in Codex rollouts
    if (record.type === 'event_msg' && record.payload?.type === 'task_started') {
      turnCount += 1
      continue
    }
    const userText = extractRealUserText(record)
    if (userText) {
      if (firstUser == null) firstUser = userText
      lastUser = userText
    }
  }

  // Match Claude chooser's preference: latest user message ≈ "where did I leave off"
  const previewSource = lastUser ?? firstUser
  return {
    sessionId,
    jsonlPath,
    mtimeMs: stat.mtimeMs,
    turnCount,
    preview: previewSource ? truncate(previewSource, PREVIEW_MAX) : '(no prompt)',
    startedAt,
  }
}

/** Walk the YYYY/MM/DD partitions and collect rollout file paths. */
function walkRollouts(dir: string): string[] {
  const out: string[] = []
  let yearDirs: string[]
  try {
    yearDirs = fs.readdirSync(dir)
  } catch {
    return out
  }
  for (const y of yearDirs) {
    const yPath = path.join(dir, y)
    let monthDirs: string[]
    try {
      monthDirs = fs.readdirSync(yPath)
    } catch {
      continue
    }
    for (const m of monthDirs) {
      const mPath = path.join(yPath, m)
      let dayDirs: string[]
      try {
        dayDirs = fs.readdirSync(mPath)
      } catch {
        continue
      }
      for (const d of dayDirs) {
        const dPath = path.join(mPath, d)
        let files: string[]
        try {
          files = fs.readdirSync(dPath)
        } catch {
          continue
        }
        for (const f of files) {
          if (f.startsWith('rollout-') && f.endsWith('.jsonl')) {
            out.push(path.join(dPath, f))
          }
        }
      }
    }
  }
  return out
}

/**
 * List all Codex sessions in this project, newest first. Returns empty
 * when CODEX_HOME has no rollouts yet (fresh project).
 */
export function listCodexSessions(cwd: string): CodexSessionSummary[] {
  const dir = sessionsDir(cwd)
  const files = walkRollouts(dir)
  const summaries: CodexSessionSummary[] = []
  for (const file of files) {
    const sessionId = extractSessionIdFromFilename(path.basename(file))
    if (!sessionId) continue
    const summary = readSummary(file, sessionId)
    if (summary && summary.turnCount > 0) summaries.push(summary)
  }
  summaries.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return summaries
}

/** Snapshot the set of session IDs currently on disk, for post-spawn diff. */
export function snapshotCodexSessionIds(cwd: string): Set<string> {
  const dir = sessionsDir(cwd)
  const files = walkRollouts(dir)
  const ids = new Set<string>()
  for (const file of files) {
    const id = extractSessionIdFromFilename(path.basename(file))
    if (id) ids.add(id)
  }
  return ids
}
