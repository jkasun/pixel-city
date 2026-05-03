// ── Plugin Core ─────────────────────────────────────────────────────

export type {
  PluginManifest,
  PluginEvent,
  PluginHost,
  PluginToolDefinition,
  PluginAgentTab,
  AgentTabProps,
  PluginProps,
  PluginModule,
} from './types.js'

export { pluginRegistry } from './registry.js'
export { PluginEventBus } from './eventBus.js'
