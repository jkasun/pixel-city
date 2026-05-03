// ── LLM Adapter Core Types ─────────────────────────────────────────
// Re-exported from @pixel-city/core — this file is a thin shim so
// existing relative imports keep working during migration.

export type {
  ProviderId,
  LLMModel,
  ChipDescriptor,
  LLMCapabilities,
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
  LLMEvent,
  LLMSessionConfig,
  RawOutputCallback,
  LLMEventCallback,
  ExitCallback,
} from '@pixel-city/core/llm/types'
