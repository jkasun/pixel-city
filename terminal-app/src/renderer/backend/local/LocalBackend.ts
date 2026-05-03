// ── Local Execution Backend ─────────────────────────────────────────
// Desktop (Electron) backend. Agents run as local PTY processes
// communicating via Electron IPC. This is the "extract" of what
// OfficeContext.initTerminal() currently does — but encapsulated
// behind the IExecutionBackend interface so it's swappable.

import type {
  IExecutionBackend,
  BackendId,
  BackendCapabilities,
  AgentHandle,
  StartAgentOpts,
  StartShellOpts,
  BackendTerminal,
} from '../types.js'
import { LocalTerminal } from './LocalTerminal.js'

const { ipcRenderer } = window.require('electron')

// ── Local Agent Handle ──────────────────────────────────────────────

class LocalAgentHandle implements AgentHandle {
  readonly session
  readonly terminal?: BackendTerminal

  constructor(opts: {
    session: import('../../llm/LLMSession.js').LLMSession
    terminal?: LocalTerminal
  }) {
    this.session = opts.session
    this.terminal = opts.terminal
  }

  dispose(): void {
    // Kill the session
    this.session.kill()

    // Detach terminal
    if (this.terminal) {
      (this.terminal as LocalTerminal).kill()
      this.terminal.detach()
    }
  }
}

// ── Local Execution Backend ─────────────────────────────────────────

export class LocalBackend implements IExecutionBackend {
  readonly id: BackendId = 'local'
  readonly displayName = 'Local (Desktop)'
  readonly capabilities: BackendCapabilities = {
    hasTerminal: true,
    hasFilesystem: true,
    hasRecording: false,
    hasShell: true,
  }

  async checkAvailability(): Promise<string | null> {
    // Local backend is always available in Electron
    try {
      const { ipcRenderer: ipc } = window.require('electron')
      if (ipc) return null
    } catch { /* not in Electron */ }
    return 'Local backend requires Electron (desktop app)'
  }

  async startAgent(opts: StartAgentOpts): Promise<AgentHandle> {
    const { provider, sessionConfig, terminalContainer, terminalOptions } = opts
    const hasTerminal = provider.capabilities.hasTerminal

    // ── 1. Create LLM session via provider ──────────────────────
    const session = await provider.createSession(sessionConfig)

    // ── 2. Set up terminal (for PTY-based providers) ────────────
    let localTerminal: LocalTerminal | undefined
    if (hasTerminal && session.ptyId) {
      localTerminal = new LocalTerminal(session.ptyId)
      if (terminalContainer) {
        localTerminal.attach(terminalContainer, terminalOptions)
      }
    }

    return new LocalAgentHandle({ session, terminal: localTerminal })
  }

  async startShell(opts: StartShellOpts): Promise<BackendTerminal> {
    const { cwd, container, terminalOptions } = opts

    // Create PTY for shell (no LLM)
    const ptyId: number = await ipcRenderer.invoke('pty-create', {
      cols: 120,
      rows: 30,
      cwd,
    })

    const terminal = new LocalTerminal(ptyId)
    terminal.attach(container, terminalOptions)
    return terminal
  }
}
