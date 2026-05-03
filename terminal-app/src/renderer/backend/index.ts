// ── Execution Backend ───────────────────────────────────────────────
// Public API for the execution backend layer.
//
// Usage:
//   import { backendRegistry } from './backend'
//   const backend = backendRegistry.resolve(provider)
//   const handle = await backend.startAgent({ provider, sessionConfig, ... })
//
// Registration happens at app startup:
//   - Desktop (Electron): registers LocalBackend (default)

// Re-export types
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

// Re-export registry
export { backendRegistry } from './registry.js'

// Re-export implementations
export { LocalBackend } from './local/LocalBackend.js'
