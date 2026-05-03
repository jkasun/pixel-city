// ── Backend Core ────────────────────────────────────────────────────

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
} from './types.js'

export { backendRegistry } from './registry.js'
