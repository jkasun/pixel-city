#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { sendCommand } from '../shared/ws-client.js'
import { SELF_AGENT_NAME } from '../shared/env.js'
import { resolveAgentId } from '../shared/helpers.js'

const server = new McpServer({
  name: 'pixel-city-messages',
  version: '1.0.0',
})

// `id` falls back to PIXEL_CITY_AGENT_ID, which Claude/Gemini receive via env.
// Codex doesn't forward parent env to MCP children, so the system prompt tells
// codex agents to pass `id` explicitly using the agent ID embedded in the prompt.

server.tool(
  'send_message',
  'Send a message to another agent in the office. Use this to report results, request help, or notify a teamlead that you are done with a task. If no id is provided, uses this session\'s own agent ID as the sender.',
  {
    id: z.string().optional().describe('Sender agent ID (defaults to own agent ID)'),
    to: z.string().describe('Recipient agent ID'),
    subject: z.string().describe('Short subject line'),
    body: z.string().describe('Full message content'),
    type: z.enum(['result', 'status', 'request', 'info']).optional().describe('Message type (default: info)'),
    replyTo: z.string().optional().describe('ID of the message you are replying to'),
  },
  async (params) => {
    const from = resolveAgentId(params)
    const result = await sendCommand('send_message', {
      from,
      fromName: SELF_AGENT_NAME,
      to: params.to,
      subject: params.subject,
      body: params.body,
      type: params.type || 'info',
      replyTo: params.replyTo,
    })
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

server.tool(
  'check_messages',
  'Check your inbox for messages from other agents. Returns unread messages by default. Call this periodically when waiting for sub-agent results. If no id is provided, uses this session\'s own agent ID.',
  {
    id: z.string().optional().describe('Inbox owner agent ID (defaults to own agent ID)'),
    from: z.string().optional().describe('Filter messages from a specific agent ID'),
    unreadOnly: z.boolean().optional().describe('Only return unread messages (default: true)'),
  },
  async (params) => {
    const result = await sendCommand('check_messages', {
      agentId: resolveAgentId(params),
      from: params.from,
      unreadOnly: params.unreadOnly ?? true,
    })
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'read_message',
  'Read a specific message by ID and mark it as read. If no id is provided, uses this session\'s own agent ID.',
  {
    id: z.string().optional().describe('Inbox owner agent ID (defaults to own agent ID)'),
    messageId: z.string().describe('ID of the message to read'),
  },
  async (params) => {
    const result = await sendCommand('read_message', {
      agentId: resolveAgentId(params),
      messageId: params.messageId,
    })
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'list_messages',
  'List all messages in your inbox (both read and unread), sorted newest first. If no id is provided, uses this session\'s own agent ID.',
  {
    id: z.string().optional().describe('Inbox owner agent ID (defaults to own agent ID)'),
    limit: z.number().optional().describe('Max messages to return (default: 20)'),
    offset: z.number().optional().describe('Skip first N messages (default: 0)'),
  },
  async (params) => {
    const result = await sendCommand('list_messages', {
      agentId: resolveAgentId(params),
      limit: params.limit ?? 20,
      offset: params.offset ?? 0,
    })
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('[pixel-city-messages-control] MCP server started\n')
}

main().catch((err) => {
  process.stderr.write(`[pixel-city-messages-control] Fatal: ${err.message}\n`)
  process.exit(1)
})
