// ── Execution Backend Types ─────────────────────────────────────────
// Abstracts WHERE an agent runs. The rest of the app doesn't care
// about the transport — it just talks to these interfaces.
//
// Implementations:
//   LocalBackend — Desktop (Electron IPC → local PTY + fs)

import type { LLMSession } from '../llm/LLMSession.js'
import type { LLMSessionConfig } from '../llm/types.js'
import type { ILLMProvider } from '../llm/ILLMProvider.js'

// ── Backend ID ──────────────────────────────────────────────────────

export type BackendId = 'local' | (string & {})

// ── Terminal Interface ──────────────────────────────────────────────
// Provided by backends that support PTY-based terminal access.
// LocalBackend uses Electron IPC.

export interface BackendTerminal {
  /**
   * Mount the terminal UI into a DOM container.
   * The backend owns the xterm.js instance (or equivalent) — the caller
   * just provides where to render it.
   */
  attach(container: HTMLElement, options?: TerminalAttachOptions): void

  /** Detach from the DOM and dispose the terminal UI. */
  detach(): void

  /** Send raw input (keystrokes, ANSI sequences) to the PTY. */
  sendInput(data: string): void

  /** Resize the PTY + terminal UI. */
  resize(cols: number, rows: number): void

  /** Listen for raw PTY output. Returns an unsubscribe function. */
  onOutput(cb: (data: string) => void): () => void

  /** Listen for PTY exit. Returns an unsubscribe function. */
  onExit(cb: (exitCode: number) => void): () => void

  /** Focus the terminal UI. */
  focus(): void

  /** Fit terminal to container size. */
  fit(): void
}

export interface TerminalAttachOptions {
  fontSize?: number
  fontFamily?: string
  lineHeight?: number
  cursorStyle?: 'block' | 'underline' | 'bar'
  cursorBlink?: boolean
  scrollback?: number
  theme?: Record<string, string>
}

// ── Session Recording ───────────────────────────────────────────────
// Abstracts where session recordings are stored.

export interface BackendRecording {
  /** Start recording the current session. Returns a recording ID. */
  start(meta: RecordingMeta): Promise<string>

  /** Stop recording. */
  stop(): Promise<void>
}

export interface RecordingMeta {
  agentId: string
  agentName: string
  model?: string
  sessionId: string
  projectDir?: string
}

// ── Workspace Resolution ────────────────────────────────────────────
// Abstracts how workspaces are resolved per backend.

export interface BackendWorkspace {
  /**
   * Resolve the working directory for an agent.
   * Returns the resolved cwd path.
   */
  resolveCwd(opts: WorkspaceResolveOpts): Promise<string>

  /**
   * Cleanup workspace resources when agent is removed.
   */
  cleanup(agentId: string): Promise<void>
}

export interface WorkspaceResolveOpts {
  agentId: string
  employeeId?: string
  projectDir: string
}

// ── Agent Handle ────────────────────────────────────────────────────
// Returned by backend.startAgent(). The caller uses this to interact
// with the running agent without knowing transport details.

export interface AgentHandle {
  /** The LLM session (provider-created). */
  readonly session: LLMSession

  /** Terminal interface. Undefined for API-only agents (no PTY). */
  readonly terminal?: BackendTerminal

  /** Session recording interface. Undefined if recording not supported. */
  readonly recording?: BackendRecording

  /** Cleanup everything when the agent is removed. */
  dispose(): void
}

// ── Execution Backend Interface ─────────────────────────────────────

export interface IExecutionBackend {
  /** Unique backend identifier. */
  readonly id: BackendId

  /** Human-readable name for UI/logging. */
  readonly displayName: string

  /** What this backend supports. */
  readonly capabilities: BackendCapabilities

  /**
   * Start an agent. This is the main entry point.
   *
   * The backend:
   * 1. Resolves the workspace/cwd (if applicable)
   * 2. Creates the LLM session via the provider
   * 3. Sets up terminal + recording (if applicable)
   * 4. Returns an AgentHandle the caller uses for everything
   *
   * The caller (OfficeContext) no longer needs to know about PTY IDs,
   * JSONL paths, or xterm instances.
   */
  startAgent(opts: StartAgentOpts): Promise<AgentHandle>

  /**
   * Start a shell (no LLM). Only available on backends with terminal support.
   * Returns a BackendTerminal the caller can attach to a DOM container.
   */
  startShell?(opts: StartShellOpts): Promise<BackendTerminal>

  /**
   * Check whether this backend is available in the current environment.
   * Returns null if ready, or an error message if not.
   */
  checkAvailability(): Promise<string | null>
}

export interface StartAgentOpts {
  /** LLM provider to use for this agent. */
  provider: ILLMProvider

  /** Full session config (passed to provider.createSession). */
  sessionConfig: LLMSessionConfig

  /** DOM container to mount terminal into (if terminal-based). */
  terminalContainer?: HTMLElement

  /** Terminal appearance options. */
  terminalOptions?: TerminalAttachOptions

  /** Workspace resolution options. */
  workspace?: WorkspaceResolveOpts

  /** Whether to record the session. */
  enableRecording?: boolean
}

export interface StartShellOpts {
  /** Working directory for the shell. */
  cwd?: string

  /** DOM container to mount terminal into. */
  container: HTMLElement

  /** Terminal appearance options. */
  terminalOptions?: TerminalAttachOptions
}

// ── Backend Capabilities ────────────────────────────────────────────

export interface BackendCapabilities {
  /** Can this backend provide a PTY terminal? */
  hasTerminal: boolean

  /** Can this backend access the filesystem? */
  hasFilesystem: boolean

  /** Can this backend record sessions? */
  hasRecording: boolean

  /** Can this backend start standalone shells? */
  hasShell: boolean
}
