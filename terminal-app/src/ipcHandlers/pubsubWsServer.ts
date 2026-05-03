/**
 * Local WebSocket PubSub Server.
 *
 * A lightweight topic-based pub/sub broker running in the Electron main process.
 * Separate from the MCP WebSocket server (port 19840/19841) and test server (19842).
 *
 * Port: 19850
 *
 * Protocol (JSON):
 *   Client → Server:
 *     { type: "subscribe", pattern: "foo/#" }
 *     { type: "unsubscribe", pattern: "foo/#" }
 *     { type: "publish", topic: "foo/bar", payload: "...", retain?: true }
 *
 *   Server → Client:
 *     { type: "message", topic: "foo/bar", payload: "..." }
 *
 * Supports topic wildcard patterns:
 *   # — matches any remaining path segments (e.g., "foo/#" matches "foo/bar/baz")
 *   + — matches a single path segment (e.g., "foo/+/baz" matches "foo/bar/baz")
 */

import { WebSocketServer, WebSocket } from 'ws'
import { config } from '../config'

const PUBSUB_WS_PORT = config.ports.pubsubWs

interface ClientSubscription {
  pattern: string
  regex: RegExp
}

interface PubSubClient {
  ws: WebSocket
  subscriptions: ClientSubscription[]
}

/** Retained messages: topic → payload */
const retainedMessages = new Map<string, string>()
const clients = new Set<PubSubClient>()
let wss: WebSocketServer | null = null

/** Convert a topic wildcard pattern to a regex. */
function patternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // escape regex special chars
    .replace(/\\#/g, '.*')                   // # → match anything
    .replace(/\\\+/g, '[^/]+')               // + → match single segment
  return new RegExp(`^${escaped}$`)
}

function matchesTopic(pattern: ClientSubscription, topic: string): boolean {
  return pattern.regex.test(topic)
}

function broadcastToSubscribers(topic: string, payload: string, exclude?: WebSocket): void {
  const msg = JSON.stringify({ type: 'message', topic, payload })
  for (const client of clients) {
    if (client.ws === exclude) continue
    if (client.ws.readyState !== WebSocket.OPEN) continue
    if (client.subscriptions.some(sub => matchesTopic(sub, topic))) {
      client.ws.send(msg)
    }
  }
}

function sendRetainedMessages(client: PubSubClient): void {
  for (const [topic, payload] of retainedMessages) {
    if (client.subscriptions.some(sub => matchesTopic(sub, topic))) {
      client.ws.send(JSON.stringify({ type: 'message', topic, payload }))
    }
  }
}

export function startPubSubWsServer(): void {
  if (wss) return

  wss = new WebSocketServer({ port: PUBSUB_WS_PORT })
  console.log(`[PubSub WS] Server listening on ws://localhost:${PUBSUB_WS_PORT}`)

  wss.on('connection', (ws) => {
    const client: PubSubClient = { ws, subscriptions: [] }
    clients.add(client)

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString())

        switch (msg.type) {
          case 'subscribe': {
            const pattern = msg.pattern as string
            if (!pattern) break
            // Avoid duplicate subscriptions
            if (!client.subscriptions.some(s => s.pattern === pattern)) {
              client.subscriptions.push({ pattern, regex: patternToRegex(pattern) })
              // Send retained messages matching this new subscription
              sendRetainedMessages(client)
            }
            break
          }
          case 'unsubscribe': {
            const pattern = msg.pattern as string
            if (!pattern) break
            client.subscriptions = client.subscriptions.filter(s => s.pattern !== pattern)
            break
          }
          case 'publish': {
            const topic = msg.topic as string
            const payload = msg.payload as string
            if (!topic || payload === undefined) break

            // Store retained messages
            if (msg.retain) {
              if (payload === '') {
                retainedMessages.delete(topic) // empty payload clears retained
              } else {
                retainedMessages.set(topic, payload)
              }
            }

            // Broadcast to all matching subscribers (including sender)
            broadcastToSubscribers(topic, payload)
            break
          }
        }
      } catch (_) {}
    })

    ws.on('close', () => {
      clients.delete(client)
    })

    ws.on('error', () => {
      clients.delete(client)
    })
  })

  wss.on('error', (err) => {
    console.warn('[PubSub WS] Server error:', err.message)
  })
}

export function stopPubSubWsServer(): void {
  if (wss) {
    for (const client of clients) {
      client.ws.close()
    }
    clients.clear()
    retainedMessages.clear()
    wss.close()
    wss = null
    console.log('[PubSub WS] Server stopped')
  }
}
