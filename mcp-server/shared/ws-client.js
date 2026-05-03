import WebSocket from 'ws'
import { WS_URL, CONNECT_TIMEOUT, REQUEST_TIMEOUT } from './env.js'

let ws = null
let msgIdCounter = 1
const pendingRequests = new Map()

// Reconnection state
let reconnectTimer = null
let reconnectAttempt = 0
const MAX_RECONNECT_DELAY = 10000
const BASE_RECONNECT_DELAY = 500

function getReconnectDelay() {
  // Exponential backoff: 500ms, 1s, 2s, 4s, 8s, capped at 10s
  const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempt), MAX_RECONNECT_DELAY)
  return delay
}

function scheduleReconnect() {
  if (reconnectTimer) return
  const delay = getReconnectDelay()
  reconnectAttempt++
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connectWs().catch(() => {
      // Failed to reconnect — schedule another attempt
      scheduleReconnect()
    })
  }, delay)
}

export function connectWs() {
  return new Promise((resolve, reject) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      resolve()
      return
    }

    const socket = new WebSocket(WS_URL)
    const timeout = setTimeout(() => {
      socket.terminate()
      reject(new Error(`Connection to Pixel City timed out (${WS_URL})`))
    }, CONNECT_TIMEOUT)

    socket.on('open', () => {
      clearTimeout(timeout)
      ws = socket
      reconnectAttempt = 0 // Reset backoff on successful connection
      resolve()
    })

    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg.id !== undefined && pendingRequests.has(msg.id)) {
          const { resolve, reject } = pendingRequests.get(msg.id)
          pendingRequests.delete(msg.id)
          if (msg.error) reject(new Error(msg.error))
          else resolve(msg.result)
        } else if (msg.type === 'event') {
          process.stderr.write(`[pixel-city-mcp] office event: ${msg.event} ${JSON.stringify(msg)}\n`)
        }
      } catch { /* ignore malformed messages */ }
    })

    socket.on('close', () => {
      const wasConnected = ws === socket
      if (ws === socket) ws = null

      // Reject all pending requests — they can't be retried since the
      // response would go to the old socket
      for (const [id, { reject }] of pendingRequests) {
        reject(new Error('WebSocket connection closed'))
        pendingRequests.delete(id)
      }

      // Auto-reconnect if this was our active connection
      if (wasConnected) {
        scheduleReconnect()
      }
    })

    socket.on('error', (err) => {
      clearTimeout(timeout)
      reject(new Error(`Cannot connect to Pixel City: ${err.message}`))
    })
  })
}

export async function ensureConnected() {
  if (ws && ws.readyState === WebSocket.OPEN) return
  // Cancel any scheduled reconnect — we're connecting now
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  await connectWs()
}

export function sendCommand(action, params = {}, timeoutMs = REQUEST_TIMEOUT) {
  const id = msgIdCounter++

  // Avoid async executor anti-pattern — chain the promise properly
  return ensureConnected().then(() => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRequests.delete(id)
        reject(new Error(`Request timed out: ${action}`))
      }, timeoutMs)

      pendingRequests.set(id, {
        resolve: (result) => { clearTimeout(timeout); resolve(result) },
        reject: (err) => { clearTimeout(timeout); reject(err) },
      })

      ws.send(JSON.stringify({ id, action, params }))
    })
  })
}
