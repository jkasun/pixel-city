// ── Codex CLI Session Index ────────────────────────────────────────
// Project-local hint mapping Codex's server-minted session UUIDs to
// the Pixel City agent that spawned each session.
//
// File: <cwd>/.pixelcity/codex-sessions.json
// (deliberately placed at .pixelcity/, NOT inside .pixelcity/codex/,
// because that subtree is CODEX_HOME and Codex may scrub it.)
//
// Why this exists, given CODEX_HOME is already project-scoped: rollouts
// in <cwd>/.pixelcity/codex/sessions/ are all from this project, but
// the chooser still needs to filter "this agent's past chats" — and
// Codex doesn't carry our agent metadata. The index supplies it.
//
// CRITICAL DIFFERENCE vs Claude index: Codex mints session IDs after
// spawn (server-side), not before. We can't write the entry at spawn
// time — we have to observe the new rollout file appearing and claim
// it. `claimNextCodexSession` polls the sessions dir, diffs against a
// pre-spawn snapshot, and writes the meta when a new ID surfaces.

import { snapshotCodexSessionIds } from './sessionList.js'

const fs = window.require('fs') as typeof import('fs')
const path = window.require('path') as typeof import('path')

export interface CodexSessionMeta {
  /** Pixel City agent ID at spawn time */
  agentId: string
  /** Display name of the agent (stable filter key for permanent employees) */
  agentName: string
  /** Resolved Codex model ID (e.g. 'gpt-5.5') */
  modelId: string
  /** Optional human-edited label */
  label?: string
  /** ISO timestamp when this session was first spawned */
  spawnedAt: string
}

interface IndexFile {
  version: 1
  sessions: Record<string, CodexSessionMeta>
}

const INDEX_DIR = '.pixelcity'
const INDEX_FILE = 'codex-sessions.json'

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

export interface ClaimOptions {
  /** Wait this long before the first poll. Codex needs to write the rollout. */
  initialDelayMs?: number
  /** Give up after this much time has passed since the spawn. */
  maxWaitMs?: number
  /** Poll interval after the initial delay. */
  pollIntervalMs?: number
}

/**
 * After a Codex spawn, observe the rollout dir for a new session ID and
 * record it. `priorIds` is the snapshot taken just before spawn. The
 * first new ID found is claimed for `meta`. Already-indexed entries are
 * never overwritten — this protects parallel spawns from clobbering
 * each other's metadata if a later poll happens to see both new files.
 *
 * Best-effort: silently gives up after maxWaitMs.
 */
export function claimNextCodexSession(
  cwd: string,
  priorIds: Set<string>,
  meta: CodexSessionMeta,
  options: ClaimOptions = {},
): void {
  const initialDelay = options.initialDelayMs ?? 1500
  const maxWait = options.maxWaitMs ?? 15000
  const pollInterval = options.pollIntervalMs ?? 1000
  const start = Date.now()

  const tick = (): void => {
    try {
      const currentIds = snapshotCodexSessionIds(cwd)
      const newIds: string[] = []
      for (const id of currentIds) if (!priorIds.has(id)) newIds.push(id)

      if (newIds.length > 0) {
        const index = readIndexFile(cwd)
        let changed = false
        for (const id of newIds) {
          // First-claim wins. If a parallel spawn already claimed this
          // ID with its own meta, leave it alone (the worst outcome is
          // an unindexed session, not a wrong one).
          if (!index.sessions[id]) {
            index.sessions[id] = meta
            changed = true
          }
        }
        if (changed) writeIndexFile(cwd, index)
        return
      }
    } catch {
      // HINT layer — continue retrying within the deadline
    }
    if (Date.now() - start < maxWait) {
      setTimeout(tick, pollInterval)
    }
  }
  setTimeout(tick, initialDelay)
}

/** Return all known Codex session metadata for the project. */
export function readCodexSessionIndex(cwd: string): Record<string, CodexSessionMeta> {
  return readIndexFile(cwd).sessions
}

/** Look up metadata for a single session, or null if not indexed. */
export function getCodexSessionMeta(cwd: string, sessionId: string): CodexSessionMeta | null {
  return readIndexFile(cwd).sessions[sessionId] ?? null
}

/** Update the human label for a session. Creates a stub if missing. */
export function setCodexSessionLabel(cwd: string, sessionId: string, label: string): void {
  try {
    const index = readIndexFile(cwd)
    const existing = index.sessions[sessionId]
    if (existing) {
      existing.label = label
    } else {
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
