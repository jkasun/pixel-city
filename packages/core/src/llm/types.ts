// ── LLM Adapter Core Types ─────────────────────────────────────────
// Provider-agnostic types for the multi-LLM adapter layer.
// All providers emit and consume these types.

/** Unique identifier for a provider type (e.g. 'claude-code', 'codex-cli') */
export type ProviderId = string

/** A model offered by a provider */
export interface LLMModel {
  /** Model identifier sent to the provider (e.g. 'claude-sonnet-4-6', 'gemini-2.5-pro') */
  id: string
  /** Human-readable label for the UI */
  label: string
  /** Provider that owns this model */
  providerId: ProviderId
}

/**
 * Describes how a model renders in the sidebar chip.
 * Letter + color is the compact identity; version appears only when
 * the model is NOT the provider's default. Labels feed the hover tooltip.
 */
export interface ChipDescriptor {
  /** Single-character model-family letter, e.g. 'S', 'O', 'C', 'G', 'o' (o-series) */
  letter: string
  /** Hex accent color encoding the provider family */
  color: string
  /** Version suffix (e.g. '4.6', '5.3'). Rendered only for non-default models. */
  versionLabel?: string
  /** Full provider name for the tooltip, e.g. 'Anthropic', 'OpenAI', 'Google' */
  providerLabel: string
  /** Full model-family name for the tooltip, e.g. 'Opus', 'Codex', 'o-series' */
  modelLabel: string
}

/** What a provider can and cannot do — drives UI decisions */
export interface LLMCapabilities {
  /** Provider runs inside a PTY terminal (xterm display) */
  hasTerminal: boolean
  /** Provider supports tool/function calling */
  hasToolUse: boolean
  /** Provider can spawn nested sub-agents */
  hasSubagents: boolean
  /** Provider streams output tokens incrementally */
  hasStreaming: boolean
  /** Provider writes a JSONL session log we can watch */
  hasJsonlLog: boolean
  /**
   * Which chat renderer to use for this provider's UI.
   * Maps to a RendererId in the rendererRegistry.
   * Defaults: 'terminal' for PTY providers, 'builtin-chat' for API providers.
   * Can be overridden per-provider to use e.g. 'assistant-ui'.
   */
  preferredRenderer?: string
}

// ── LLM Events ─────────────────────────────────────────────────────
// Normalized events emitted by all providers. The office/UI layer
// consumes these without knowing which provider generated them.

export interface LLMToolUseEvent {
  type: 'tool_use'
  /** Tool invocation ID (for tracking active tools) */
  toolUseId: string
  /** Tool name (e.g. 'Read', 'Bash', 'mcp__pixel-city__create_task') */
  toolName: string
  /** Tool input parameters */
  input: Record<string, unknown>
}

export interface LLMToolResultEvent {
  type: 'tool_result'
  /** Matches the toolUseId from the corresponding tool_use event */
  toolUseId: string
}

export interface LLMTextEvent {
  type: 'text'
  /** Streamed text content (may be partial) */
  text: string
}

export interface LLMThinkingEvent {
  type: 'thinking'
  /** Thinking/reasoning content */
  text: string
}

export interface LLMTurnEndEvent {
  type: 'turn_end'
  /** Total duration of the turn in milliseconds (if available) */
  durationMs?: number
}

export interface LLMErrorEvent {
  type: 'error'
  message: string
  /** Whether this error is recoverable (agent can continue) */
  recoverable: boolean
}

export interface LLMSubagentSpawnEvent {
  type: 'subagent_spawn'
  /** Tool use ID that triggered the sub-agent */
  toolUseId: string
  /** Description of the sub-agent task */
  description?: string
}

export interface LLMSubagentCompleteEvent {
  type: 'subagent_complete'
  /** Tool use ID of the completed sub-agent */
  toolUseId: string
}

export interface LLMTokenUsageEvent {
  type: 'token_usage'
  /** Output tokens used in this chunk/turn */
  outputTokens: number
  /** Input/prompt tokens (if available) */
  inputTokens?: number
}

export interface LLMStatusEvent {
  type: 'status'
  /** Human-readable status text (e.g. "Reading config.ts", "Searching files") */
  text: string
}

/** Union of all possible events emitted by providers */
export type LLMEvent =
  | LLMToolUseEvent
  | LLMToolResultEvent
  | LLMTextEvent
  | LLMThinkingEvent
  | LLMTurnEndEvent
  | LLMErrorEvent
  | LLMSubagentSpawnEvent
  | LLMSubagentCompleteEvent
  | LLMTokenUsageEvent
  | LLMStatusEvent

// ── Session Config ──────────────────────────────────────────────────
// Everything needed to start a new LLM session.

export interface LLMSessionConfig {
  /** Which provider to use */
  providerId: ProviderId
  /** Model to use within that provider */
  modelId: string
  /** Unique session identifier */
  sessionId: string
  /** Agent ID in the Pixel City office */
  agentId: string
  /** Agent display name */
  agentName: string
  /** Working directory for the agent */
  cwd?: string
  /** System prompt / instructions to prepend */
  systemPrompt?: string
  /** Initial user message / task prompt */
  initialPrompt?: string
  /** Terminal dimensions (for PTY providers) */
  cols?: number
  rows?: number
  /** Environment variables to inject (for PTY providers) */
  env?: Record<string, string>
  /** Additional provider-specific options */
  providerOptions?: Record<string, unknown>
  /** Resume an existing session by sessionId — providers that support it skip initialPrompt and replay transcript */
  resume?: boolean
}

// ── Output callback types ───────────────────────────────────────────

/** Called when raw terminal output arrives (for PTY providers that render in xterm) */
export type RawOutputCallback = (data: string) => void

/** Called when a normalized LLM event is emitted */
export type LLMEventCallback = (event: LLMEvent) => void

/** Called when the session process exits */
export type ExitCallback = (exitCode: number) => void
