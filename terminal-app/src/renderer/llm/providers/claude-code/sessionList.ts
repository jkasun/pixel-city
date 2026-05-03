// ── Claude Code Session List Reader ────────────────────────────────
// Reads ~/.claude/projects/{projectHash}/*.jsonl and returns metadata
// about each past session in this project — used by the chooser UI to
// show "resume previous chat" cards.

const fs = window.require('fs') as typeof import('fs')
const path = window.require('path') as typeof import('path')
const osModule = window.require('os') as typeof import('os')

/**
 * Compute Claude Code's project-folder name from a cwd.
 *
 * Claude replaces `/`, `\`, `:`, AND `.` with `-` when naming the
 * `~/.claude/projects/<folder>` directory. Pixel-City has its own
 * `computeProjectHash` that does NOT replace dots — so for a home
 * dir like `/Users/jane.doe/...` it produces a path that
 * doesn't exist. We do our own transform here to talk to Claude's
 * filesystem layout correctly.
 */
export function claudeProjectFolder(cwd: string): string {
  return cwd.replace(/[:/\\.]/g, '-')
}

export interface ClaudeSessionSummary {
  /** Session UUID — the JSONL filename minus .jsonl */
  sessionId: string
  /** Absolute path to the JSONL transcript */
  jsonlPath: string
  /** mtime in ms — sort key for "most recent" ordering */
  mtimeMs: number
  /** Number of assistant turns in the transcript */
  turnCount: number
  /** First non-meta user message, truncated to ~120 chars */
  preview: string
  /** ISO timestamp of the first record (session start) */
  startedAt?: string
}

const PREVIEW_MAX = 120

function projectDir(cwd: string): string {
  return path.join(osModule.homedir(), '.claude', 'projects', claudeProjectFolder(cwd))
}

/** Decide whether a user-record's content is a "real" prompt (vs slash command, tool result, meta caveat). */
function extractRealUserText(record: any): string | null {
  if (record.isMeta || record.isSidechain) return null
  const content = record.message?.content
  let text = ''
  if (typeof content === 'string') {
    text = content
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        text += block.text
      } else if (block?.type === 'tool_result') {
        return null // tool result records are not user prompts
      }
    }
  }
  text = text.trim()
  if (!text) return null
  if (text.startsWith('<command-') || text.startsWith('<local-command-')) return null
  // /compact injects a continuation message that looks like user input but
  // isn't anything the user typed. Skip it.
  if (text.startsWith('This session is being continued from a previous conversation')) return null
  return text
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1).trimEnd() + '…'
}

function readSummary(jsonlPath: string, sessionId: string): ClaudeSessionSummary | null {
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
  const lines = raw.split('\n')
  for (const line of lines) {
    if (!line.trim()) continue
    let record: any
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (record.isSidechain) continue
    if (!startedAt && typeof record.timestamp === 'string') {
      startedAt = record.timestamp
    }
    if (record.type === 'assistant' && Array.isArray(record.message?.content)) {
      // Count only turns with real text/tool content (skip empty assistant frames)
      const blocks = record.message.content
      const hasContent = blocks.some(
        (b: any) => (b?.type === 'text' && b.text) || b?.type === 'tool_use' || b?.type === 'thinking',
      )
      if (hasContent) turnCount += 1
    } else if (record.type === 'user') {
      const text = extractRealUserText(record)
      if (text) {
        if (firstUser == null) firstUser = text
        lastUser = text
      }
    }
  }

  // Prefer the most recent thing the user actually typed — that's the closest
  // signal to "where did I leave off." Fall back to first user prompt for
  // single-turn sessions where last == first.
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

/**
 * List all Claude Code sessions for the given project cwd, newest first.
 * Returns an empty array if the project has no transcripts yet.
 */
export function listClaudeSessions(cwd: string): ClaudeSessionSummary[] {
  const dir = projectDir(cwd)
  let files: string[]
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
  } catch {
    return []
  }
  const summaries: ClaudeSessionSummary[] = []
  for (const file of files) {
    const sessionId = file.replace(/\.jsonl$/, '')
    const summary = readSummary(path.join(dir, file), sessionId)
    if (summary && summary.turnCount > 0) summaries.push(summary)
  }
  summaries.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return summaries
}

/** Return a single session's summary by ID, or null if not found. */
export function readClaudeSession(cwd: string, sessionId: string): ClaudeSessionSummary | null {
  const jsonlPath = path.join(projectDir(cwd), `${sessionId}.jsonl`)
  return readSummary(jsonlPath, sessionId)
}
