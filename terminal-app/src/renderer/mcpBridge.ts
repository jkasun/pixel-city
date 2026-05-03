/**
 * MCP Bridge — connects to the main-process WebSocket server and handles
 * commands from external MCP clients (e.g. mcp-server/index.js).
 *
 * All command routing now flows over WebSocket instead of Electron IPC:
 *   External client → WS → main.js → WS → renderer (here) → WS → main.js → External client
 *
 * IPC is still used for filesystem operations.
 */
import type { OfficeState } from '@pixel-city/shared/office/engine/officeState'
import { loadNotificationSettings, COLUMN_NOTIFICATION_MAP } from './settings/settingsManager.js'
import { executeTaskAction, TASK_ACTIONS } from './mcpBridge/taskCommands.js'
import { executeMessageAction, MESSAGE_ACTIONS } from './mcpBridge/messageCommands.js'
import { executeDynamicPluginAction, DYNAMIC_PLUGIN_ACTIONS } from './mcpBridge/dynamicPluginCommands.js'
import { executePluginToolAction, PLUGIN_TOOL_ACTIONS } from './mcpBridge/pluginToolCommands.js'
import { executeCanvasAction, CANVAS_ACTIONS, hydrateCanvasesFromDisk, switchCanvasSession } from './mcpBridge/canvasCommands.js'
import { setActiveSessionForAgent } from './mcpBridge/canvasSessionResolver.js'
import { createEmployeeInRtdb, listEmployeesFromRtdb, deleteEmployeeFromRtdb } from './employee/employeeDbLocal'
import type { PermanentEmployeeSettings } from './office/officeAppTypes'
import { playIdleChime } from '@pixel-city/shared/office/engine/soundEffects'
import { generateAgentId } from '@pixel-city/shared/utils/agentId'
import { getPermanentIdForAgent, officeRegistry } from './office/officeStateRefs.js'
import { autoSpawnPermanentInvitee } from './office/autoSpawnPermanentInvitee.js'


const WS_PORT = import.meta.env.DEV ? 19840 : 19841
const WS_URL = `ws://localhost:${WS_PORT}`
const RECONNECT_DELAY_MS = 1500

// Global registry for the active OfficeState
let activeOfficeState: OfficeState | null = null

// Track which agents are under MCP control (PTY/JSONL events are paused for these)
const mcpControlledAgents = new Set<string>()

/** Check if an agent is currently under MCP control */
export function isAgentMcpControlled(agentId: string): boolean {
  return mcpControlledAgents.has(agentId)
}

/** Auto-idle an MCP-controlled agent when their turn ends (JSONL turn_duration detected) */
export function autoIdleMcpAgent(agentId: string): void {
  if (!mcpControlledAgents.has(agentId)) return
  mcpControlledAgents.delete(agentId)
  if (activeOfficeState) {
    activeOfficeState.setAgentActive(agentId, false)
    activeOfficeState.setWorkerStatus(agentId, 'idle')
    activeOfficeState.setAgentStatusText(agentId, null)
    activeOfficeState.showWaitingBubble(agentId)
  }
  statusCallback?.(agentId, null)
  workerStatusCallback?.(agentId, 'idle')
  mcpDebug(agentId, `auto-idle on turn_duration (mcp_control: false)`)
  playIdleChime()
}

let addAgentCallback: ((agentId: string, palette: number, name: string, model: string, buildingId: string | null, initialMessage?: string, permanentId?: string) => void) | null = null
let removeAgentCallback: ((agentId: string) => void) | null = null
let listAgentsCallback: (() => Array<{ id: string; name: string; palette: number; model: string; active: boolean }>) | null = null
let statusCallback: ((agentId: string, status: string | null) => void) | null = null
let workerStatusCallback: ((agentId: string, status: 'idle' | 'working' | 'tool') => void) | null = null
let debugCallback: ((agentId: string, kind: 'mcp', label: string) => void) | null = null
let sendPtyInputCallback: ((agentId: string, data: string) => { success: boolean; error?: string }) | null = null
let getAgentLastOutputAtCallback: ((agentId: string) => number | undefined) | null = null

/** Check if agent is currently busy (producing output within last 2s). */
function isAgentBusy(agentId: string): boolean {
  if (!getAgentLastOutputAtCallback) return false
  const lastOutput = getAgentLastOutputAtCallback(agentId)
  if (!lastOutput) return false
  return Date.now() - lastOutput < 2000
}

// Submit the trailing Enter that follows a bracketed-paste write. If we just
// fire \r on a fixed 150ms timer, an active Claude Code turn swallows it —
// the paste lands in the input box but never submits. Poll until the agent
// has been idle for the busy-window and only then send \r. Falls back to
// firing anyway after maxWaitMs so a perpetually-noisy agent doesn't strand
// the message forever.
function submitEnterWhenIdle(agentId: string, maxWaitMs: number = 30_000): void {
  if (!sendPtyInputCallback) return
  const startedAt = Date.now()
  const trySubmit = () => {
    if (!sendPtyInputCallback) return
    if (isAgentBusy(agentId) && Date.now() - startedAt < maxWaitMs) {
      setTimeout(trySubmit, 500)
      return
    }
    sendPtyInputCallback(agentId, '\r')
  }
  setTimeout(trySubmit, 150)
}

// Side-effects for a successful send_message: office event, bubble on recipient,
// PTY nudge, and auto-spawn fallback for offline permanent employees. Lives
// here (not in the messages plugin handler) because the current PluginHost
// does not expose sendPtyInput / addAgent / officeRegistry — every dispatch
// route that resolves send_message must call this or the agent stays asleep.
// TODO: once PluginHost grows those capabilities, move this into
// packages/plugins/messages/src/tools.ts so the action owns its side-effects.
function applySendMessageSideEffects(params: Record<string, unknown>): void {
  const to = params.to as string
  emitOfficeEvent('agent_message_received', {
    recipientId: to,
    senderId: params.from as string,
    subject: params.subject as string,
  })
  // Set bubble on recipient character
  if (activeOfficeState) {
    const ch = activeOfficeState.getCharacters().find(c => c.id === to)
    if (ch) ch.bubbleType = 'message'
  }
  // PTY nudge: inject a message notification into the recipient's terminal
  // so their Claude session sees it and can act on it
  const senderName = (params.fromName as string) || `Agent ${params.from}`
  const subject = (params.subject as string) || '(no subject)'
  const nudgeText = `[INBOX] New message from ${senderName}: "${subject}". Call check_messages() now to read it.`
  // Wrap in bracketed paste so Claude Code's TUI treats the text as
  // a single pasted block. The Enter that submits must arrive as a
  // separate write after the TUI finishes processing the paste —
  // otherwise it gets swallowed as part of the paste (same fix as hire wake-up).
  const BRACKETED_PASTE_START = '\x1b[200~'
  const BRACKETED_PASTE_END = '\x1b[201~'
  const nudgePaste = BRACKETED_PASTE_START + nudgeText + BRACKETED_PASTE_END
  let nudgeSent = false
  if (sendPtyInputCallback) {
    try {
      const res = sendPtyInputCallback(to, nudgePaste)
      nudgeSent = res.success
      if (nudgeSent) {
        submitEnterWhenIdle(to)
      }
    } catch (_) {
      // Non-critical — agent might not have a terminal session
    }
  }
  if (!nudgeSent && addAgentCallback) {
    let permId = getPermanentIdForAgent(to)
    const toBuildingId =
      officeRegistry.getBuildingForAgent(to) ?? officeRegistry.getActiveBuilding()
    const toSnap = toBuildingId ? officeRegistry.getBuilding(toBuildingId) : null
    if (!permId && toSnap?.permanentEmployees.get(to)) permId = to
    if (permId && toBuildingId) {
      const initialMsg = `You have a new message. ${nudgeText}`
      const agentId = autoSpawnPermanentInvitee(
        permId,
        toBuildingId,
        { addAgent: addAgentCallback },
        initialMsg,
      )
      if (agentId) mcpDebug(agentId, `auto-spawned to receive message from ${senderName}`)
    }
  }
}

export function registerMcpDebugCallback(cb: (agentId: string, kind: 'mcp', label: string) => void) {
  debugCallback = cb
}

function mcpDebug(agentId: string, label: string) {
  debugCallback?.(agentId, 'mcp', label)
}

export function registerOfficeState(state: OfficeState) {
  activeOfficeState = state
}

/** Validate that a message recipient is a known agent ID */
function validateMessageRecipient(to: string): void {
  if (!to) throw new Error('Missing recipient agent ID (to)')
  const agents = listAgentsCallback?.()
  if (!agents) return // No list available — skip validation
  const found = agents.some(a => a.id === to)
  if (!found) {
    const known = agents.map(a => `${a.name} → ${a.id}`).join(', ')
    throw new Error(`Agent not found: "${to}". Use list_agents to find valid IDs. Known agents: ${known}`)
  }
}

/** Validate that an assignee key refers to someone currently in the office */
function validateAssigneeInOffice(assigneeKey: string): void {
  if (!assigneeKey) return
  if (!activeOfficeState) throw new Error(`Cannot assign to "${assigneeKey}" — no active office`)
  const chars = activeOfficeState.getCharacters()
  if (assigneeKey.startsWith('emp:')) {
    const empId = assigneeKey.slice(4)
    const found = chars.some(ch => ch.permanentId === empId)
    if (!found) throw new Error(`Employee "${empId}" is not currently in the office`)
  } else if (assigneeKey.startsWith('agent:')) {
    const agentId = assigneeKey.slice(6)
    const found = chars.some(ch => ch.id === agentId)
    if (!found) throw new Error(`Agent ${agentId} is not currently in the office`)
  }
}

export function unregisterOfficeState(state: OfficeState) {
  if (activeOfficeState === state) activeOfficeState = null
}

export function registerSendPtyInputCallback(cb: typeof sendPtyInputCallback) {
  sendPtyInputCallback = cb
}

export function registerGetAgentLastOutputAt(cb: (agentId: string) => number | undefined) {
  getAgentLastOutputAtCallback = cb
}

export function registerAgentCallbacks(cbs: {
  addAgent: typeof addAgentCallback
  removeAgent: typeof removeAgentCallback
  listAgents: typeof listAgentsCallback
  onStatus?: typeof statusCallback
  onWorkerStatus?: typeof workerStatusCallback
}) {
  addAgentCallback = cbs.addAgent
  removeAgentCallback = cbs.removeAgent
  listAgentsCallback = cbs.listAgents
  statusCallback = cbs.onStatus ?? null
  workerStatusCallback = cbs.onWorkerStatus ?? null
}

// --- WebSocket bridge ---

let bridgeWs: WebSocket | null = null

type WsFrameCallback = (direction: 'rx' | 'tx', summary: string) => void
let wsFrameCallback: WsFrameCallback | null = null

export function registerWsFrameCallback(cb: WsFrameCallback) {
  wsFrameCallback = cb
}

function summariseFrame(msg: Record<string, unknown>): string {
  switch (msg.type) {
    case 'renderer-connect': return 'renderer-connect'
    case 'mcp-command': return `mcp-command #${msg.requestId} ${msg.action}`
    case 'mcp-response':
      return `mcp-response #${msg.requestId}${msg.error ? ` ERR: ${String(msg.error).slice(0, 60)}` : ' ok'}`
    case 'office-event': return `office-event ${msg.event}`
    default: return msg.type ? String(msg.type) : JSON.stringify(msg).slice(0, 80)
  }
}

function wsSend(msg: Record<string, unknown>) {
  if (bridgeWs?.readyState === WebSocket.OPEN) {
    bridgeWs.send(JSON.stringify(msg))
    wsFrameCallback?.('tx', summariseFrame(msg))
  }
}

/** Send an office-side event to all external WS clients via the main process. */
export function emitOfficeEvent(event: string, data: Record<string, unknown> = {}) {
  wsSend({ type: 'office-event', event, ...data })
}

function sendResponse(requestId: number, result?: unknown, error?: string) {
  const msg: Record<string, unknown> = { type: 'mcp-response', requestId }
  if (error !== undefined) msg.error = error
  else msg.result = result
  wsSend(msg)
}

interface McpCommand {
  type: 'mcp-command'
  requestId: number
  action: string
  params: Record<string, unknown>
}

// ── Browser tab helpers ──────────────────────────────────────

/** Resolve tabId from params — prefers explicit tabId, falls back to agent-based lookup */
function resolveBrowserTabId(params: Record<string, unknown>): string | undefined {
  // Explicit tabId takes priority
  if (params.tabId) return params.tabId as string
  const agentId = params.agentId as string | undefined
  return agentId !== undefined ? `agent-${agentId}-0` : undefined
}

/** Resolve the browser bridge for a given tab (sync — for get_url, get_console_logs) */
function resolveBrowserBridge(params: Record<string, unknown>) {
  const tabId = resolveBrowserTabId(params)
  if (tabId) {
    const bridge = window.__pixelCityBrowserTabs?.get(tabId)
    if (bridge) return { bridge, tabId }
    throw new Error(`No browser tab "${tabId}". Navigate first to create a tab.`)
  }
  // Fall back to active tab
  const browser = window.__pixelCityBrowser
  if (!browser) throw new Error('Browser view not available')
  return { bridge: browser, tabId: undefined }
}

/** Resolve the browser bridge (async — auto-creates tab and waits for dom-ready) */
async function resolveBrowserBridgeAsync(params: Record<string, unknown>) {
  const agentId = params.agentId as string | undefined
  const agentName = params.agentName as string | undefined
  const explicitTabId = params.tabId as string | undefined

  if (agentId === undefined && !explicitTabId) {
    const browser = window.__pixelCityBrowser
    if (!browser) throw new Error('Browser view not available')
    return { bridge: browser, tabId: undefined }
  }

  // If explicit tabId, try to find it directly
  if (explicitTabId) {
    const bridge = window.__pixelCityBrowserTabs?.get(explicitTabId)
    if (bridge) return { bridge, tabId: explicitTabId }
    throw new Error(`No browser tab "${explicitTabId}". Navigate first to create it.`)
  }

  // Auto-create first tab for this agent if none exists
  const tabId = `agent-${agentId}-0`
  if (!window.__pixelCityBrowserTabs?.has(tabId)) {
    window.dispatchEvent(new CustomEvent('pixelcity:browser-create-tab', {
      detail: { agentId, agentName }
    }))
    // Wait for the webview to become ready
    const readyPromise = window.__pixelCityBrowserTabReady?.get(tabId)
    if (readyPromise) await readyPromise
  }
  const bridge = window.__pixelCityBrowserTabs?.get(tabId)
  if (!bridge) throw new Error(`Browser tab for agent ${agentId} failed to initialize`)
  return { bridge, tabId }
}

function handleCommand(cmd: McpCommand) {
  const { requestId, action, params } = cmd

  if (ASYNC_ACTIONS.has(action)) {
    handleCommandAsync(cmd)
    return
  }

  try {
    const result = executeAction(action, params)
    sendResponse(requestId, result)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    sendResponse(requestId, undefined, message)
  }
}

function executeAction(action: string, params: Record<string, unknown>): unknown {
  switch (action) {
    case 'ping':
      return { pong: true, timestamp: Date.now() }

    // Live identity lookup for MCP servers. MCP child processes cannot
    // trust PIXEL_CITY_EMPLOYEE_ID etc. from their spawn-time env because
    // agents can be hired/renamed/moved mid-session. Every permanent-only
    // gate should call this over the WS channel instead of reading env.
    case 'whoami': {
      const agentId = (params.agentId as string) ?? null
      if (!agentId) {
        return { agentId: null, name: null, employeeId: null, buildingId: null, isPermanent: false }
      }
      const employeeId = getPermanentIdForAgent(agentId)
      let name: string | null = null
      let buildingId: string | null = officeRegistry.getBuildingForAgent(agentId)
      if (employeeId && buildingId) {
        const snap = officeRegistry.getBuilding(buildingId)
        const emp = snap?.permanentEmployees.get(employeeId)
        if (emp) name = emp.settings.name ?? null
      }
      if (!name && activeOfficeState) {
        const ch = activeOfficeState.getCharacters().find(c => c.id === agentId)
        if (ch) name = ch.name ?? null
      }
      return { agentId, name, employeeId, buildingId, isPermanent: !!employeeId }
    }

    case 'list_agents': {
      if (listAgentsCallback) {
        return { agents: listAgentsCallback() }
      }
      if (!activeOfficeState) return { agents: [] }
      const chars = activeOfficeState.getCharacters()
      return {
        agents: chars.map(ch => ({
          id: ch.id,
          name: ch.name,
          palette: ch.palette,
          isActive: ch.isActive,
          isSubagent: ch.isSubagent,
          currentTool: ch.currentTool,
          tileCol: ch.tileCol,
          tileRow: ch.tileRow,
        })),
      }
    }

    case 'spawn_agent': {
      if (!addAgentCallback) throw new Error('Agent system not initialized')
      const id = (params.id as string) ?? generateAgentId()
      const palette = (params.palette as number) ?? undefined
      const name = (params.name as string) ?? 'MCP Agent'
      const model = (params.model as string) ?? 'sonnet'
      const buildingId = (params.buildingId as string) ?? null
      const prompt = (params.prompt as string) ?? undefined
      addAgentCallback(id, palette ?? 0, name, model, buildingId, prompt)
      emitOfficeEvent('agent_spawned', { agentId: id, name, model, palette: palette ?? 0, buildingId })
      return { success: true, agentId: id }
    }

    case 'remove_agent': {
      if (!removeAgentCallback) throw new Error('Agent system not initialized')
      const id = params.id as string
      if (id === undefined) throw new Error('Missing agent id')
      mcpControlledAgents.delete(id)
      removeAgentCallback(id)
      emitOfficeEvent('agent_removed', { agentId: id })
      return { success: true }
    }

    case 'set_agent_working': {
      const id = params.id as string
      if (id === undefined) throw new Error('Missing agent id')
      mcpControlledAgents.add(id)
      if (activeOfficeState && officeRegistry.isAgentInActiveBuilding(id)) {
        activeOfficeState.setAgentActive(id, true)
        activeOfficeState.setWorkerStatus(id, 'working')
      }
      workerStatusCallback?.(id, 'working')
      mcpDebug(id, `set_agent_working (mcp_control: true)`)
      emitOfficeEvent('agent_working', { agentId: id })
      return { success: true }
    }

    case 'set_agent_idle': {
      const id = params.id as string
      if (id === undefined) throw new Error('Missing agent id')
      // Keep agent in mcpControlledAgents so the JSONL auto-sync
      // (OfficeApp useEffect) doesn't immediately re-activate the agent.
      if (activeOfficeState && officeRegistry.isAgentInActiveBuilding(id)) {
        activeOfficeState.setAgentActive(id, false)
        activeOfficeState.setWorkerStatus(id, 'idle')
        activeOfficeState.setAgentStatusText(id, null)
        activeOfficeState.showWaitingBubble(id)
      }
      statusCallback?.(id, null)
      workerStatusCallback?.(id, 'idle')
      mcpDebug(id, `set_agent_idle (mcp_control: true)`)
      emitOfficeEvent('agent_idle', { agentId: id })
      playIdleChime()
      return { success: true }
    }

    case 'show_current_status': {
      const id = params.id as string
      const text = params.text as string
      if (id === undefined) throw new Error('Missing agent id')
      if (!text) throw new Error('Missing status text')
      if (activeOfficeState && officeRegistry.isAgentInActiveBuilding(id)) {
        activeOfficeState.setAgentStatusText(id, text)
      }
      statusCallback?.(id, text)
      mcpDebug(id, `show_current_status → "${text}"`)
      emitOfficeEvent('agent_status_changed', { agentId: id, text })
      return { success: true }
    }

    // ── PTY input command ─────────────────────────────────────
    case 'send_pty_input': {
      const id = params.id as string
      const message = params.message as string
      const pressEnter = (params.pressEnter as boolean) ?? true
      if (id === undefined) throw new Error('Missing agent id')
      if (!message && message !== '') throw new Error('Missing message')
      if (!sendPtyInputCallback) throw new Error('PTY input callback not registered')
      // Wrap in bracketed paste so Claude Code's TUI treats the body as a single
      // pasted block. The submitting Enter must arrive as a separate write after
      // the TUI finishes processing the paste — otherwise it gets swallowed
      // (same fix as the message-nudge and hire wake-up paths).
      const BRACKETED_PASTE_START = '\x1b[200~'
      const BRACKETED_PASTE_END = '\x1b[201~'
      const pasteBody = BRACKETED_PASTE_START + message + BRACKETED_PASTE_END
      const result = sendPtyInputCallback(id, pasteBody)
      if (!result.success) throw new Error(result.error ?? 'Failed to send PTY input')
      if (pressEnter) {
        submitEnterWhenIdle(id)
      }
      mcpDebug(id, `send_pty_input → "${message.slice(0, 50)}${message.length > 50 ? '…' : ''}"`)
      emitOfficeEvent('pty_input_sent', { agentId: id, messageLength: message.length })
      return { success: true }
    }

    // ── File explorer commands ────────────────────────────────
    case 'open_file': {
      const filePath = params.filePath as string
      if (!filePath) throw new Error('Missing filePath')
      window.dispatchEvent(new CustomEvent('pixelcity:open-file', { detail: { filePath } }))
      return { success: true }
    }

    // ── Canvas commands ──────────────────────────────────────
    // All canvas actions are async (disk I/O via IPC). Routed via
    // ASYNC_ACTIONS → handleCommandAsync to preserve Promise resolution.
    case 'open_canvas':
    case 'set_canvas':
    case 'write_canvas':
    case 'patch_canvas':
    case 'read_canvas':
    case 'clear_canvas':
      throw new Error('Use async version')

    case 'create_employee':
    case 'list_employees':
    case 'delete_employee':
      throw new Error('Use async version')

    // ── Browser commands ─────────────────────────────────────
    case 'browser_navigate': {
      const url = params.url as string
      const agentId = params.agentId as string | undefined
      const agentName = params.agentName as string | undefined
      const explicitTabId = params.tabId as string | undefined
      const newTab = params.newTab as boolean | undefined
      if (!url) throw new Error('Missing url')

      let tabId = explicitTabId

      if (agentId !== undefined && !tabId) {
        // Find or create a tab for this agent
        if (newTab) {
          // Always create a new tab — find next available index
          let idx = 0
          while (window.__pixelCityBrowserTabs?.has(`agent-${agentId}-${idx}`)) idx++
          tabId = `agent-${agentId}-${idx}`
        } else {
          // Use the agent's first tab (default)
          tabId = `agent-${agentId}-0`
        }
      }

      // Auto-create tab if it doesn't exist
      if (tabId && !window.__pixelCityBrowserTabs?.has(tabId)) {
        window.dispatchEvent(new CustomEvent('pixelcity:browser-create-tab', {
          detail: { agentId, agentName, tabId, initialUrl: url }
        }))
        return { success: true, tabId }
      }
      window.dispatchEvent(new CustomEvent('pixelcity:browser-navigate', { detail: { url, tabId } }))
      return { success: true, tabId }
    }

    case 'browser_show': {
      const tabId = resolveBrowserTabId(params)
      window.dispatchEvent(new CustomEvent('pixelcity:browser-show', { detail: { tabId } }))
      return { success: true, tabId }
    }

    case 'browser_set_download_dir': {
      const tabId = resolveBrowserTabId(params)
      const directory = params.directory as string
      if (!directory) throw new Error('Missing directory')
      if (!tabId) throw new Error('Missing tabId or agentId')
      // Reverse-lookup: tabId → webContentsId
      const wcMap = window.__pixelCityWebContentsToTab
      let wcId: number | undefined
      if (wcMap) {
        for (const [id, tid] of wcMap.entries()) {
          if (tid === tabId) { wcId = id; break }
        }
      }
      if (wcId === undefined) throw new Error(`Tab "${tabId}" not attached yet. Navigate first.`)
      const { ipcRenderer: ipc } = window.require('electron')
      ipc.send('set-agent-download-dir', { webContentsId: wcId, downloadDir: directory })
      return { success: true, tabId, directory }
    }

    case 'browser_get_downloads': {
      const downloads = (window as any).__pixelCityDownloads || []
      return { success: true, downloads }
    }

    case 'browser_back': {
      const tabId = resolveBrowserTabId(params)
      if (!tabId) throw new Error('Missing tabId or agentId for browser_back')
      window.dispatchEvent(new CustomEvent('pixelcity:browser-back', { detail: { tabId } }))
      return { success: true, tabId }
    }

    case 'browser_forward': {
      const tabId = resolveBrowserTabId(params)
      if (!tabId) throw new Error('Missing tabId or agentId for browser_forward')
      window.dispatchEvent(new CustomEvent('pixelcity:browser-forward', { detail: { tabId } }))
      return { success: true, tabId }
    }

    case 'browser_reload': {
      const tabId = resolveBrowserTabId(params)
      if (!tabId) throw new Error('Missing tabId or agentId for browser_reload')
      window.dispatchEvent(new CustomEvent('pixelcity:browser-reload', { detail: { tabId } }))
      return { success: true, tabId }
    }

    case 'browser_get_url': {
      const { bridge: browser, tabId } = resolveBrowserBridge(params)
      return {
        url: browser.getUrl(),
        title: browser.getTitle(),
        isLoading: browser.isLoading(),
        canGoBack: browser.canGoBack(),
        canGoForward: browser.canGoForward(),
        tabId,
      }
    }

    case 'browser_get_console_logs': {
      const { bridge: browser, tabId } = resolveBrowserBridge(params)
      const level = params.level as string | undefined
      const clear = params.clear as boolean | undefined
      const logs = browser.getConsoleLogs(level)
      if (clear) browser.clearConsoleLogs()
      return { logs, count: logs.length, tabId }
    }

    case 'get_office_info': {
      if (!activeOfficeState) return { available: false }
      const layout = activeOfficeState.getLayout()
      return {
        available: true,
        cols: layout.cols,
        rows: layout.rows,
        agentCount: activeOfficeState.getCharacters().length,
        seatCount: activeOfficeState.seats.size,
        freeSeatCount: Array.from(activeOfficeState.seats.values()).filter(s => !s.assigned).length,
      }
    }

    case 'trigger_fx': {
      const effect = params.effect as string
      // All effects use mix-blend-mode:screen so the office stays visible underneath
      const BLEND = 'position:fixed;top:0;left:0;pointer-events:none;z-index:9999;mix-blend-mode:screen;'
      const FX: Record<string, string> = {
        matrix: `(function(){
          var existing=document.getElementById('pc-fx-overlay');if(existing)existing.remove();
          var overlay=document.createElement('div');overlay.id='pc-fx-overlay';
          overlay.style.cssText='position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:9999;mix-blend-mode:screen;overflow:hidden;font-family:Courier New,monospace;font-size:14px;';
          document.body.appendChild(overlay);
          var cols=Math.floor(window.innerWidth/14);
          var drops=Array(cols).fill(0).map(function(){return Math.random()*-80;});
          var charList='アイウエオカキクケコ0123456789ABCDEF!@#$%'.split('');
          var spans=[];
          for(var i=0;i<cols;i++){var s=document.createElement('span');s.style.cssText='position:absolute;left:'+(i*14)+'px;top:0;opacity:0;';s.textContent=charList[Math.floor(Math.random()*charList.length)];overlay.appendChild(s);spans.push(s);}
          var frame=0;
          var iv=setInterval(function(){frame++;
            for(var i=0;i<cols;i++){if(Math.random()>0.97)drops[i]=Math.random()*-80;drops[i]+=0.6;var y=drops[i]*14;spans[i].style.top=y+'px';spans[i].style.opacity=drops[i]>0?'1':'0';spans[i].textContent=charList[Math.floor(Math.random()*charList.length)];var h=(frame+i)%4<1;spans[i].style.color=h?'#ffffff':'#00ff41';spans[i].style.textShadow=h?'0 0 12px #ffffff':'0 0 6px #00ff41';if(y>window.innerHeight+100)drops[i]=Math.random()*-80;}
            if(frame>480){clearInterval(iv);overlay.remove();}
          },50);
        })();`,

        binary: `(function(){
          var existing=document.getElementById('pc-fx-overlay');if(existing)existing.remove();
          var c=document.createElement('canvas');c.id='pc-fx-overlay';c.width=window.innerWidth;c.height=window.innerHeight;
          c.style.cssText='${BLEND}';
          document.body.appendChild(c);
          var ctx=c.getContext('2d'),W=c.width,H=c.height;
          var SZ=13,cols=Math.floor(W/SZ);
          var themes=['#00ff41','#ff4444','#4488ff','#ffaa00','#cc44ff'];
          var columns=[];
          for(var i=0;i<cols;i++){columns.push({y:Math.random()*-H,speed:1.5+Math.random()*5,length:8+Math.floor(Math.random()*20),color:themes[Math.floor(Math.random()*themes.length)],chars:[]});}
          var frame=0;
          function draw(){frame++;ctx.clearRect(0,0,W,H);ctx.font='bold '+SZ+'px Courier New';
            for(var i=0;i<cols;i++){var col=columns[i];col.y+=col.speed;
              for(var k=0;k<col.length;k++){var cy=col.y-k*SZ;if(cy<0||cy>H)continue;var isHead=k===0;var fade=1-(k/col.length);ctx.globalAlpha=isHead?1:fade*0.85;ctx.fillStyle=isHead?'#ffffff':col.color;if(isHead){ctx.shadowColor=col.color;ctx.shadowBlur=10;}else{ctx.shadowBlur=0;}if(Math.random()>0.92)col.chars[k]=Math.random()>0.5?'1':'0';if(!col.chars[k])col.chars[k]=Math.random()>0.5?'1':'0';ctx.fillText(col.chars[k],i*SZ,cy);}
              if(col.y-col.length*SZ>H){col.y=Math.random()*-200;col.speed=1.5+Math.random()*5;col.length=8+Math.floor(Math.random()*20);col.color=themes[Math.floor(Math.random()*themes.length)];col.chars=[];}}
            ctx.globalAlpha=1;ctx.shadowBlur=0;
            if(frame<480)requestAnimationFrame(draw);else c.remove();}
          draw();
        })();`,

        confetti: `(function(){
          var existing=document.getElementById('pc-fx-overlay');if(existing)existing.remove();
          var c=document.createElement('canvas');c.id='pc-fx-overlay';c.width=window.innerWidth;c.height=window.innerHeight;
          c.style.cssText='${BLEND}';
          document.body.appendChild(c);
          var ctx=c.getContext('2d'),W=c.width,H=c.height;
          var colors=['#ff4757','#ffa502','#2ed573','#1e90ff','#ff6b81','#eccc68','#a29bfe','#fd79a8','#00cec9','#fdcb6e'];
          var pieces=[];
          for(var i=0;i<200;i++){var angle=(Math.PI*2/200)*i+(Math.random()-0.5)*0.3;var speed=4+Math.random()*14;pieces.push({x:W/2,y:H/2,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed-Math.random()*8,rot:Math.random()*360,rotSpeed:(Math.random()-0.5)*12,w:6+Math.random()*10,h:4+Math.random()*6,color:colors[Math.floor(Math.random()*colors.length)],alpha:1,shape:Math.random()>0.5?'rect':'circle'});}
          var frame=0;
          function draw(){ctx.clearRect(0,0,W,H);frame++;var allGone=true;
            for(var i=0;i<pieces.length;i++){var p=pieces[i];p.x+=p.vx;p.y+=p.vy;p.vy+=0.35;p.vx*=0.99;p.rot+=p.rotSpeed;if(frame>60)p.alpha-=0.012;if(p.alpha<=0)continue;allGone=false;ctx.save();ctx.globalAlpha=p.alpha;ctx.fillStyle=p.color;ctx.translate(p.x,p.y);ctx.rotate(p.rot*Math.PI/180);if(p.shape==='rect'){ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h);}else{ctx.beginPath();ctx.arc(0,0,p.w/2,0,Math.PI*2);ctx.fill();}ctx.restore();}
            if(!allGone&&frame<300)requestAnimationFrame(draw);else c.remove();}
          draw();
        })();`,

        shockwave: `(function(){
          var existing=document.getElementById('pc-fx-overlay');if(existing)existing.remove();
          var c=document.createElement('canvas');c.id='pc-fx-overlay';c.width=window.innerWidth;c.height=window.innerHeight;
          c.style.cssText='${BLEND}';
          document.body.appendChild(c);
          var ctx=c.getContext('2d'),W=c.width,H=c.height,cx=W/2,cy=H/2;
          var waves=[{r:0,alpha:1},{r:0,alpha:0},{r:0,alpha:0},{r:0,alpha:0}];
          setTimeout(function(){waves[1].alpha=1;},150);
          setTimeout(function(){waves[2].alpha=1;},300);
          setTimeout(function(){waves[3].alpha=1;},450);
          var sf=0;
          function draw(){ctx.clearRect(0,0,W,H);sf++;
            for(var i=0;i<waves.length;i++){var w=waves[i];if(w.alpha<=0)continue;w.r+=14;w.alpha-=0.01;ctx.beginPath();ctx.arc(cx,cy,w.r,0,Math.PI*2);ctx.strokeStyle='rgba(100,200,255,'+Math.max(0,w.alpha)+')';ctx.lineWidth=5;ctx.shadowColor='#00cfff';ctx.shadowBlur=24;ctx.stroke();}
            if(sf<150)requestAnimationFrame(draw);else c.remove();}
          draw();
        })();`,

        neon: `(function(){
          var existing=document.getElementById('pc-fx-overlay');if(existing)existing.remove();
          var c=document.createElement('canvas');c.id='pc-fx-overlay';c.width=window.innerWidth;c.height=window.innerHeight;
          c.style.cssText='${BLEND}';
          document.body.appendChild(c);
          var ctx=c.getContext('2d'),W=c.width,H=c.height;
          var colors=['#ff00ff','#00ffff','#ff4500','#00ff88','#ffff00','#ff69b4'];
          var tris=[];
          for(var i=0;i<25;i++)tris.push({x:Math.random()*W,y:Math.random()*H,vx:(Math.random()-0.5)*6,vy:(Math.random()-0.5)*6,size:20+Math.random()*60,rot:Math.random()*Math.PI*2,rotV:(Math.random()-0.5)*0.08,color:colors[Math.floor(Math.random()*colors.length)],alpha:0.6+Math.random()*0.4});
          var frame=0;
          function draw(){frame++;ctx.clearRect(0,0,W,H);
            for(var i=0;i<tris.length;i++){var t=tris[i];t.x+=t.vx;t.y+=t.vy;t.rot+=t.rotV;if(t.x<-100)t.x=W+100;if(t.x>W+100)t.x=-100;if(t.y<-100)t.y=H+100;if(t.y>H+100)t.y=-100;ctx.save();ctx.translate(t.x,t.y);ctx.rotate(t.rot);ctx.globalAlpha=t.alpha;ctx.strokeStyle=t.color;ctx.shadowColor=t.color;ctx.shadowBlur=18;ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(0,-t.size);ctx.lineTo(t.size*0.866,t.size*0.5);ctx.lineTo(-t.size*0.866,t.size*0.5);ctx.closePath();ctx.stroke();ctx.restore();}
            if(frame>350)c.remove();else requestAnimationFrame(draw);}
          draw();
        })();`,

        glitch: `(function(){
          var existing=document.getElementById('pc-fx-overlay');if(existing)existing.remove();
          var c=document.createElement('canvas');c.id='pc-fx-overlay';c.width=window.innerWidth;c.height=window.innerHeight;
          c.style.cssText='${BLEND}';
          document.body.appendChild(c);
          var ctx=c.getContext('2d'),W=c.width,H=c.height,gf=0;
          function draw(){ctx.clearRect(0,0,W,H);gf++;
            var slices=8+Math.floor(Math.random()*12);
            for(var i=0;i<slices;i++){var y=Math.random()*H,h=2+Math.random()*30,off=(Math.random()-0.5)*80;ctx.fillStyle='rgba('+Math.floor(Math.random()*255)+','+Math.floor(Math.random()*255)+','+Math.floor(Math.random()*255)+',0.4)';ctx.fillRect(off,y,W,h);}
            if(Math.random()>0.4){ctx.fillStyle='rgba(255,0,80,0.15)';ctx.fillRect(Math.random()*20-10,0,W,H);ctx.fillStyle='rgba(0,255,220,0.15)';ctx.fillRect(Math.random()*20,0,W,H);}
            if(gf<80)requestAnimationFrame(draw);else c.remove();}
          draw();
        })();`,

        circuit: `(function(){
          var existing=document.getElementById('pc-fx-overlay');if(existing)existing.remove();
          var c=document.createElement('canvas');c.id='pc-fx-overlay';c.width=window.innerWidth;c.height=window.innerHeight;
          c.style.cssText='${BLEND}';
          document.body.appendChild(c);
          var ctx=c.getContext('2d'),W=c.width,H=c.height;
          var GRID=32,traces=[],colors=['#00ff88','#00ccff','#ff6600','#ffcc00'];
          function snap(v){return Math.round(v/GRID)*GRID;}
          for(var i=0;i<12;i++){traces.push({x:snap(Math.random()*W),y:snap(Math.random()*H),dir:Math.floor(Math.random()*4),color:colors[Math.floor(Math.random()*colors.length)],len:0,maxLen:4+Math.floor(Math.random()*18),trail:[],alive:true,turnCooldown:0});}
          var dx=[GRID,0,-GRID,0],dy=[0,GRID,0,-GRID],frame=0;
          function draw(){frame++;ctx.clearRect(0,0,W,H);
            for(var i=0;i<traces.length;i++){var t=traces[i];if(t.trail.length<2)continue;ctx.strokeStyle=t.color;ctx.shadowColor=t.color;ctx.shadowBlur=6;ctx.lineWidth=2;ctx.lineCap='square';ctx.beginPath();ctx.moveTo(t.trail[0].x,t.trail[0].y);for(var k=1;k<t.trail.length;k++)ctx.lineTo(t.trail[k].x,t.trail[k].y);ctx.stroke();for(var k=0;k<t.trail.length;k++){if(t.trail[k].isNode){ctx.fillStyle='#ffffff';ctx.shadowColor='#ffffff';ctx.shadowBlur=10;ctx.beginPath();ctx.arc(t.trail[k].x,t.trail[k].y,3,0,Math.PI*2);ctx.fill();}}}
            ctx.shadowBlur=0;
            if(frame%3===0){for(var i=0;i<traces.length;i++){var t=traces[i];if(!t.alive)continue;t.turnCooldown--;if(t.turnCooldown<=0&&Math.random()>0.65){t.dir=(t.dir+(Math.random()>0.5?1:3))%4;t.turnCooldown=2+Math.floor(Math.random()*4);t.trail.push({x:t.x,y:t.y,isNode:true});}t.x+=dx[t.dir];t.y+=dy[t.dir];t.len++;if(t.x<0)t.x=snap(W);if(t.x>W)t.x=0;if(t.y<0)t.y=snap(H);if(t.y>H)t.y=0;t.trail.push({x:t.x,y:t.y,isNode:false});if(t.len>=t.maxLen){t.alive=false;for(var b=0;b<(Math.random()>0.5?2:1);b++){if(traces.length<60){traces.push({x:t.x,y:t.y,dir:(t.dir+(b===0?1:3))%4,color:t.color,len:0,maxLen:3+Math.floor(Math.random()*14),trail:[{x:t.x,y:t.y,isNode:true}],alive:true,turnCooldown:3});}}}}}
            if(frame<500)requestAnimationFrame(draw);else c.remove();}
          draw();
        })();`,
      }
      const code = FX[effect]
      if (!code) throw new Error(`Unknown fx: ${effect}. Available: ${Object.keys(FX).join(', ')}`)
      // eslint-disable-next-line no-eval
      eval(code)
      return { ok: true, effect }
    }

    default:
      throw new Error(`Unknown action: ${action}`)
  }
}

async function handleCommandAsync(cmd: McpCommand): Promise<unknown> {
  const { requestId, action, params } = cmd
  const { ipcRenderer: ipc } = window.require('electron')

  try {
    let result: unknown

    switch (action) {
      case 'create_employee': {
        const empId = params.id as string
        const settings = params.settings as PermanentEmployeeSettings
        const soul = (params.soul as string) ?? ''
        if (!empId || !settings) throw new Error('Missing id or settings')
        await createEmployeeInRtdb(empId, settings, soul)
        window.dispatchEvent(new CustomEvent('pixelcity:employees-updated'))
        result = { success: true, id: empId }
        break
      }
      case 'list_employees': {
        const res = await listEmployeesFromRtdb()
        const filterBuildingId = (params.buildingId as string) ?? null
        if (res.success && filterBuildingId) {
          result = {
            ...res,
            employees: res.employees.filter(emp => (emp.settings.officeId ?? null) === filterBuildingId),
          }
        } else {
          result = res
        }
        break
      }
      case 'delete_employee': {
        const empId = params.id as string
        if (!empId) throw new Error('Missing employee id')
        await deleteEmployeeFromRtdb(empId)
        window.dispatchEvent(new CustomEvent('pixelcity:employees-updated'))
        result = { success: true, id: empId }
        break
      }
      case 'get_user_canvas': {
        result = await executeCanvasAction(action, params)
        break
      }
      case 'open_canvas':
      case 'set_canvas':
      case 'write_canvas':
      case 'patch_canvas':
      case 'read_canvas':
      case 'clear_canvas': {
        const canvasAgentId = params.id as string
        // UI focus side-effect is gated on the agent being in the user's
        // currently active building — otherwise an agent in another building
        // would hijack the viewer's screen. State mutations always run.
        const shouldFocus = !canvasAgentId || officeRegistry.isAgentInActiveBuilding(canvasAgentId)
        result = await executeCanvasAction(action, params, shouldFocus)
        break
      }
      default: {
        // Delegate task actions to the RTDB-backed task commands module
        if (TASK_ACTIONS.has(action)) {
          if (params.assignee) validateAssigneeInOffice(params.assignee as string)
          result = await executeTaskAction(action, params, ipc)
          break
        }
        // Delegate message actions to the messaging module
        if (MESSAGE_ACTIONS.has(action)) {
          if (action === 'send_message') validateMessageRecipient(params.to as string)
          result = await executeMessageAction(action, params)
          if (action === 'send_message' && result && (result as any).success) {
            applySendMessageSideEffects(params)
          }
          // Clear bubble when agent checks messages
          if ((action === 'check_messages' || action === 'list_messages') && activeOfficeState) {
            const agentId = params.agentId as string
            const ch = activeOfficeState.getCharacters().find(c => c.id === agentId)
            if (ch && ch.bubbleType === 'message') ch.bubbleType = null
          }
          break
        }
        // Delegate plugin-owned tool dispatch (pixel-city-plugins bridge)
        if (PLUGIN_TOOL_ACTIONS.has(action)) {
          result = await executePluginToolAction(action, params)
          // Mirror the mcpBridge side-effect chain for plugin-handler tools
          // that need it. The plugin handler only does store.send — the PTY
          // nudge, bubble, office event, and auto-spawn fallback live here
          // until PluginHost can expose those capabilities.
          if (
            action === 'plugin_tool_call'
            && params.name === 'send_message'
            && result
            && (result as any).ok === true
          ) {
            const args = (params.args as Record<string, unknown>) ?? {}
            applySendMessageSideEffects(args)
          }
          break
        }
        // Delegate dynamic plugin actions
        if (DYNAMIC_PLUGIN_ACTIONS.has(action)) {
          const dpBuildingId = (params.buildingId as string) ?? null
          const dpAgentId = (params.agentId as string) ?? null
          result = await executeDynamicPluginAction(action, params, dpBuildingId, dpAgentId)
          break
        }
        // Non-task async actions
        switch (action) {
          case 'browser_execute_js': {
            const { bridge: browser, tabId } = await resolveBrowserBridgeAsync(params)
            const code = params.code as string
            if (!code) throw new Error('Missing code')
            const jsResult = await browser.executeJs(code)
            result = { result: jsResult, tabId }
            break
          }
          case 'browser_get_page_text': {
            const { bridge: browser, tabId } = await resolveBrowserBridgeAsync(params)
            const text = await browser.executeJs('document.body.innerText')
            result = { text, tabId }
            break
          }
          case 'browser_click': {
            const { bridge: browser, tabId } = await resolveBrowserBridgeAsync(params)
            const selector = params.selector as string | undefined
            const x = params.x as number | undefined
            const y = params.y as number | undefined
            const button = params.button as 'left' | 'right' | 'middle' | undefined
            const clickCount = params.clickCount as number | undefined
            const tabCountBefore = window.__pixelCityBrowserTabs?.size ?? 0
            const clickResult = await browser.click({ selector, x, y, button, clickCount })
            // Brief delay to let new-window handler fire (if the click opened a new tab)
            await new Promise(r => setTimeout(r, 200))
            const tabCountAfter = window.__pixelCityBrowserTabs?.size ?? 0
            if (tabCountAfter > tabCountBefore) {
              const allTabs = Array.from(window.__pixelCityBrowserTabs?.keys() ?? [])
              const newTabId = allTabs[allTabs.length - 1]
              const newBridge = newTabId ? window.__pixelCityBrowserTabs?.get(newTabId) : undefined
              result = { ...clickResult as object, tabId, newTabOpened: true, newTabId, newTabUrl: newBridge?.getUrl() ?? '' }
            } else {
              result = { ...clickResult as object, tabId }
            }
            break
          }
          case 'browser_type': {
            const { bridge: browser, tabId } = await resolveBrowserBridgeAsync(params)
            const typeText = params.text as string
            if (!typeText) throw new Error('Missing text')
            await browser.type(typeText)
            result = { success: true, tabId }
            break
          }
          case 'browser_key_press': {
            const { bridge: browser, tabId } = await resolveBrowserBridgeAsync(params)
            const key = params.key as string
            if (!key) throw new Error('Missing key')
            const modifiers = params.modifiers as string[] | undefined
            await browser.keyPress(key, modifiers)
            result = { success: true, tabId }
            break
          }
          case 'browser_screenshot': {
            const { bridge: browser, tabId } = await resolveBrowserBridgeAsync(params)
            const screenshotResult = await browser.screenshot()
            result = { ...screenshotResult, tabId }
            break
          }
          case 'browser_start_recording': {
            const { bridge: browser, tabId } = await resolveBrowserBridgeAsync(params)
            const fps = params.fps as number | undefined
            const maxWidth = params.maxWidth as number | undefined
            await browser.startRecording({ fps, maxWidth })
            result = { success: true, tabId }
            break
          }
          case 'browser_stop_recording': {
            const { bridge: browser, tabId } = await resolveBrowserBridgeAsync(params)
            const recResult = await browser.stopRecording()
            result = { ...recResult, tabId }
            break
          }
          case 'browser_form_input': {
            const { bridge: browser, tabId } = await resolveBrowserBridgeAsync(params)
            const selector = params.selector as string
            const value = params.value as string
            if (!selector) throw new Error('Missing selector')
            if (value === undefined || value === null) throw new Error('Missing value')
            const formResult = await browser.formInput(selector, String(value), {
              clear: (params.clear as boolean) ?? true,
              pressEnter: (params.pressEnter as boolean) ?? false,
            })
            result = { ...(formResult as object), tabId }
            break
          }
          case 'browser_get_elements': {
            const { bridge: browser, tabId } = await resolveBrowserBridgeAsync(params)
            const selector = params.selector as string | undefined
            const limit = params.limit as number | undefined
            const elements = await browser.queryElements(selector || undefined, limit || 50)
            result = { elements, count: elements.length, tabId }
            break
          }
          case 'browser_scroll': {
            const { bridge: browser, tabId } = await resolveBrowserBridgeAsync(params)
            const x = params.x as number
            const y = params.y as number
            if (x === undefined || y === undefined) throw new Error('Missing x/y coordinates')
            const deltaX = (params.deltaX as number) ?? 0
            const deltaY = (params.deltaY as number) ?? -120
            const scrollResult = await browser.scroll({ x, y, deltaX, deltaY })
            result = { ...scrollResult as object, tabId }
            break
          }
          case 'browser_right_click': {
            const { bridge: browser, tabId } = await resolveBrowserBridgeAsync(params)
            const x = params.x as number
            const y = params.y as number
            if (x === undefined || y === undefined) throw new Error('Missing x/y coordinates')
            const rcResult = await browser.rightClick({ x, y })
            result = { ...rcResult as object, tabId }
            break
          }
          case 'browser_hover': {
            const { bridge: browser, tabId } = await resolveBrowserBridgeAsync(params)
            const x = params.x as number
            const y = params.y as number
            if (x === undefined || y === undefined) throw new Error('Missing x/y coordinates')
            const hoverResult = await browser.hover({ x, y })
            result = { ...hoverResult as object, tabId }
            break
          }
          case 'browser_double_click': {
            const { bridge: browser, tabId } = await resolveBrowserBridgeAsync(params)
            const x = params.x as number
            const y = params.y as number
            if (x === undefined || y === undefined) throw new Error('Missing x/y coordinates')
            const dcResult = await browser.doubleClick({ x, y })
            result = { ...dcResult as object, tabId }
            break
          }
          case 'browser_drag': {
            const { bridge: browser, tabId } = await resolveBrowserBridgeAsync(params)
            const fromX = params.fromX as number
            const fromY = params.fromY as number
            const toX = params.toX as number
            const toY = params.toY as number
            if (fromX === undefined || fromY === undefined || toX === undefined || toY === undefined)
              throw new Error('Missing fromX/fromY/toX/toY coordinates')
            const steps = params.steps as number | undefined
            const dragResult = await browser.drag({ fromX, fromY, toX, toY, steps })
            result = { ...dragResult as object, tabId }
            break
          }
          case 'browser_fill_form': {
            const { bridge: browser, tabId } = await resolveBrowserBridgeAsync(params)
            const fields = params.fields as Array<{ selector: string; value: string }>
            if (!fields || !Array.isArray(fields) || fields.length === 0) throw new Error('Missing or empty fields array')
            const results: Array<{ selector: string; success: boolean; error?: string }> = []
            let filled = 0
            for (const field of fields) {
              try {
                const r = await browser.formInput(field.selector, String(field.value), { clear: true })
                results.push({ selector: field.selector, success: r.success, error: r.error })
                if (r.success) filled++
              } catch (e: unknown) {
                results.push({ selector: field.selector, success: false, error: e instanceof Error ? e.message : String(e) })
              }
            }
            // Handle submit
            const submit = params.submit
            if (submit === true) {
              await browser.keyPress('Enter')
            } else if (typeof submit === 'string') {
              await browser.click({ selector: submit })
            }
            result = { success: filled === fields.length, filled, total: fields.length, results, tabId }
            break
          }
          default:
            handleCommand(cmd)
            return
        }
        break
      }
    }

    sendResponse(requestId, result)
    return result
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    sendResponse(requestId, undefined, message)
    throw err
  }
}

const ASYNC_ACTIONS = new Set([
  'create_employee', 'list_employees', 'delete_employee',
  'get_board', 'list_tasks', 'get_task', 'create_task', 'update_task', 'delete_task', 'move_task',
  'create_subtask', 'list_subtasks', 'update_subtask', 'move_subtask', 'delete_subtask',
  'get_user_canvas',
  // Canvas content (disk-backed)
  'open_canvas', 'set_canvas', 'write_canvas', 'patch_canvas', 'read_canvas', 'clear_canvas',
  'archive_task', 'archive_all_closed', 'restore_task', 'list_archived_tasks',
  'browser_execute_js', 'browser_get_page_text',
  'browser_click', 'browser_type', 'browser_key_press', 'browser_screenshot',
  'browser_scroll', 'browser_right_click', 'browser_hover', 'browser_double_click', 'browser_drag',
  'browser_start_recording', 'browser_stop_recording',
  'browser_form_input', 'browser_get_elements', 'browser_fill_form',
  // Agent messaging
  'send_message', 'check_messages', 'read_message', 'list_messages',
  // Dynamic plugins
  'create_plugin', 'update_plugin', 'list_plugins',
  'get_plugin_state', 'set_plugin_state', 'plugin_call',
  // Plugin-owned tool bridge (pixel-city-plugins MCP server)
  'plugin_tool_list', 'plugin_tool_call',
])

// --- Connection management ---

function connectBridgeWs() {
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
        handleCommand(msg as unknown as McpCommand)
      }
    } catch { /* ignore malformed */ }
  }

  ws.onclose = () => {
    bridgeWs = null
    console.log('[MCP Bridge] Renderer WebSocket disconnected, reconnecting...')
    setTimeout(connectBridgeWs, RECONNECT_DELAY_MS)
  }

  ws.onerror = () => {
    // onclose will fire after onerror, which handles reconnect
    ws.close()
  }
}

/**
 * Call an MCP tool directly from the renderer (for API-based LLM providers).
 * Works for both sync and async actions. The requestId -1 means the
 * sendResponse call inside handleCommandAsync will be a no-op to WS
 * (since there's no real WS client), but the result is returned directly.
 */
export async function callTool(action: string, params: Record<string, unknown> = {}): Promise<unknown> {
  if (ASYNC_ACTIONS.has(action)) {
    return handleCommandAsync({ type: 'mcp-command', requestId: -1, action, params })
  }
  return executeAction(action, params)
}

export function initMcpBridge() {
  connectBridgeWs()

  // Forward browser tab-opened events to MCP clients as office events
  window.addEventListener('pixelcity:browser-tab-opened', (e: Event) => {
    const { tabId, url, sourceTabId, agentId } = (e as CustomEvent).detail
    emitOfficeEvent('browser_tab_opened', { tabId, url, sourceTabId, agentId })
  })

  // Canvas session switching — when the user picks a different chat session
  // for an agent in the SessionChooser, swap the canvas to that session's
  // content and version history.
  window.addEventListener('pixelcity:canvas-session-switched', (e: Event) => {
    const detail = (e as CustomEvent).detail ?? {}
    const { projectDir, buildingId, agentId, sessionId } = detail as {
      projectDir?: string | null
      buildingId?: string | null
      agentId?: string
      sessionId?: string
    }
    if (!agentId || !sessionId) return
    setActiveSessionForAgent(agentId, sessionId)
    void switchCanvasSession(projectDir ?? null, buildingId ?? null, agentId, sessionId)
  })

  // Hydrate canvas-on-disk for the current building so permanent employees'
  // canvases survive restart. Best-effort.
  window.addEventListener('pixelcity:hydrate-canvases', (e: Event) => {
    const detail = (e as CustomEvent).detail ?? {}
    const { projectDir, buildingId } = detail as {
      projectDir?: string | null
      buildingId?: string | null
    }
    void hydrateCanvasesFromDisk(projectDir ?? null, buildingId ?? null)
  })

  console.log('[MCP Bridge] Renderer bridge initialized')
}
