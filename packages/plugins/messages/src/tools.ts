// Messages Plugin -- MCP Tool Definitions (injection point 2)
// Tool schemas + handlers co-located. Handlers run in the renderer
// when agents call these tools via MCP.

import { z } from 'zod'
import { getMessageStore } from './messaging/index.js'
import type { AgentMessage } from './messaging/types.js'
import type { PluginToolDefinition } from '@pixel-city/core'

export const messagesTools: PluginToolDefinition[] = [
  {
    name: 'send_message',
    description: 'Send a message to another agent in the office. Use this to report results, request help, or notify a teamlead that you are done with a task.',
    schema: {
      to: z.string().describe('Recipient agent ID'),
      subject: z.string().describe('Short subject line'),
      body: z.string().describe('Full message content'),
      type: z.enum(['result', 'status', 'request', 'info']).optional().describe('Message type (default: info)'),
      replyTo: z.string().optional().describe('ID of the message you are replying to'),
    },
    async: true,
    handler: async (params) => {
      const store = getMessageStore()
      const from = params.from as string
      const fromName = (params.fromName as string) ?? undefined
      const to = params.to as string
      const subject = params.subject as string
      const body = params.body as string
      const type = (params.type as AgentMessage['type']) ?? 'info'
      const replyTo = (params.replyTo as string) ?? undefined
      if (from === undefined) throw new Error('Missing sender (from)')
      if (to === undefined) throw new Error('Missing recipient (to)')
      if (!subject) throw new Error('Missing subject')
      if (!body) throw new Error('Missing body')
      const message = await store.send({ from, fromName, to, type, subject, body, replyTo })
      return { success: true, messageId: message.id, timestamp: message.timestamp }
    },
  },

  {
    name: 'check_messages',
    description: 'Check your inbox for messages from other agents. Returns unread messages by default. Call this periodically when waiting for sub-agent results.',
    schema: {
      from: z.string().optional().describe('Filter messages from a specific agent ID'),
      unreadOnly: z.boolean().optional().describe('Only return unread messages (default: true)'),
    },
    async: true,
    handler: async (params) => {
      const store = getMessageStore()
      const agentId = params.agentId as string
      const from = params.from as string | undefined
      const unreadOnly = (params.unreadOnly as boolean) ?? true
      if (agentId === undefined) throw new Error('Missing agentId')
      const messages = await store.query({ agentId, from, unreadOnly })
      return { messages, count: messages.length }
    },
  },

  {
    name: 'read_message',
    description: 'Read a specific message by ID and mark it as read.',
    schema: {
      messageId: z.string().describe('ID of the message to read'),
    },
    async: true,
    handler: async (params) => {
      const store = getMessageStore()
      const agentId = params.agentId as string
      const messageId = params.messageId as string
      if (agentId === undefined) throw new Error('Missing agentId')
      if (!messageId) throw new Error('Missing messageId')
      const message = await store.markRead(agentId, messageId)
      if (!message) throw new Error(`Message "${messageId}" not found`)
      return { message }
    },
  },

  {
    name: 'list_messages',
    description: 'List all messages in your inbox (both read and unread), sorted newest first.',
    schema: {
      limit: z.number().optional().describe('Max messages to return (default: 20)'),
      offset: z.number().optional().describe('Skip first N messages (default: 0)'),
    },
    async: true,
    handler: async (params) => {
      const store = getMessageStore()
      const agentId = params.agentId as string
      const limit = (params.limit as number) ?? 20
      const offset = (params.offset as number) ?? 0
      if (agentId === undefined) throw new Error('Missing agentId')
      const messages = await store.query({ agentId, unreadOnly: false, limit, offset })
      return { messages, count: messages.length }
    },
  },
]
