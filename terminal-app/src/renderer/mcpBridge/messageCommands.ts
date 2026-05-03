/**
 * Agent-to-agent messaging async command handlers for the MCP Bridge.
 *
 * Delegates to the main-process message store via IPC for authoritative
 * storage that survives renderer window creation/destruction.
 */

// Side-effect: triggers setMessageStore(new PubSubMessageStore(...)) so the
// plugin's MessagesView gets the IPC-backed store instead of InMemoryMessageStore.
import '../messaging/index.js'
import type { AgentMessage } from '../messaging/types.js'

const { ipcRenderer } = window.require('electron') as typeof import('electron')

export async function executeMessageAction(
  action: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  switch (action) {
    case 'send_message': {
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
      const message = await ipcRenderer.invoke('messages-send', { from, fromName, to, type, subject, body, replyTo })
      return { success: true, messageId: message.id, timestamp: message.timestamp }
    }

    case 'check_messages': {
      const agentId = params.agentId as string
      const from = params.from as string | undefined
      const unreadOnly = (params.unreadOnly as boolean) ?? true
      if (agentId === undefined) throw new Error('Missing agentId')
      const messages = await ipcRenderer.invoke('messages-query', { agentId, from, unreadOnly })
      return { messages, count: messages.length }
    }

    case 'read_message': {
      const agentId = params.agentId as string
      const messageId = params.messageId as string
      if (agentId === undefined) throw new Error('Missing agentId')
      if (!messageId) throw new Error('Missing messageId')
      const message = await ipcRenderer.invoke('messages-mark-read', { agentId, messageId })
      if (!message) throw new Error(`Message "${messageId}" not found`)
      return { message }
    }

    case 'list_messages': {
      const agentId = params.agentId as string
      const limit = (params.limit as number) ?? 20
      const offset = (params.offset as number) ?? 0
      if (agentId === undefined) throw new Error('Missing agentId')
      const messages = await ipcRenderer.invoke('messages-query', { agentId, unreadOnly: false, limit, offset })
      return { messages, count: messages.length }
    }

    default:
      throw new Error(`Unknown message action: ${action}`)
  }
}

/** All action names handled by this module (async). */
export const MESSAGE_ACTIONS = new Set([
  'send_message', 'check_messages', 'read_message', 'list_messages',
])
