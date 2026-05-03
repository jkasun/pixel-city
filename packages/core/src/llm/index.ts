// ── LLM Core ────────────────────────────────────────────────────────
// Public API for the LLM adapter layer. Types + interfaces + registry.
// Provider implementations live in each app (terminal-app, web-app).

export type {
  ProviderId,
  LLMModel,
  ChipDescriptor,
  LLMCapabilities,
  LLMEvent,
  LLMToolUseEvent,
  LLMToolResultEvent,
  LLMTextEvent,
  LLMThinkingEvent,
  LLMTurnEndEvent,
  LLMErrorEvent,
  LLMSubagentSpawnEvent,
  LLMSubagentCompleteEvent,
  LLMTokenUsageEvent,
  LLMStatusEvent,
  LLMSessionConfig,
  RawOutputCallback,
  LLMEventCallback,
  ExitCallback,
} from './types.js'

export type { ILLMProvider } from './ILLMProvider.js'
export type { LLMSession } from './LLMSession.js'
export { llmRegistry } from './registry.js'
