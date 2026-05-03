// ── Claude Code Session Index ──────────────────────────────────────
// Project-local index that augments raw JSONL transcripts with the
// metadata Claude itself doesn't know — which Pixel City agent owned
// the session, what model it ran on, and an optional human label.
//
// File: <cwd>/.pixelcity/claude-sessions.json
// Acts as a HINT: the JSONL on disk is source of truth for content;
// the index just answers "who spawned this session and as what agent".

const fs = window.require('fs') as typeof import('fs')
const path = window.require('path') as typeof import('path')

export interface ClaudeSessionMeta {
  /** Pixel City agent ID at spawn time */
  agentId: string
  /** Display name of the agent (e.g. "CTO", "Pixel Knight") */
  agentName: string
  /** Resolved model ID (e.g. 'claude-sonnet-4-6') */
  modelId: string
  /** Optional human-edited label */
  label?: string
  /** ISO timestamp when this session was first spawned */
  spawnedAt: string
}

interface IndexFile {
  /** Schema version for forward-compat */
  version: 1
  /** sessionId → metadata */
  sessions: Record<string, ClaudeSessionMeta>
}

const INDEX_DIR = '.pixelcity'
const INDEX_FILE = 'claude-sessions.json'

function indexPath(cwd: string): string {
  return path.join(cwd, INDEX_DIR, INDEX_FILE)
}

function readIndexFile(cwd: string): IndexFile {
  try {
    const raw = fs.readFileSync(indexPath(cwd), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && parsed.sessions) {
      return { version: 1, sessions: parsed.sessions }
    }
  } catch {
    // Missing or malformed — fall through to empty index
  }
  return { version: 1, sessions: {} }
}

function writeIndexFile(cwd: string, data: IndexFile): void {
  const dir = path.join(cwd, INDEX_DIR)
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    // mkdir errors fall through; writeFile will surface real failures
  }
  fs.writeFileSync(indexPath(cwd), JSON.stringify(data, null, 2), 'utf8')
}

/** Record a freshly-spawned session in the project index. Best-effort. */
export function recordClaudeSessionSpawn(
  cwd: string,
  sessionId: string,
  meta: ClaudeSessionMeta,
): void {
  try {
    const index = readIndexFile(cwd)
    index.sessions[sessionId] = meta
    writeIndexFile(cwd, index)
  } catch {
    // Index is a hint — never block session spawn on it
  }
}

/** Return all known session metadata for the project. */
export function readClaudeSessionIndex(cwd: string): Record<string, ClaudeSessionMeta> {
  return readIndexFile(cwd).sessions
}

/** Look up metadata for a single session, or null if not indexed. */
export function getClaudeSessionMeta(
  cwd: string,
  sessionId: string,
): ClaudeSessionMeta | null {
  return readIndexFile(cwd).sessions[sessionId] ?? null
}

/** Update the human label for a session. Creates entry if missing. */
export function setClaudeSessionLabel(
  cwd: string,
  sessionId: string,
  label: string,
): void {
  try {
    const index = readIndexFile(cwd)
    const existing = index.sessions[sessionId]
    if (existing) {
      existing.label = label
    } else {
      // Index entry doesn't exist yet (e.g. session pre-dates the index)
      // Write a minimal stub so the label survives.
      index.sessions[sessionId] = {
        agentId: '',
        agentName: '',
        modelId: '',
        label,
        spawnedAt: new Date().toISOString(),
      }
    }
    writeIndexFile(cwd, index)
  } catch {
    // Best-effort
  }
}
