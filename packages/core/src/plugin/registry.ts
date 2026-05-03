// ── Plugin Registry ──────────────────────────────────────────────────
// Singleton registry for all plugins. PluginPanel queries getOrdered()
// for tabs, AgentPanel queries getAgentTabs(), and mcpBridge queries
// findToolHandler() for command routing.

import type { PluginModule, PluginToolDefinition, PluginAgentTab, PluginHost } from './types.js'

class PluginRegistry {
  private plugins = new Map<string, PluginModule>()
  private changeListeners = new Set<() => void>()

  /** Register a plugin. Overwrites any existing plugin with the same ID. */
  register(plugin: PluginModule): void {
    this.plugins.set(plugin.manifest.id, plugin)
    this.notifyChange()
  }

  /** Remove a plugin by ID. */
  unregister(id: string): void {
    if (this.plugins.delete(id)) {
      this.notifyChange()
    }
  }

  /** Subscribe to registry changes. Returns unsubscribe function. */
  onChange(callback: () => void): () => void {
    this.changeListeners.add(callback)
    return () => { this.changeListeners.delete(callback) }
  }

  private notifyChange(): void {
    this.changeListeners.forEach(cb => { try { cb() } catch (_) { /* ignore */ } })
  }

  /** Get a plugin by ID. Returns undefined if not registered. */
  get(id: string): PluginModule | undefined {
    return this.plugins.get(id)
  }

  /** Get all plugins sorted by manifest.order (lower = first). */
  getOrdered(): PluginModule[] {
    return Array.from(this.plugins.values())
      .sort((a, b) => a.manifest.order - b.manifest.order)
  }

  /** Get all agent tabs from plugins, sorted by order, with owning pluginId attached. */
  getAgentTabs(): Array<PluginAgentTab & { pluginId: string }> {
    const tabs: Array<PluginAgentTab & { pluginId: string }> = []
    for (const plugin of this.plugins.values()) {
      if (plugin.agentTab) {
        tabs.push({ ...plugin.agentTab, pluginId: plugin.manifest.id })
      }
    }
    return tabs.sort((a, b) => a.order - b.order)
  }

  /** Find the tool definition that matches an action name. */
  findToolHandler(action: string): PluginToolDefinition | undefined {
    for (const plugin of this.plugins.values()) {
      if (!plugin.tools) continue
      const tool = plugin.tools.find(t => t.name === action)
      if (tool) return tool
    }
    return undefined
  }

  /** Get all tool definitions across all plugins (flat array). */
  getToolDefinitions(): PluginToolDefinition[] {
    const tools: PluginToolDefinition[] = []
    for (const plugin of this.plugins.values()) {
      if (plugin.tools) tools.push(...plugin.tools)
    }
    return tools
  }

  /** Call onActivate on all registered plugins. */
  async activateAll(host: PluginHost): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.onActivate) {
        try {
          await plugin.onActivate(host)
        } catch (e) {
          console.error(`[PluginRegistry] Failed to activate "${plugin.manifest.id}":`, e)
        }
      }
    }
  }

  /** Call onDeactivate on all registered plugins. */
  deactivateAll(): void {
    for (const plugin of this.plugins.values()) {
      if (plugin.onDeactivate) {
        try {
          plugin.onDeactivate()
        } catch (e) {
          console.error(`[PluginRegistry] Failed to deactivate "${plugin.manifest.id}":`, e)
        }
      }
    }
  }
}

/** Singleton registry instance — import and use throughout the app. */
export const pluginRegistry = new PluginRegistry()
