/**
 * WebSocket client for the MCP Bridge — connection lifecycle, send/receive, debug logging.
 */
import type { McpCommand, WsFrameCallback } from './types.js'

const WS_PORT = import.meta.env.DEV ? 19840 : 19841
const WS_URL = `ws://localhost:${WS_PORT}`
const RECONNECT_DELAY_MS = 1500

let bridgeWs: WebSocket | null = null
let wsFrameCallback: WsFrameCallback | null = null

export function registerWsFrameCallback(cb: WsFrameCallback) {
  wsFrameCallback = cb
}

export function summariseFrame(msg: Record<string, unknown>): string {
  switch (msg.type) {
    case 'renderer-connect': return 'renderer-connect'
    case 'mcp-command': return `mcp-command #${msg.requestId} ${msg.action}`
    case 'mcp-response':
      return `mcp-response #${msg.requestId}${msg.error ? ` ERR: ${String(msg.error).slice(0, 60)}` : ' ok'}`
    case 'office-event': return `office-event ${msg.event}`
    default: return msg.type ? String(msg.type) : JSON.stringify(msg).slice(0, 80)
  }
}

export function wsSend(msg: Record<string, unknown>) {
  if (bridgeWs?.readyState === WebSocket.OPEN) {
    bridgeWs.send(JSON.stringify(msg))
    wsFrameCallback?.('tx', summariseFrame(msg))
  }
}

export function sendResponse(requestId: number, result?: unknown, error?: string) {
  const msg: Record<string, unknown> = { type: 'mcp-response', requestId }
  if (error !== undefined) msg.error = error
  else msg.result = result
  wsSend(msg)
}

/** Send an office-side event to all external WS clients via the main process. */
export function emitOfficeEvent(event: string, data: Record<string, unknown> = {}) {
  wsSend({ type: 'office-event', event, ...data })
}

export function connectBridgeWs(onCommand: (cmd: McpCommand) => void) {
  const ws = new WebSocket(WS_URL)

  ws.onopen = () => {
    bridgeWs = ws
    wsSend({ type: 'renderer-connect' })
    console.log('[MCP Bridge] Renderer WebSocket connected')
  }

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data as string) as Record<string, unknown>
      wsFrameCallback?.('rx', summariseFrame(msg))
      if (msg.type === 'mcp-command') {
        onCommand(msg as unknown as McpCommand)
      }
    } catch { /* ignore malformed */ }
  }

  ws.onclose = () => {
    bridgeWs = null
    console.log('[MCP Bridge] Renderer WebSocket disconnected, reconnecting...')
    setTimeout(() => connectBridgeWs(onCommand), RECONNECT_DELAY_MS)
  }

  ws.onerror = () => {
    // onclose will fire after onerror, which handles reconnect
    ws.close()
  }
}
