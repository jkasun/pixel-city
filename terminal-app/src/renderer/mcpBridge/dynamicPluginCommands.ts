// ── Dynamic Plugin MCP Command Handlers ─────────────────────────────
// Handles create_plugin, update_plugin, list_plugins,
// get_plugin_state, set_plugin_state, and plugin_call actions.

import {
  saveDynamicPlugin,
  getDynamicPlugin,
  getDynamicPluginState,
  updateDynamicPluginState,
} from '../plugins/dynamic/dynamicPluginDbLocal.js'
import { dispatchToPlugin } from '../plugins/dynamic/dynamicPluginBridge.js'
import type { DynamicPluginRecord, DynamicToolDefinition } from '../plugins/dynamic/types.js'

/** Slugify a name for use as a plugin ID. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

/** Get the next available order number (100+). */
let orderCounter = 100

export async function executeDynamicPluginAction(
  action: string,
  params: Record<string, unknown>,
  buildingId: string | null,
  agentId: string | null,
): Promise<unknown> {
  if (!buildingId) throw new Error('No building context — dynamic plugins are building-scoped')

  switch (action) {
    case 'create_plugin': {
      const name = params.name as string
      const description = (params.description as string) ?? ''
      const icon = (params.icon as string) ?? '🔌'
      const html = params.html as string
      const tools = (params.tools as DynamicToolDefinition[]) ?? []
      const initialState = (params.initialState as Record<string, unknown>) ?? {}

      if (!name) throw new Error('Missing name')
      if (!html) throw new Error('Missing html')

      const id = (params.id as string) ?? `dyn-${slugify(name)}`
      const now = Date.now()

      const record: DynamicPluginRecord = {
        id,
        name,
        description,
        icon,
        html,
        tools,
        state: initialState,
        createdBy: agentId ?? 'unknown',
        createdAt: now,
        updatedAt: now,
        order: orderCounter++,
      }

      await saveDynamicPlugin(buildingId, record)
      return { success: true, pluginId: id }
    }

    case 'update_plugin': {
      const pluginId = params.pluginId as string
      if (!pluginId) throw new Error('Missing pluginId')

      const existing = await getDynamicPlugin(buildingId, pluginId)
      if (!existing) throw new Error(`Plugin "${pluginId}" not found`)

      const updated: DynamicPluginRecord = {
        ...existing,
        name: (params.name as string) ?? existing.name,
        description: (params.description as string) ?? existing.description,
        icon: (params.icon as string) ?? existing.icon,
        html: (params.html as string) ?? existing.html,
        tools: (params.tools as DynamicToolDefinition[]) ?? existing.tools,
        updatedAt: Date.now(),
      }

      await saveDynamicPlugin(buildingId, updated)
      return { success: true, pluginId }
    }

    case 'list_plugins': {
      const { ipcRenderer } = window.require('electron')
      const result = await ipcRenderer.invoke('dynamic-plugin-list', { buildingId })
      const records = result.records as Record<string, DynamicPluginRecord>
      const plugins = Object.values(records).map(r => ({
        id: r.id,
        name: r.name,
        description: r.description,
        icon: r.icon,
        createdBy: r.createdBy,
        createdAt: r.createdAt,
        tools: (r.tools ?? []).map(t => ({ name: t.name, description: t.description })),
      }))
      return { plugins, count: plugins.length }
    }

    case 'get_plugin_state': {
      const pluginId = params.pluginId as string
      if (!pluginId) throw new Error('Missing pluginId')
      const state = await getDynamicPluginState(buildingId, pluginId)
      if (state === null) throw new Error(`Plugin "${pluginId}" not found`)
      return { state }
    }

    case 'set_plugin_state': {
      const pluginId = params.pluginId as string
      const value = params.value as Record<string, unknown>
      if (!pluginId) throw new Error('Missing pluginId')
      if (value === undefined) throw new Error('Missing value')
      await updateDynamicPluginState(buildingId, pluginId, value)
      return { success: true }
    }

    case 'plugin_call': {
      const pluginId = params.pluginId as string
      const pluginAction = params.action as string
      const actionParams = (params.params as Record<string, unknown>) ?? {}
      if (!pluginId) throw new Error('Missing pluginId')
      if (!pluginAction) throw new Error('Missing action')
      const result = await dispatchToPlugin(pluginId, pluginAction, actionParams)
      return result
    }

    default:
      throw new Error(`Unknown dynamic plugin action: ${action}`)
  }
}

/** All action names handled by this module (async). */
export const DYNAMIC_PLUGIN_ACTIONS = new Set([
  'create_plugin', 'update_plugin', 'list_plugins',
  'get_plugin_state', 'set_plugin_state', 'plugin_call',
])
