#!/usr/bin/env node

// MCP bridge that exposes plugin-owned tools (PluginModule.tools) to agents.
// The renderer owns the tool surface; this server just ferries list/call
// requests over the existing WS transport. See cto-space decision 2026-04-19.

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { sendCommand } from '../shared/ws-client.js'
import { SELF_AGENT_ID, SELF_AGENT_NAME } from '../shared/env.js'

// Defensive ceiling so a frozen renderer can't hang MCP clients. Per-tool
// timeouts live renderer-side on PluginToolDefinition.timeoutMs.
const BRIDGE_CALL_TIMEOUT_MS = 35_000

const server = new Server(
  { name: 'pixel-city-plugins', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const res = await sendCommand('plugin_tool_list', {})
  const tools = (res?.tools ?? []).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
  }))
  return { tools }
})

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name
  const args = req.params.arguments ?? {}
  // Inject caller identity so plugin handlers that gate on `from` / `agentId`
  // work (send_message, check_messages, meeting_send, etc.). Mirrors the
  // pattern used by messages-control.js. Existing args win — explicit values
  // from the LLM override injected ones.
  const enrichedArgs = {
    ...(SELF_AGENT_ID ? { from: SELF_AGENT_ID, agentId: SELF_AGENT_ID } : {}),
    ...(SELF_AGENT_NAME ? { fromName: SELF_AGENT_NAME } : {}),
    ...args,
  }
  const res = await sendCommand(
    'plugin_tool_call',
    { name, args: enrichedArgs },
    BRIDGE_CALL_TIMEOUT_MS,
  )

  if (!res || res.ok !== true) {
    const error = res?.error ?? 'Unknown plugin tool error'
    return {
      isError: true,
      content: [{ type: 'text', text: String(error) }],
    }
  }

  const payload = res.result === undefined
    ? ''
    : typeof res.result === 'string'
      ? res.result
      : JSON.stringify(res.result)
  return { content: [{ type: 'text', text: payload }] }
})

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('[pixel-city-plugins] MCP bridge started\n')
}

main().catch((err) => {
  process.stderr.write(`[pixel-city-plugins] Fatal: ${err.message}\n`)
  process.exit(1)
})
