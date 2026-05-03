// ── Claude Code JSONL Parser ────────────────────────────────────────
// Parses Claude Code session JSONL transcripts and emits normalized
// LLMEvents. Extracted from useJsonlWatch.ts into a non-React utility
// so it can be used by ClaudeCodeSession without React dependencies.

import type {
  LLMEvent,
  LLMEventCallback,
  LLMToolUseEvent,
  LLMToolResultEvent,
  LLMTurnEndEvent,
  LLMSubagentSpawnEvent,
  LLMTokenUsageEvent,
  LLMStatusEvent,
  LLMThinkingEvent,
  LLMTextEvent,
} from '../../types.js'
import { formatEventStatus } from '../../formatStatus.js'

const fs = window.require('fs') as typeof import('fs')
const path = window.require('path') as typeof import('path')

/** Tool names that spawn sub-agents in Claude Code */
const SUBAGENT_TOOL_NAMES = new Set(['Agent', 'Task'])

// ── Subagent tracking ───────────────────────────────────────────────

/** How often to poll the subagents directory for new files (ms) */
const SUBAGENT_DIR_POLL_MS = 1500
/** How often to poll individual subagent JSONL files for completion (ms) */
const SUBAGENT_FILE_POLL_MS = 2000
/** Safety-net timeout: if JSONL stops growing and no end_turn is found, despawn after this (ms) */
const SUBAGENT_IDLE_SAFETY_NET_MS = 120_000
/** After seeing end_turn, wait this long for any trailing writes before despawning (ms) */
const SUBAGENT_END_TURN_GRACE_MS = 4000

interface SubagentWatcher {
  toolUseId: string
  pollInterval: ReturnType<typeof setInterval> | null
  jsonlPath: string | null
  lastSize: number
  lastSizeChange: number
  fileOffset: number
  lineBuffer: string
  sawEndTurn: boolean
}

// ── JSONL Line Parser (pure function) ───────────────────────────────

/**
 * Parse a single JSONL line from a Claude Code transcript into LLMEvents.
 * Returns an array because one JSONL record can produce multiple events
 * (e.g., an assistant message with multiple tool_use blocks).
 */
export function parseJsonlLine(line: string): LLMEvent[] {
  const events: LLMEvent[] = []
  try {
    const record = JSON.parse(line)

    if (record.type === 'assistant' && Array.isArray(record.message?.content)) {
      // Token usage
      const outputTokens = record.message?.usage?.output_tokens as number | undefined
      if (outputTokens != null && outputTokens > 0) {
        events.push({ type: 'token_usage', outputTokens } satisfies LLMTokenUsageEvent)
      }

      const blocks = record.message.content as Array<{
        type: string
        id?: string
        name?: string
        input?: Record<string, unknown>
        text?: string
      }>

      for (const block of blocks) {
        if (block.type === 'tool_use' && block.id && block.name) {
          const toolEvent: LLMToolUseEvent = {
            type: 'tool_use',
            toolUseId: block.id,
            toolName: block.name,
            input: block.input ?? {},
          }
          events.push(toolEvent)

          // Subagent spawn detection
          if (SUBAGENT_TOOL_NAMES.has(block.name)) {
            const desc = (block.input as Record<string, unknown>)?.description as string | undefined
            events.push({
              type: 'subagent_spawn',
              toolUseId: block.id,
              description: desc,
            } satisfies LLMSubagentSpawnEvent)
          }

          // Emit a status event for the tool
          const statusText = formatEventStatus(toolEvent)
          if (statusText) {
            events.push({ type: 'status', text: statusText } satisfies LLMStatusEvent)
          }
        } else if (block.type === 'text' && block.text) {
          events.push({ type: 'text', text: block.text } satisfies LLMTextEvent)
        } else if (block.type === 'thinking' && block.text) {
          events.push({ type: 'thinking', text: block.text } satisfies LLMThinkingEvent)
        }
      }
    } else if (record.type === 'user') {
      const content = record.message?.content
      if (Array.isArray(content)) {
        for (const block of content as Array<{ type: string; tool_use_id?: string }>) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            events.push({
              type: 'tool_result',
              toolUseId: block.tool_use_id,
            } satisfies LLMToolResultEvent)
          }
        }
      }
    } else if (record.type === 'system' && record.subtype === 'turn_duration') {
      events.push({
        type: 'turn_end',
        durationMs: record.durationMs as number | undefined,
      } satisfies LLMTurnEndEvent)
    } else if (record.type === 'progress') {
      const dataType = record.data?.type as string | undefined
      if (dataType === 'query_update' && record.data?.query) {
        const q: string = record.data.query
        const label = `Searching: ${q.length > 40 ? q.slice(0, 40) + '\u2026' : q}`
        events.push({ type: 'status', text: label } satisfies LLMStatusEvent)
      }
    }
  } catch { /* ignore malformed lines */ }
  return events
}

// ── JSONL File Watcher (encapsulates polling) ───────────────────────

/**
 * Watches a Claude Code JSONL session file and emits LLMEvents as new
 * lines are written. Also tracks subagent JSONL files for spawn/complete.
 */
export class JsonlWatcher {
  private jsonlPath: string
  private fileOffset = 0
  private lineBuffer = ''
  private fsWatcher: ReturnType<typeof import('fs').watch> | null = null
  private existencePoller: ReturnType<typeof setInterval> | null = null
  private pollInterval: ReturnType<typeof setInterval> | null = null
  private eventCallback: LLMEventCallback | null = null
  private destroyed = false

  // Subagent tracking
  private subagentWatchers = new Map<string, SubagentWatcher>()
  private subagentDirPoller: ReturnType<typeof setInterval> | null = null
  private knownSubagentFiles = new Set<string>()
  private pendingSubagentToolIds: string[] = []

  constructor(jsonlPath: string) {
    this.jsonlPath = jsonlPath
  }

  /** Register the event callback. Must be called before start(). */
  onEvent(callback: LLMEventCallback): void {
    this.eventCallback = callback
  }

  /** Start watching the JSONL file. */
  start(): void {
    const beginWatching = () => {
      if (this.destroyed) return
      this.readNewLines()
      try {
        this.fsWatcher = fs.watch(this.jsonlPath, () => this.readNewLines())
      } catch { /* ignore watch errors */ }
      this.pollInterval = setInterval(() => this.readNewLines(), 2000)
    }

    try {
      fs.statSync(this.jsonlPath)
      beginWatching()
    } catch {
      // File doesn't exist yet — poll for its creation
      this.existencePoller = setInterval(() => {
        if (this.destroyed) return
        try {
          fs.statSync(this.jsonlPath)
          clearInterval(this.existencePoller!)
          this.existencePoller = null
          beginWatching()
        } catch { /* still doesn't exist */ }
      }, 1000)
    }
  }

  /** Stop watching and clean up all resources. */
  destroy(): void {
    this.destroyed = true
    if (this.existencePoller) clearInterval(this.existencePoller)
    if (this.pollInterval) clearInterval(this.pollInterval)
    if (this.fsWatcher) try { this.fsWatcher.close() } catch { /* ignore */ }
    if (this.subagentDirPoller) clearInterval(this.subagentDirPoller)
    for (const w of this.subagentWatchers.values()) {
      if (w.pollInterval) clearInterval(w.pollInterval)
    }
    this.subagentWatchers.clear()
  }

  /** Read new bytes from the JSONL file and emit events. */
  private readNewLines(): void {
    if (this.destroyed) return
    try {
      const stat = fs.statSync(this.jsonlPath)
      if (stat.size <= this.fileOffset) return
      const length = stat.size - this.fileOffset
      const buf = Buffer.alloc(length)
      const fd = fs.openSync(this.jsonlPath, 'r')
      fs.readSync(fd, buf, 0, length, this.fileOffset)
      fs.closeSync(fd)
      this.fileOffset += length
      const text = this.lineBuffer + buf.toString('utf8')
      const lines = text.split('\n')
      this.lineBuffer = lines.pop() ?? ''
      for (const ln of lines) {
        if (!ln.trim()) continue
        const events = parseJsonlLine(ln)
        for (const event of events) {
          this.emit(event)
          // Track subagent spawns for file-based completion detection
          if (event.type === 'subagent_spawn') {
            this.trackSubagentSpawn(event.toolUseId)
          }
        }
      }
    } catch { /* file not yet created or read error */ }
  }

  private emit(event: LLMEvent): void {
    if (this.eventCallback) this.eventCallback(event)
  }

  // ── Subagent File Tracking ──────────────────────────────────────

  private getSubagentsDir(): string {
    const dir = this.jsonlPath.replace(/\.jsonl$/, '')
    return path.join(dir, 'subagents')
  }

  private trackSubagentSpawn(toolUseId: string): void {
    if (this.subagentWatchers.has(toolUseId)) return

    const watcher: SubagentWatcher = {
      toolUseId,
      pollInterval: null,
      jsonlPath: null,
      lastSize: 0,
      lastSizeChange: Date.now(),
      fileOffset: 0,
      lineBuffer: '',
      sawEndTurn: false,
    }
    this.subagentWatchers.set(toolUseId, watcher)
    this.pendingSubagentToolIds.push(toolUseId)
    this.ensureSubagentDirPolling()
  }

  private ensureSubagentDirPolling(): void {
    if (this.subagentDirPoller) {
      // Already polling — do an immediate check
      this.pollSubagentsDir()
      return
    }
    this.subagentDirPoller = setInterval(() => this.pollSubagentsDir(), SUBAGENT_DIR_POLL_MS)
    this.pollSubagentsDir()
  }

  private pollSubagentsDir(): void {
    if (this.destroyed) return
    const dir = this.getSubagentsDir()
    try {
      const files = fs.readdirSync(dir).filter((f: string) => f.endsWith('.jsonl') && !f.includes('compact'))
      for (const file of files) {
        if (this.knownSubagentFiles.has(file)) continue
        if (this.pendingSubagentToolIds.length > 0) {
          this.knownSubagentFiles.add(file)
          const toolUseId = this.pendingSubagentToolIds.shift()!
          const watcher = this.subagentWatchers.get(toolUseId)
          if (watcher && !watcher.jsonlPath) {
            this.watchSubagentFile(watcher, path.join(dir, file))
          }
        }
      }
    } catch { /* directory doesn't exist yet */ }
  }

  private watchSubagentFile(watcher: SubagentWatcher, filePath: string): void {
    watcher.jsonlPath = filePath
    watcher.fileOffset = 0
    watcher.lineBuffer = ''
    try {
      const stat = fs.statSync(filePath)
      watcher.lastSize = stat.size
      watcher.lastSizeChange = Date.now()
    } catch {
      watcher.lastSize = 0
      watcher.lastSizeChange = Date.now()
    }

    watcher.pollInterval = setInterval(() => {
      if (this.destroyed) {
        if (watcher.pollInterval) clearInterval(watcher.pollInterval)
        return
      }
      try {
        const stat = fs.statSync(filePath)
        if (stat.size !== watcher.lastSize) {
          watcher.lastSize = stat.size
          watcher.lastSizeChange = Date.now()
        }

        // Read new content and scan for end_turn
        if (stat.size > watcher.fileOffset) {
          const length = stat.size - watcher.fileOffset
          const buf = Buffer.alloc(length)
          const fd = fs.openSync(filePath, 'r')
          fs.readSync(fd, buf, 0, length, watcher.fileOffset)
          fs.closeSync(fd)
          watcher.fileOffset += length
          const text = watcher.lineBuffer + buf.toString('utf8')
          const lines = text.split('\n')
          watcher.lineBuffer = lines.pop() ?? ''
          for (const ln of lines) {
            if (!ln.trim()) continue
            try {
              const record = JSON.parse(ln)
              if (record.type === 'assistant' && record.message?.stop_reason === 'end_turn') {
                watcher.sawEndTurn = true
                watcher.lastSizeChange = Date.now()
              }
            } catch { /* ignore malformed */ }
          }
        }

        // Check lineBuffer for end_turn (last line without trailing newline)
        if (!watcher.sawEndTurn && watcher.lineBuffer.trim() && stat.size <= watcher.fileOffset) {
          try {
            const record = JSON.parse(watcher.lineBuffer)
            if (record.type === 'assistant' && record.message?.stop_reason === 'end_turn') {
              watcher.sawEndTurn = true
              watcher.lastSizeChange = Date.now()
              watcher.lineBuffer = ''
            }
          } catch { /* incomplete line */ }
        }

        // Despawn check
        if (stat.size === watcher.lastSize) {
          const idleMs = Date.now() - watcher.lastSizeChange
          if (watcher.sawEndTurn && idleMs >= SUBAGENT_END_TURN_GRACE_MS) {
            this.completeSubagent(watcher.toolUseId)
          } else if (!watcher.sawEndTurn && idleMs >= SUBAGENT_IDLE_SAFETY_NET_MS) {
            this.completeSubagent(watcher.toolUseId)
          }
        }
      } catch {
        // File gone — subagent done
        this.completeSubagent(watcher.toolUseId)
      }
    }, SUBAGENT_FILE_POLL_MS)
  }

  private completeSubagent(toolUseId: string): void {
    const watcher = this.subagentWatchers.get(toolUseId)
    if (!watcher) return
    if (watcher.pollInterval) clearInterval(watcher.pollInterval)
    this.subagentWatchers.delete(toolUseId)
    this.emit({ type: 'subagent_complete', toolUseId })
  }
}
