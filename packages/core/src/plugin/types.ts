// ── Plugin Adapter Type Definitions ──────────────────────────────────
// Core types for the Pixel City plugin system. Plugins provide a UI view,
// optional agent-scoped tab, optional MCP tools, and lifecycle hooks.

import type React from 'react'
import type { z } from 'zod'

// ── Plugin Manifest ──────────────────────────────────────────────────

export interface PluginManifest {
  /** Unique key: 'board', 'browser', 'messages', etc. */
  id: string
  /** Display name shown in tooltips: 'Task Board' */
  name: string
  /** Sidebar icon component */
  icon: React.ComponentType<{ size?: number }>
  /** Tab sort order (lower = appears first) */
  order: number
  /** Optional description for tooltip / marketplace */
  description?: string
  /** Semver version string */
  version?: string
  /** True for plugins that ship with the app */
  builtIn: boolean
}

// ── Plugin Events ────────────────────────────────────────────────────

export type PluginEvent =
  // Host → Plugin (subscribe with host.on)
  | 'agent:selected'          // (agentId: string) — agent selected in DmSidebar
  | 'agent:deselected'        // () — no agent selected
  | 'agent:status-changed'    // (agentId: string, status: string | null)
  | 'plugin:activated'        // (pluginId: string) — plugin tab opened
  | 'plugin:deactivated'      // (pluginId: string) — plugin tab hidden
  // Plugin → Host (emit with host.emit)
  | 'agent:select'            // (agentId: string) — request host to select agent
  | 'plugin:focus'            // (pluginId: string) — request host to switch plugin tab
  | 'agent-tab:focus'         // (tabId: string) — request host to switch agent tab

// ── Plugin Host API ──────────────────────────────────────────────────

export interface PluginHost {
  // Context (read-only, reactive)
  projectCwd: string | null
  buildingId: string | null

  // Agent metadata
  agentIds: string[]
  agentNames: ReadonlyMap<string, string>
  agentPalettes: ReadonlyMap<string, number>
  activeAgentId: string | null
  /** Live agentId → permanent employee id (only present for permanent agents). */
  agentPermanentIds: ReadonlyMap<string, string>

  // Permanent employees (persistent roster; independent of live agent sessions)
  permanentEmployees: ReadonlyArray<{
    id: string
    name: string
    palette?: number
    model?: string
    officeId?: string | null
    handle?: string
  }>

  // Actions
  spawnAgent: (model: string) => { id: string; name: string }
  selectAgent: (agentId: string) => void
  switchToPlugin: (pluginId: string) => void
  switchToAgentTab: (tabId: string) => void
  showNotification: (msg: string, level?: 'info' | 'warn' | 'error') => void

  // Event bus
  on: (event: PluginEvent, callback: (...args: any[]) => void) => () => void
  emit: (event: PluginEvent, ...args: any[]) => void

  // IPC passthrough (for Electron calls) / WebSocket RPC (for web)
  ipcInvoke: (channel: string, ...args: unknown[]) => Promise<unknown>

  // Editor config
  editorSettings: { fontSize: number; tabSize: number; wordWrap: boolean }
}

// ── MCP Tool Definition ──────────────────────────────────────────────

export interface PluginToolDefinition {
  /** MCP tool name: 'create_task', 'send_message', etc. */
  name: string
  /** Description shown to agents */
  description: string
  /** Zod schema for parameters (same format as server.tool()) */
  schema: Record<string, z.ZodType>
  /** Handler runs in the renderer when an agent calls this tool */
  handler: (params: Record<string, unknown>, host: PluginHost) => unknown | Promise<unknown>
  /** True if handler is async (default false) */
  async?: boolean
  /** Renderer-side timeout override in ms (default 30_000) */
  timeoutMs?: number
}

// ── Agent Tab (injection point ③) ────────────────────────────────────

export interface PluginAgentTab {
  /** Tab key in agent panel: 'taskboard', 'inbox' */
  id: string
  /** Display label: 'Task Board', 'Inbox' */
  label: string
  /** Sort order in the agent tab bar */
  order: number
  /** Component rendered when this tab is active */
  Component: React.ComponentType<AgentTabProps>
}

export interface AgentTabProps {
  host: PluginHost
  /** Currently selected agent */
  agentId: string
  agentName: string
  agentPalette: number
  /** False when tab is not selected — skip expensive renders */
  visible: boolean
}

// ── Plugin Props (injection point ①) ─────────────────────────────────

export interface PluginProps {
  host: PluginHost
  /** False when plugin tab is not selected — skip expensive renders */
  visible: boolean
}

// ── Plugin Module (the full contract) ────────────────────────────────

export interface PluginModule {
  manifest: PluginManifest
  /** ① Main view rendered in PluginPanel */
  Component: React.ComponentType<PluginProps>
  /** ③ Optional agent-scoped tab rendered in AgentPanel */
  agentTab?: PluginAgentTab
  /** ② Optional MCP tools agents can call */
  tools?: PluginToolDefinition[]
  /** Called when plugin is first activated */
  onActivate?: (host: PluginHost) => void | Promise<void>
  /** Called when plugin is deactivated */
  onDeactivate?: () => void
}
