// ── LLM Adapter Layer ───────────────────────────────────────────────
// Public API for the multi-LLM adapter. Import from here.

// Core types
export type {
  ProviderId,
  LLMModel,
  LLMCapabilities,
  LLMSessionConfig,
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
  RawOutputCallback,
  LLMEventCallback,
  ExitCallback,
} from './types.js'

// Interfaces
export type { ILLMProvider } from './ILLMProvider.js'
export type { LLMSession } from './LLMSession.js'

// Registry (singleton)
export { llmRegistry } from './registry.js'

// Utilities
export { formatEventStatus } from './formatStatus.js'
export { MODEL_IDS, normalizeModel } from './models.js'

// Providers
export { ClaudeCodeProvider } from './providers/claude-code/index.js'
export { buildSystemPrompt } from './providers/claude-code/index.js'
export type { SystemPromptConfig } from './providers/claude-code/index.js'

// Renderers
export type { RendererId, ChatRendererCapabilities, ChatRendererProps, IChatRenderer } from './renderers/index.js'
export { rendererRegistry } from './renderers/index.js'
export { TerminalRenderer } from './renderers/index.js'
export { BuiltinChatRenderer } from './renderers/index.js'
export { AssistantUIRenderer } from './renderers/index.js'

// ── Auto-register built-in providers ────────────────────────────────
import { llmRegistry as _registry } from './registry.js'
import { ClaudeCodeProvider as _ClaudeCodeProvider } from './providers/claude-code/index.js'
import { CodexCliProvider as _CodexCliProvider } from './providers/codex-cli/index.js'
_registry.register(new _ClaudeCodeProvider())
_registry.register(new _CodexCliProvider())

// ── Auto-register built-in renderers (triggers side-effect import) ──
import './renderers/index.js'
