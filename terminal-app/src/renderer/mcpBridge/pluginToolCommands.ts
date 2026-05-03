// ── Plugin Tool MCP Dispatch ─────────────────────────────────────────
// Bridges the pixel-city-plugins MCP server to PluginModule.tools handlers.
// Wire envelope agreed between Nova + Calander Puff, 2026-04-19.

import { z } from 'zod'
import { pluginRegistry } from '@pixel-city/core/plugin/registry'
import type { PluginToolDefinition } from '@pixel-city/core'
import { getLatestPluginHost } from '../plugins/PluginHostProvider.js'

const DEFAULT_TIMEOUT_MS = 30_000

interface WireToolDefinition {
  pluginId: string | null
  name: string
  description: string
  inputSchema: unknown
}

function toInputSchema(shape: Record<string, z.ZodType>): unknown {
  try {
    return z.toJSONSchema(z.object(shape))
  } catch (err) {
    console.warn('[plugin-bridge] schema conversion failed:', err)
    return { type: 'object', properties: {} }
  }
}

function findPluginIdForTool(name: string): string | null {
  for (const plugin of pluginRegistry.getOrdered()) {
    if (plugin.tools?.some(t => t.name === name)) return plugin.manifest.id
  }
  return null
}

function listTools(): { tools: WireToolDefinition[] } {
  const defs = pluginRegistry.getToolDefinitions()
  const seen = new Set<string>()
  const tools: WireToolDefinition[] = []
  for (const def of defs) {
    if (seen.has(def.name)) {
      console.warn(`[plugin-bridge] duplicate tool name "${def.name}" — keeping first registration`)
      continue
    }
    seen.add(def.name)
    tools.push({
      pluginId: findPluginIdForTool(def.name),
      name: def.name,
      description: def.description,
      inputSchema: toInputSchema(def.schema),
    })
  }
  return { tools }
}

async function invokeWithTimeout(
  def: PluginToolDefinition,
  args: Record<string, unknown>,
): Promise<unknown> {
  const host = getLatestPluginHost()
  if (!host) throw new Error('Plugin host unavailable — renderer not ready')

  const timeoutMs = (def as PluginToolDefinition & { timeoutMs?: number }).timeoutMs
    ?? DEFAULT_TIMEOUT_MS

  return await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout after ${timeoutMs}ms`)),
      timeoutMs,
    )
    Promise.resolve()
      .then(() => def.handler(args, host))
      .then(
        (result) => { clearTimeout(timer); resolve(result) },
        (err) => { clearTimeout(timer); reject(err) },
      )
  })
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const def = pluginRegistry.findToolHandler(name)
  if (!def) return { ok: false, error: `Unknown plugin tool: ${name}` }
  try {
    const result = await invokeWithTimeout(def, args)
    return { ok: true, result }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
}

export const PLUGIN_TOOL_ACTIONS = new Set(['plugin_tool_list', 'plugin_tool_call'])

export async function executePluginToolAction(
  action: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  if (action === 'plugin_tool_list') return listTools()
  if (action === 'plugin_tool_call') {
    const name = params.name as string
    const args = (params.args as Record<string, unknown>) ?? {}
    if (!name) return { ok: false, error: 'Missing tool name' }
    return callTool(name, args)
  }
  throw new Error(`Unknown plugin tool action: ${action}`)
}
