// ── Dynamic Plugin Type Definitions ───���──────────────────────────────
// Types for agent-created plugins that render in sandboxed iframes.

/** What an agent provides when calling create_plugin */
export interface DynamicPluginDefinition {
  /** Optional ID (auto-generated from name if omitted). Prefixed with 'dyn-'. */
  id?: string
  /** Display name */
  name: string
  /** Description for humans and agents */
  description: string
  /** Emoji icon (e.g. "🎮") */
  icon: string
  /** Full HTML document string for the iframe */
  html: string
  /** Custom tools this plugin exposes via plugin_call */
  tools?: DynamicToolDefinition[]
  /** Initial state (persisted to RTDB) */
  initialState?: Record<string, unknown>
}

/** A tool defined by a dynamic plugin — declarative only, handler lives in iframe JS */
export interface DynamicToolDefinition {
  /** Tool name, e.g. "make_move" */
  name: string
  /** Description shown to agents */
  description: string
  /** JSON Schema for parameters */
  inputSchema: Record<string, unknown>
}

/** What's persisted in RTDB for a dynamic plugin */
export interface DynamicPluginRecord {
  id: string
  name: string
  description: string
  icon: string
  html: string
  tools: DynamicToolDefinition[]
  state: Record<string, unknown>
  createdBy: string
  createdAt: number
  updatedAt: number
  order: number
}
