/**
 * In-memory implementation of MessageStore.
 *
 * Useful for:
 *  - Tests
 *  - Ephemeral sessions where persistence isn't needed
 *  - Development without network
 */

import type { AgentMessage, MessageQuery, MessageStore } from './types'

function generateId(): string {
  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 8)
  return `msg-${ts}-${rand}`
}

export class InMemoryMessageStore implements MessageStore {
  /** Inbox per agent: agentId → messages */
  private inboxes = new Map<string, AgentMessage[]>()

  private getInbox(agentId: string): AgentMessage[] {
    if (!this.inboxes.has(agentId)) this.inboxes.set(agentId, [])
    return this.inboxes.get(agentId)!
  }

  async send(partial: Omit<AgentMessage, 'id' | 'timestamp' | 'read'>): Promise<AgentMessage> {
    const message: AgentMessage = {
      ...partial,
      id: generateId(),
      timestamp: Date.now(),
      read: false,
    }
    this.getInbox(message.to).push(message)
    return message
  }

  async query(q: MessageQuery): Promise<AgentMessage[]> {
    let messages = [...this.getInbox(q.agentId)]

    if (q.from !== undefined) {
      messages = messages.filter(m => m.from === q.from)
    }
    if (q.unreadOnly) {
      messages = messages.filter(m => !m.read)
    }

    // Sort newest first
    messages.sort((a, b) => b.timestamp - a.timestamp)

    const offset = q.offset ?? 0
    const limit = q.limit ?? 50
    return messages.slice(offset, offset + limit)
  }

  async markRead(agentId: string, messageId: string): Promise<AgentMessage | null> {
    const inbox = this.getInbox(agentId)
    const msg = inbox.find(m => m.id === messageId)
    if (!msg) return null
    msg.read = true
    return { ...msg }
  }

  async get(agentId: string, messageId: string): Promise<AgentMessage | null> {
    const inbox = this.getInbox(agentId)
    const msg = inbox.find(m => m.id === messageId)
    return msg ? { ...msg } : null
  }

  async clearInbox(agentId: string): Promise<void> {
    this.inboxes.delete(agentId)
  }
}
