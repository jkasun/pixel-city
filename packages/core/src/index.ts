// ── @pixel-city/core ────────────────────────────────────────────────
// Shared framework core consumed by both terminal-app and web-app.
// Contains type definitions, interfaces, and singleton registries for:
//   - LLM providers & sessions
//   - Execution backends
//   - Chat renderers
//   - Plugin system

// ── LLM ─────────────────────────────────────────────────────────────
export {
  llmRegistry,
} from './llm/index.js'

export type {
  ProviderId,
  LLMModel,
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
  ILLMProvider,
  LLMSession,
} from './llm/index.js'

// ── Backend ─────────────────────────────────────────────────────────
export {
  backendRegistry,
} from './backend/index.js'

export type {
  BackendId,
  IExecutionBackend,
  BackendCapabilities,
  AgentHandle,
  BackendTerminal,
  BackendRecording,
  BackendWorkspace,
  StartAgentOpts,
  StartShellOpts,
  TerminalAttachOptions,
  RecordingMeta,
  WorkspaceResolveOpts,
} from './backend/index.js'

// ── Renderers ───────────────────────────────────────────────────────
export {
  rendererRegistry,
} from './renderers/index.js'

export type {
  RendererId,
  ChatRendererCapabilities,
  ChatRendererProps,
  IChatRenderer,
} from './renderers/index.js'

// ── Session ─────────────────────────────────────────────────────
export type {
  AgentInfo,
  SpawnAgentOpts,
  ISessionAdapter,
} from './session/index.js'

// ── Plugin ──────────────────────────────────────────────────────────
export {
  pluginRegistry,
  PluginEventBus,
} from './plugin/index.js'

export type {
  PluginManifest,
  PluginEvent,
  PluginHost,
  PluginToolDefinition,
  PluginAgentTab,
  AgentTabProps,
  PluginProps,
  PluginModule,
} from './plugin/index.js'
