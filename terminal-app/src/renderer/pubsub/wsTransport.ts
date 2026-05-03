/**
 * WebSocket transport — connects to a local WS pubsub server
 * for fully local operation (no external dependencies).
 *
 * Protocol (JSON messages over WebSocket):
 *   → { type: "subscribe", pattern: "foo/#" }
 *   → { type: "unsubscribe", pattern: "foo/#" }
 *   → { type: "publish", topic: "foo/bar", payload: "...", retain?: true }
 *   ← { type: "message", topic: "foo/bar", payload: "..." }
 */

import type { PubSubTransport, MessageHandler } from './types'

interface WsProtocolMessage {
  type: 'subscribe' | 'unsubscribe' | 'publish' | 'message'
  topic?: string
  pattern?: string
  payload?: string
  retain?: boolean
}

export class WsTransport implements PubSubTransport {
  private ws: WebSocket | null = null
  private _connected = false
  private handlers = new Set<MessageHandler>()
  private pendingSubscriptions: string[] = []
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  constructor(private url: string) {}

  async connect(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.doConnect(resolve)
      setTimeout(() => resolve(), 5000)
    })
  }

  private doConnect(onFirstConnect?: () => void): void {
    if (this.disposed) return
    try {
      this.ws = new WebSocket(this.url)
    } catch (err) {
      console.warn('[WsTransport] failed to create WebSocket:', err)
      this.scheduleReconnect()
      return
    }

    this.ws.onopen = () => {
      this._connected = true
      console.log(`[WsTransport] connected to ${this.url}`)
      // Re-subscribe any pending patterns
      for (const pattern of this.pendingSubscriptions) {
        this.sendJson({ type: 'subscribe', pattern })
      }
      onFirstConnect?.()
      onFirstConnect = undefined
    }

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as WsProtocolMessage
        if (msg.type === 'message' && msg.topic && msg.payload !== undefined) {
          for (const handler of this.handlers) {
            try { handler(msg.topic, msg.payload) } catch (_) {}
          }
        }
      } catch (_) {}
    }

    this.ws.onclose = () => {
      this._connected = false
      if (!this.disposed) this.scheduleReconnect()
    }

    this.ws.onerror = () => {
      // onclose will fire after this
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.doConnect()
    }, 3000)
  }

  private sendJson(msg: WsProtocolMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  publish(topic: string, payload: string, options?: { retain?: boolean }): void {
    this.sendJson({ type: 'publish', topic, payload, retain: options?.retain })
  }

  subscribe(pattern: string): void {
    if (!this.pendingSubscriptions.includes(pattern)) {
      this.pendingSubscriptions.push(pattern)
    }
    this.sendJson({ type: 'subscribe', pattern })
  }

  unsubscribe(pattern: string): void {
    this.pendingSubscriptions = this.pendingSubscriptions.filter(p => p !== pattern)
    this.sendJson({ type: 'unsubscribe', pattern })
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler)
    return () => { this.handlers.delete(handler) }
  }

  get connected(): boolean { return this._connected }

  dispose(): void {
    this.disposed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
      this.ws = null
      this._connected = false
    }
    this.handlers.clear()
  }
}
