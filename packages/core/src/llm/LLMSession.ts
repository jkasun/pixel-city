// ── LLM Session Interface ───────────────────────────────────────────
// Represents an active conversation session with an LLM provider.
// Created by ILLMProvider.createSession(). The office layer uses this
// to interact with the running agent regardless of backend.

import type {
  LLMEventCallback,
  RawOutputCallback,
  ExitCallback,
  LLMCapabilities,
  ProviderId,
} from './types.js'

export interface LLMSession {
  /** The provider that created this session */
  readonly providerId: ProviderId

  /** Capabilities inherited from the provider */
  readonly capabilities: LLMCapabilities

  /** Unique session identifier */
  readonly sessionId: string

  // ── Output Streams ──────────────────────────────────────────────

  /**
   * Register a callback for raw terminal output.
   * Only meaningful for PTY-based providers (hasTerminal: true).
   * For API providers, this will not fire — use onEvent instead.
   */
  onOutput(callback: RawOutputCallback): void

  /**
   * Register a callback for normalized LLM events.
   * Fires for ALL providers — this is the primary event stream.
   * Events include: tool_use, turn_end, text, error, subagent_spawn, etc.
   */
  onEvent(callback: LLMEventCallback): void

  /**
   * Register a callback for when the session process exits.
   * For PTY providers, this is the process exit code.
   * For API providers, 0 means clean close, non-zero means error.
   */
  onExit(callback: ExitCallback): void

  // ── Input ─────────────────────────────────────────────────────

  /**
   * Send user input to the session.
   * For PTY providers: raw terminal data (keystrokes, including ANSI sequences).
   * For API providers: a user message string (will be sent as the next turn).
   */
  sendInput(data: string): void

  // ── Terminal Control (PTY providers only) ─────────────────────

  /**
   * Resize the terminal. No-op for API providers.
   */
  resize(cols: number, rows: number): void

  // ── Lifecycle ─────────────────────────────────────────────────

  /**
   * Gracefully stop the session.
   * For PTY providers: sends SIGTERM to the process.
   * For API providers: cancels any in-flight request.
   */
  kill(): void

  /**
   * Whether the session is still active (process running / connection open).
   */
  isAlive(): boolean

  // ── Session Recording ─────────────────────────────────────────

  /**
   * The PTY ID if this is a terminal-based session. Null for API sessions.
   * Used for session recording integration.
   */
  readonly ptyId: number | null
}
