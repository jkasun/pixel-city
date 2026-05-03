// ── Dynamic Plugin Bridge ─────────────���─────────────────────────────
// Global map connecting mcpBridge tool calls to mounted DynamicPluginView iframes.
// Each DynamicPluginView registers/unregisters itself here on mount/unmount.

export interface DynamicPluginViewHandle {
  dispatchToolCall: (toolName: string, params: Record<string, unknown>) => Promise<unknown>
}

const pluginViewRefs = new Map<string, DynamicPluginViewHandle>()

/** Register a mounted DynamicPluginView. Called on mount. */
export function registerPluginView(pluginId: string, handle: DynamicPluginViewHandle): void {
  pluginViewRefs.set(pluginId, handle)
}

/** Unregister a DynamicPluginView. Called on unmount. */
export function unregisterPluginView(pluginId: string): void {
  pluginViewRefs.delete(pluginId)
}

/** Dispatch a tool call to a dynamic plugin's iframe. Throws if plugin not mounted. */
export async function dispatchToPlugin(
  pluginId: string,
  toolName: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const handle = pluginViewRefs.get(pluginId)
  if (!handle) {
    throw new Error(`Plugin "${pluginId}" is not mounted. Switch to its tab first or wait for it to load.`)
  }
  return handle.dispatchToolCall(toolName, params)
}

/** Check if a dynamic plugin view is currently mounted. */
export function isPluginMounted(pluginId: string): boolean {
  return pluginViewRefs.has(pluginId)
}
