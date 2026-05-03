/**
 * PubSub event relay for messaging UI.
 *
 * Subscribes to PubSub topics and emits events for real-time UI updates
 * (bubble animations, message count badges, etc.). Does NOT store messages —
 * authoritative storage lives in the main process (messageStore.ts via IPC).
 *
 * Topics:
 *   pixelcity/messages/{agentId}/message_sent  — new message delivered
 *   pixelcity/messages/{agentId}/message_read  — message marked as read
 *   pixelcity/messages/{agentId}/inbox_cleared — inbox cleared
 */

import type { PubSubTransport } from '../pubsub/types'
import type { AgentMessage, MessageQuery, MessageStore } from './types'

const TOPIC_PREFIX = 'pixelcity/messages'

export type MessageEventType = 'message_sent' | 'message_read' | 'inbox_cleared'

export interface MessageEvent {
  type: MessageEventType
  agentId: string
  data: unknown
  timestamp: number
}

type MessageEventHandler = (event: MessageEvent) => void

export class PubSubMessageStore implements MessageStore {
  private transport: PubSubTransport
  private eventHandlers = new Set<MessageEventHandler>()
  private unsubTransport: (() => void) | null = null

  constructor(transport: PubSubTransport) {
    this.transport = transport
    this.transport.subscribe(`${TOPIC_PREFIX}/#`)
    this.unsubTransport = this.transport.onMessage((topic, payload) => {
      this.handleIncoming(topic, payload)
    })
  }

  /** Subscribe to message events for UI updates. */
  onEvent(handler: MessageEventHandler): () => void {
    this.eventHandlers.add(handler)
    return () => { this.eventHandlers.delete(handler) }
  }

  private emit(event: MessageEvent): void {
    for (const handler of this.eventHandlers) {
      try { handler(event) } catch (_) {}
    }
  }

  private handleIncoming(topic: string, payload: string): void {
    if (!topic.startsWith(TOPIC_PREFIX)) return
    try {
      const data = JSON.parse(payload) as MessageEvent
      if (!data.type || !data.agentId) return
      // Emit event for UI updates — no local storage (IPC store is authoritative)
      this.emit(data)
    } catch (_) {}
  }

  // ── MessageStore Interface (delegated to main-process IPC) ─────
  // These methods satisfy the interface but should not be called directly.
  // All reads/writes go through ipcRenderer.invoke('messages-*') now.

  async send(partial: Omit<AgentMessage, 'id' | 'timestamp' | 'read'>): Promise<AgentMessage> {
    const { ipcRenderer } = window.require('electron') as typeof import('electron')
    const msg = await ipcRenderer.invoke('messages-send', partial)
    // Publish to PubSub for real-time UI updates across windows
    const event: MessageEvent = { type: 'message_sent', agentId: msg.to, data: msg, timestamp: Date.now() }
    this.transport.publish(`${TOPIC_PREFIX}/${msg.to}/message_sent`, JSON.stringify(event))
    this.emit(event)
    return msg
  }

  async query(q: MessageQuery): Promise<AgentMessage[]> {
    const { ipcRenderer } = window.require('electron') as typeof import('electron')
    return ipcRenderer.invoke('messages-query', q)
  }

  async markRead(agentId: string, messageId: string): Promise<AgentMessage | null> {
    const { ipcRenderer } = window.require('electron') as typeof import('electron')
    const msg = await ipcRenderer.invoke('messages-mark-read', { agentId, messageId })
    if (msg) {
      const event: MessageEvent = { type: 'message_read', agentId, data: { messageId }, timestamp: Date.now() }
      this.transport.publish(`${TOPIC_PREFIX}/${agentId}/message_read`, JSON.stringify(event))
      this.emit(event)
    }
    return msg
  }

  async get(agentId: string, messageId: string): Promise<AgentMessage | null> {
    const { ipcRenderer } = window.require('electron') as typeof import('electron')
    return ipcRenderer.invoke('messages-get', { agentId, messageId })
  }

  async clearInbox(agentId: string): Promise<void> {
    const { ipcRenderer } = window.require('electron') as typeof import('electron')
    await ipcRenderer.invoke('messages-clear', { agentId })
    const event: MessageEvent = { type: 'inbox_cleared', agentId, data: { agentId }, timestamp: Date.now() }
    this.transport.publish(`${TOPIC_PREFIX}/${agentId}/inbox_cleared`, JSON.stringify(event))
    this.emit(event)
  }

  dispose(): void {
    this.unsubTransport?.()
    this.transport.unsubscribe(`${TOPIC_PREFIX}/#`)
    this.eventHandlers.clear()
  }

  get isConnected(): boolean {
    return this.transport.connected
  }
}
