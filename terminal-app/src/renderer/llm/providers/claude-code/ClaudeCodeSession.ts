// ── Claude Code Session ─────────────────────────────────────────────
// Implements LLMSession by wrapping a Claude Code CLI PTY process
// and a JSONL transcript watcher. The PTY provides raw terminal output
// for xterm rendering; the JSONL watcher emits normalized LLMEvents.

import type { LLMSession } from '../../LLMSession.js'
import type {
  LLMCapabilities,
  LLMEventCallback,
  RawOutputCallback,
  ExitCallback,
  ProviderId,
  LLMSessionConfig,
} from '../../types.js'
import { JsonlWatcher } from './jsonlParser.js'
import { platform } from '../../../platform/index.js'

/** Capabilities for the Claude Code PTY provider */
const CLAUDE_CODE_CAPABILITIES: LLMCapabilities = {
  hasTerminal: true,
  hasToolUse: true,
  hasSubagents: true,
  hasStreaming: true,
  hasJsonlLog: true,
  preferredRenderer: 'terminal',
}

export interface ClaudeCodeSessionOptions {
  /** The PTY process ID returned by pty-create */
  ptyId: number
  /** Session ID (used to locate the JSONL file) */
  sessionId: string
  /** Project directory hash for JSONL path resolution */
  projectHash: string
  /** Full JSONL file path */
  jsonlPath: string
}

export class ClaudeCodeSession implements LLMSession {
  readonly providerId: ProviderId = 'claude-code'
  readonly capabilities = CLAUDE_CODE_CAPABILITIES
  readonly sessionId: string
  readonly ptyId: number

  private _alive = true
  private outputCallbacks: RawOutputCallback[] = []
  private eventCallbacks: LLMEventCallback[] = []
  private exitCallbacks: ExitCallback[] = []
  private jsonlWatcher: JsonlWatcher
  private _unsubOutput: (() => void) | null = null
  private _unsubExit: (() => void) | null = null

  constructor(options: ClaudeCodeSessionOptions) {
    this.sessionId = options.sessionId
    this.ptyId = options.ptyId

    // Set up JSONL watcher for normalized events
    this.jsonlWatcher = new JsonlWatcher(options.jsonlPath)
    this.jsonlWatcher.onEvent((event) => {
      for (const cb of this.eventCallbacks) cb(event)
    })
    this.jsonlWatcher.start()

    // Listen for PTY output (raw terminal data for xterm)
    this._unsubOutput = platform().pty.onOutput(this.ptyId, (data) => {
      for (const cb of this.outputCallbacks) cb(data)
    })

    // Listen for PTY exit
    this._unsubExit = platform().pty.onExit(this.ptyId, (exitCode) => {
      this._alive = false
      for (const cb of this.exitCallbacks) cb(exitCode)
      this.cleanup()
    })
  }

  // ── Output Streams ──────────────────────────────────────────────

  onOutput(callback: RawOutputCallback): void {
    this.outputCallbacks.push(callback)
  }

  onEvent(callback: LLMEventCallback): void {
    this.eventCallbacks.push(callback)
  }

  onExit(callback: ExitCallback): void {
    this.exitCallbacks.push(callback)
  }

  // ── Input ───────────────────────────────────────────────────────

  sendInput(data: string): void {
    if (!this._alive) return
    platform().pty.input(this.ptyId, data)
  }

  // ── Terminal Control ────────────────────────────────────────────

  resize(cols: number, rows: number): void {
    if (!this._alive) return
    platform().pty.resize(this.ptyId, cols, rows)
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  kill(): void {
    if (!this._alive) return
    this._alive = false
    platform().pty.kill(this.ptyId)
    this.cleanup()
  }

  isAlive(): boolean {
    return this._alive
  }

  private cleanup(): void {
    this.jsonlWatcher.destroy()
    if (this._unsubOutput) {
      this._unsubOutput()
      this._unsubOutput = null
    }
    if (this._unsubExit) {
      this._unsubExit()
      this._unsubExit = null
    }
  }
}
