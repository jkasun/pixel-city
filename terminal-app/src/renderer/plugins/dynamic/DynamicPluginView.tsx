// ── Dynamic Plugin View ─────────────────────────────────────────────
// Renders a dynamic plugin's HTML inside a sandboxed iframe with a
// postMessage bridge for state, tool calls, and host actions.

import React, { useEffect, useRef, useCallback, useMemo } from 'react'
import { buildBridgeScript } from './bridgeScript.js'
import { subscribeDynamicPluginState, updateDynamicPluginState } from './dynamicPluginDbLocal.js'
import { registerPluginView, unregisterPluginView } from './dynamicPluginBridge.js'
import { usePluginHost } from '../PluginHostProvider.js'
import { callTool } from '../../mcpBridge.js'
import type { PluginProps } from '../types.js'
import type { DynamicPluginRecord } from './types.js'

interface DynamicPluginViewProps extends PluginProps {
  record: DynamicPluginRecord
  buildingId: string
}

export function DynamicPluginView({ record, buildingId, host, visible }: DynamicPluginViewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const pendingToolCalls = useRef(new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>())
  const toolCallIdRef = useRef(0)
  const iframeReadyRef = useRef(false)
  const pluginHost = usePluginHost()

  // Build the srcDoc with bridge script prepended
  const srcDoc = useMemo(() => {
    const agentNamesObj: Record<string, string> = {}
    host.agentNames.forEach((name, id) => { agentNamesObj[id] = name })

    const bridgeJs = buildBridgeScript(record.state ?? {}, {
      agentIds: host.agentIds,
      agentNames: agentNamesObj,
      buildingId,
      activeAgentId: host.activeAgentId,
    })

    // Inject bridge script before the closing </head> or at the start of HTML
    const html = record.html
    if (html.includes('</head>')) {
      return html.replace('</head>', bridgeJs + '</head>')
    }
    if (html.includes('<head>')) {
      return html.replace('<head>', '<head>' + bridgeJs)
    }
    // No <head> tag — prepend
    return bridgeJs + html
  }, [record.html, record.state, host.agentIds, host.agentNames, host.activeAgentId, buildingId])

  // Post a message into the iframe
  const postToIframe = useCallback((type: string, payload: Record<string, unknown> = {}) => {
    const iframe = iframeRef.current
    if (!iframe?.contentWindow) return
    iframe.contentWindow.postMessage({ __pixelCity: true, type, ...payload }, '*')
  }, [])

  // Subscribe to RTDB state changes and push into iframe
  useEffect(() => {
    const unsub = subscribeDynamicPluginState(buildingId, record.id, (state) => {
      postToIframe('state-update', { state })
    })
    return unsub
  }, [buildingId, record.id, postToIframe])

  // Push context updates when host context changes
  useEffect(() => {
    if (!iframeReadyRef.current) return
    const agentNamesObj: Record<string, string> = {}
    host.agentNames.forEach((name, id) => { agentNamesObj[id] = name })
    postToIframe('context-update', {
      context: {
        agentIds: host.agentIds,
        agentNames: agentNamesObj,
        buildingId,
        activeAgentId: host.activeAgentId,
      },
    })
  }, [host.agentIds, host.agentNames, host.activeAgentId, buildingId, postToIframe])

  // Dispatch a tool call into the iframe, returns a promise
  const dispatchToolCall = useCallback((toolName: string, params: Record<string, unknown>): Promise<unknown> => {
    return new Promise((resolve, reject) => {
      const callId = ++toolCallIdRef.current
      const timeout = setTimeout(() => {
        pendingToolCalls.current.delete(callId)
        reject(new Error(`Tool call "${toolName}" timed out after 10s`))
      }, 10000)

      pendingToolCalls.current.set(callId, {
        resolve: (v) => { clearTimeout(timeout); resolve(v) },
        reject: (e) => { clearTimeout(timeout); reject(e) },
      })

      postToIframe('tool-call', { callId, toolName, params })
    })
  }, [postToIframe])

  // Register with the global bridge so mcpBridge can dispatch tool calls here
  useEffect(() => {
    registerPluginView(record.id, { dispatchToolCall })
    return () => unregisterPluginView(record.id)
  }, [record.id, dispatchToolCall])

  // Listen for postMessage from iframe
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (!e.data?.__pixelCity) return
      // Verify source is our iframe
      const iframe = iframeRef.current
      if (!iframe?.contentWindow || e.source !== iframe.contentWindow) return

      const msg = e.data
      switch (msg.type) {
        case 'ready':
          iframeReadyRef.current = true
          break

        case 'state-set':
          updateDynamicPluginState(buildingId, record.id, msg.value).catch((err) => {
            console.error(`[DynamicPlugin:${record.id}] Failed to write state:`, err)
          })
          break

        case 'tool-response': {
          const pending = pendingToolCalls.current.get(msg.callId)
          if (pending) {
            pendingToolCalls.current.delete(msg.callId)
            if (msg.error) pending.reject(new Error(msg.error))
            else pending.resolve(msg.result)
          }
          break
        }

        case 'host-action': {
          const { callId, action, params } = msg
          ;(async () => {
            try {
              let result: unknown
              switch (action) {
                case 'showNotification':
                  pluginHost.showNotification(params.msg, params.level)
                  result = { success: true }
                  break
                case 'selectAgent':
                  pluginHost.selectAgent(params.agentId)
                  result = { success: true }
                  break
                case 'switchToPlugin':
                  pluginHost.switchToPlugin(params.pluginId)
                  result = { success: true }
                  break
                case 'sendPtyInput':
                  result = await callTool('send_pty_input', {
                    id: params.agentId,
                    message: params.message,
                    pressEnter: params.pressEnter ?? true,
                  })
                  break
                case 'listAgents':
                  result = await callTool('list_agents', {})
                  break
                default:
                  throw new Error(`Unknown host action: ${action}`)
              }
              postToIframe('action-response', { callId, result })
            } catch (err: any) {
              postToIframe('action-response', { callId, error: err.message })
            }
          })()
          break
        }
      }
    }

    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [buildingId, record.id, pluginHost, postToIframe])

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      style={{ flex: 1, border: 'none', width: '100%', height: '100%', background: '#fff' }}
      title={record.name}
    />
  )
}
