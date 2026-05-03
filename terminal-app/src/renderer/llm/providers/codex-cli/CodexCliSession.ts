// ── Codex CLI Session ────────────────────────────────────────────────
// Implements LLMSession by wrapping a Codex CLI PTY process.
// The PTY provides raw terminal output for xterm rendering.
// No JSONL transcript watcher — Codex writes session rollouts under
// ~/.codex/sessions/ but does not accept a --session-id flag, so
// pre-computing the path is not reliable. Status must be self-reported
// by the agent via MCP tool calls.

import type { LLMSession } from '../../LLMSession.js'
import type {
  LLMCapabilities,
  LLMEventCallback,
  RawOutputCallback,
  ExitCallback,
  ProviderId,
} from '../../types.js'
import { platform } from '../../../platform/index.js'
import { stripPixelCitySection } from './agentsMd.js'

const fs = window.require('fs') as typeof import('fs')
const path = window.require('path') as typeof import('path')

const CODEX_CLI_CAPABILITIES: LLMCapabilities = {
  hasTerminal: true,
  hasToolUse: true,
  hasSubagents: false,
  hasStreaming: true,
  hasJsonlLog: false,
  preferredRenderer: 'terminal',
}

export interface CodexCliSessionOptions {
  ptyId: number
  sessionId: string
  cwd?: string
  /** Whether AGENTS.md existed in cwd before we injected our section. If false
   * and the post-strip content is empty, cleanup unlinks the file we created. */
  agentsMdExisted?: boolean
}

export class CodexCliSession implements LLMSession {
  readonly providerId: ProviderId = 'codex-cli'
  readonly capabilities = CODEX_CLI_CAPABILITIES
  readonly sessionId: string
  readonly ptyId: number

  private _alive = true
  private outputCallbacks: RawOutputCallback[] = []
  private eventCallbacks: LLMEventCallback[] = []
  private exitCallbacks: ExitCallback[] = []
  private _unsubOutput: (() => void) | null = null
  private _unsubExit: (() => void) | null = null

  private readonly cwd?: string
  private readonly agentsMdExisted: boolean

  constructor(options: CodexCliSessionOptions) {
    this.sessionId = options.sessionId
    this.ptyId = options.ptyId
    this.cwd = options.cwd
    this.agentsMdExisted = options.agentsMdExisted ?? false

    this._unsubOutput = platform().pty.onOutput(this.ptyId, (data) => {
      for (const cb of this.outputCallbacks) cb(data)
    })

    this._unsubExit = platform().pty.onExit(this.ptyId, (exitCode) => {
      this._alive = false
      for (const cb of this.exitCallbacks) cb(exitCode)
      this.cleanup()
    })
  }

  onOutput(callback: RawOutputCallback): void {
    this.outputCallbacks.push(callback)
  }

  onEvent(callback: LLMEventCallback): void {
    // Codex CLI does not emit structured events we watch — registered for interface compliance
    this.eventCallbacks.push(callback)
  }

  onExit(callback: ExitCallback): void {
    this.exitCallbacks.push(callback)
  }

  sendInput(data: string): void {
    if (!this._alive) return
    platform().pty.input(this.ptyId, data)
  }

  resize(cols: number, rows: number): void {
    if (!this._alive) return
    platform().pty.resize(this.ptyId, cols, rows)
  }

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
    if (this._unsubOutput) {
      this._unsubOutput()
      this._unsubOutput = null
    }
    if (this._unsubExit) {
      this._unsubExit()
      this._unsubExit = null
    }

    if (this.cwd) {
      const agentsMdPath = path.join(this.cwd, 'AGENTS.md')
      try {
        const current = fs.readFileSync(agentsMdPath, 'utf8')
        const stripped = stripPixelCitySection(current)
        if (!stripped.trim() && !this.agentsMdExisted) {
          fs.unlinkSync(agentsMdPath)
        } else {
          fs.writeFileSync(agentsMdPath, stripped, 'utf8')
        }
      } catch { /* file already gone or unreadable — nothing to clean up */ }
    }
  }
}
