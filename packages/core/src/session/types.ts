// ── Session Adapter Types ──────────────────────────────────────────
// Abstracts agent lifecycle + terminal I/O so that the same UI
// components work across desktop (Electron IPC) and web (WebSocket).

/**
 * Minimal agent info exposed to shared UI components.
 */
export interface AgentInfo {
  agentId: string
  name: string
  model: string
  ptyId: number
  sessionId?: string
  status: string | null
  active: boolean
  cwd?: string
  startedAt?: string
}

/**
 * Options for spawning a new agent.
 */
export interface SpawnAgentOpts {
  name: string
  model: string
  cwd?: string
  initialMessage?: string
  permissionMode?: string
}

/**
 * A plain shell terminal (not a Claude agent session).
 */
export interface TerminalInfo {
  terminalId: string
  name: string
  ptyId: number
  active: boolean
  cwd?: string
  createdAt?: string
}

// ── Shared UI Types ────────────────────────────────────────────────
// Used by @pixel-city/ui components (DmSidebar, AgentPanel, StatusBar).

/** Quick action stored in the sidebar. */
export interface QuickAction {
  id: string
  title: string
  description: string
  type: 'ai' | 'terminal'
  /** Shell command to run (only used when type === 'terminal'). */
  command?: string
}

/** Token usage breakdown for an agent session. */
export interface AgentUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

/** Entry in the model picker dropdown (abstracts llmRegistry). */
export interface ModelPickerEntry {
  providerId: string
  providerDisplayName: string
  models: Array<{
    id: string
    label: string
    color: string
  }>
}

/** Which bottom panel is open. */
export type BottomPanelKind = 'debug' | 'usage' | null

/** Whether the main view shows an agent terminal or a shell. */
export type ActiveView = 'agent' | 'shell'

/** Shell terminal data for the sidebar (parallel to TerminalInfo but for desktop shells). */
export interface ShellInfo {
  shellId: number
  name: string
  active: boolean
}

/**
 * The session adapter interface — implemented once per platform.
 *
 * Desktop: wraps Electron IPC (platform().pty + OfficeContext)
 * Web:     wraps WebSocket RPC (GatewayContext + gateway.call/subscribe)
 */
export interface ISessionAdapter {
  // ── Connection state ──────────────────────────────────────────────

  /** Whether the backend (gateway / local PTY server) is connected. */
  readonly connected: boolean

  // ── Agent lifecycle ───────────────────────────────────────────────

  /** Current list of agents (reactive — changes trigger re-render). */
  readonly agents: AgentInfo[]

  /** Current list of plain terminals. */
  readonly terminals: TerminalInfo[]

  /** Spawn a new agent. Returns the created agent info. */
  spawnAgent(opts: SpawnAgentOpts): Promise<AgentInfo>

  /** Kill a running agent. */
  killAgent(agentId: string): Promise<void>

  /** Create a plain shell terminal. */
  createTerminal(name: string, cwd?: string): Promise<TerminalInfo>

  /** Kill a plain terminal. */
  killTerminal(terminalId: string): Promise<void>

  // ── Terminal I/O ──────────────────────────────────────────────────
  // All methods are ptyId-scoped so the UI doesn't care about transport.

  /** Send raw input (keystrokes / ANSI) to a PTY. */
  sendInput(ptyId: number, data: string): void

  /** Subscribe to PTY output. Returns an unsubscribe function. */
  onOutput(ptyId: number, cb: (data: string) => void): () => void

  /** Subscribe to PTY exit. Returns an unsubscribe function. */
  onExit(ptyId: number, cb: (exitCode: number) => void): () => void

  /** Resize a PTY. */
  resizePty(ptyId: number, cols: number, rows: number): void

  /** Replay buffered scrollback output for a PTY (used to restore terminal on reconnect). */
  replayOutput?(ptyId: number): Promise<string>
}
