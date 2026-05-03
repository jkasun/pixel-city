#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import WebSocket from 'ws'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const TERMINAL_APP_DIR = path.resolve(__dirname, '..', 'terminal-app')
// Resolve system-prompts: check bundled location first, fall back to terminal-app/
const _bundledPrompts = path.resolve(__dirname, 'system-prompts')
const SYSTEM_PROMPTS_DIR = fs.existsSync(_bundledPrompts)
  ? _bundledPrompts
  : path.join(TERMINAL_APP_DIR, 'system-prompts')

const WS_URL = process.env.PIXEL_CITY_WS_URL || 'ws://localhost:19840'
const CONNECT_TIMEOUT = 5000
const REQUEST_TIMEOUT = 10000
const BROWSER_REQUEST_TIMEOUT = 30000
const HEAVY_REQUEST_TIMEOUT = 60000

// Agent identity — set by Pixel City when spawning a Claude session
const SELF_AGENT_ID = process.env.PIXEL_CITY_AGENT_ID || null
const SELF_AGENT_NAME = process.env.PIXEL_CITY_AGENT_NAME || null
const SELF_PROJECT_DIR = process.env.PIXEL_CITY_PROJECT_DIR || null
const SELF_EMPLOYEE_ID = process.env.PIXEL_CITY_EMPLOYEE_ID || null
const SELF_BUILDING_ID = process.env.PIXEL_CITY_BUILDING_ID || null
const SELF_WORKSPACE_DIR = process.env.PIXEL_CITY_WORKSPACE_DIR || null

// Canvas preference tracking — ensures LLM reads preferences before rendering
let canvasPreferencesFetched = false

// Meeting guidelines tracking — ensures LLM reads meeting voice guidelines before using meeting tools
let meetingGuidelinesFetched = false

// --- WebSocket Client ---

let ws = null
let msgIdCounter = 1
const pendingRequests = new Map()

function connectWs() {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(WS_URL)
    const timeout = setTimeout(() => {
      socket.terminate()
      reject(new Error(`Connection to Pixel City timed out (${WS_URL})`))
    }, CONNECT_TIMEOUT)

    socket.on('open', () => {
      clearTimeout(timeout)
      ws = socket
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
          // Office-side event streamed from the renderer
          process.stderr.write(`[pixel-city-mcp] office event: ${msg.event} ${JSON.stringify(msg)}\n`)
        }
      } catch { /* ignore malformed messages */ }
    })

    socket.on('close', () => {
      ws = null
      // Reject all pending requests
      for (const [id, { reject }] of pendingRequests) {
        reject(new Error('WebSocket connection closed'))
        pendingRequests.delete(id)
      }
    })

    socket.on('error', (err) => {
      clearTimeout(timeout)
      reject(new Error(`Cannot connect to Pixel City: ${err.message}`))
    })
  })
}

async function ensureConnected() {
  if (ws && ws.readyState === WebSocket.OPEN) return
  await connectWs()
}

function sendCommand(action, params = {}, timeoutMs = REQUEST_TIMEOUT) {
  return new Promise(async (resolve, reject) => {
    try {
      await ensureConnected()
    } catch (err) {
      return reject(err)
    }

    const id = msgIdCounter++
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
}

// --- MCP Server ---

const server = new McpServer({
  name: 'pixel-city',
  version: '1.0.0',
})

// Helper: generate a random 16-character agent ID
function generateAgentId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let i = 0; i < 16; i++) id += chars[Math.floor(Math.random() * chars.length)]
  return id
}

// Helper: resolve agent ID — use explicit param, fall back to env-based self ID
function resolveAgentId(params) {
  const id = params.id ?? SELF_AGENT_ID
  if (id === null || id === undefined) {
    throw new Error('Missing agent id (no PIXEL_CITY_AGENT_ID env var set)')
  }
  return id
}

// Helper: inject projectDir and buildingId from env if not explicitly provided
function withProjectDir(params) {
  const resolved = { ...params }
  if (!resolved.projectDir && SELF_PROJECT_DIR) resolved.projectDir = SELF_PROJECT_DIR
  if (!resolved.buildingId && SELF_BUILDING_ID) resolved.buildingId = SELF_BUILDING_ID
  return resolved
}

// Helper: resolve assignee key — prefer emp:<id> for permanent employees, fall back to agent:<id>
function resolveSelfAssigneeKey() {
  if (SELF_EMPLOYEE_ID) return `emp:${SELF_EMPLOYEE_ID}`
  if (SELF_AGENT_ID !== null) return `agent:${SELF_AGENT_ID}`
  return null
}

// Helper: load project configuration from config.json
function loadProjectConfig(projectDir) {
  if (!projectDir) return null

  const configPath = path.join(projectDir, '.pixelcity', 'config.json')
  try {
    if (!fs.existsSync(configPath)) return null
    const configData = fs.readFileSync(configPath, 'utf8')
    return JSON.parse(configData)
  } catch (err) {
    process.stderr.write(`[pixel-city-mcp] Warning: Could not load config from ${configPath}: ${err.message}\n`)
    return null
  }
}

// Helper: resolve instruction text — returns trimmed text or null if empty
function resolveInstructionText(text) {
  if (!text || typeof text !== 'string' || !text.trim()) return null
  return text.trim()
}

// Helper: read office instructions from `.pixelcity/office-instructions.md`
function readOfficeInstructionsFile(projectDir) {
  if (!projectDir) return null
  const filePath = path.join(projectDir, '.pixelcity', 'office-instructions.md')
  try {
    if (!fs.existsSync(filePath)) return null
    const text = fs.readFileSync(filePath, 'utf8').trim()
    return text || null
  } catch (err) {
    process.stderr.write(`[pixel-city-mcp] Warning: Could not read ${filePath}: ${err.message}\n`)
    return null
  }
}

// Helper: read a markdown file under `~/.pixelcity/`.
function readHomePixelcityMarkdown(filename) {
  const filePath = path.join(os.homedir(), '.pixelcity', filename)
  try {
    if (!fs.existsSync(filePath)) return null
    const text = fs.readFileSync(filePath, 'utf8').trim()
    return text || null
  } catch (err) {
    process.stderr.write(`[pixel-city-mcp] Warning: Could not read ${filePath}: ${err.message}\n`)
    return null
  }
}

// Helper: read city configuration from `~/.pixelcity/city-configuration.md`.
function readCityConfigurationFile() {
  return readHomePixelcityMarkdown('city-configuration.md')
}

// Helper: read canvas preferences from `~/.pixelcity/canvas-preferences.md`.
function readCanvasPreferencesFile() {
  return readHomePixelcityMarkdown('canvas-preferences.md')
}

// Helper: build hierarchical instructions for agent spawning.
// City instructions come from `~/.pixelcity/city-configuration.md`; office
// instructions come from `<projectDir>/.pixelcity/office-instructions.md`.
function buildInstructions(_config, projectDir, userPrompt = '') {
  const dir = projectDir || ''
  const instructions = []

  const cityText = readCityConfigurationFile()
  if (cityText) {
    instructions.push(`**City Instructions:**\n${cityText}`)
  }

  const officeText = readOfficeInstructionsFile(dir)
  if (officeText) {
    instructions.push(`**Office Instructions:**\n${officeText}`)
  }

  if (instructions.length > 0) {
    const combinedInstructions = instructions.join('\n\n')
    if (userPrompt && userPrompt.trim()) {
      return `${combinedInstructions}\n\n**Task:**\n${userPrompt.trim()}`
    } else {
      return combinedInstructions
    }
  }

  return userPrompt || ''
}

// Whoami — returns this session's agent identity
server.tool(
  'whoami',
  'Get this agent\'s Pixel City identity (agent ID and name). Returns null values if not spawned by Pixel City.',
  {},
  async () => {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          agentId: SELF_AGENT_ID,
          agentName: SELF_AGENT_NAME,
          hasIdentity: SELF_AGENT_ID !== null,
          projectDir: SELF_PROJECT_DIR,
          buildingId: SELF_BUILDING_ID,
          employeeId: SELF_EMPLOYEE_ID,
          workspaceDir: SELF_WORKSPACE_DIR,
          assigneeKey: SELF_EMPLOYEE_ID ? `emp:${SELF_EMPLOYEE_ID}` : SELF_AGENT_ID !== null ? `agent:${SELF_AGENT_ID}` : null,
        }),
      }],
    }
  }
)

// Ping — check if Pixel City is running
server.tool(
  'ping',
  'Check if Pixel City is running and responsive',
  {},
  async () => {
    try {
      const result = await sendCommand('ping')
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    } catch (err) {
      return { content: [{ type: 'text', text: `Pixel City is not available: ${err.message}` }], isError: true }
    }
  }
)

// List agents
server.tool(
  'list_agents',
  'List all agents currently in the Pixel City office',
  {},
  async () => {
    const result = await sendCommand('list_agents')
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// Get office info
server.tool(
  'get_office_info',
  'Get information about the current office (size, seat count, agent count)',
  {},
  async () => {
    const result = await sendCommand('get_office_info')
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// Spawn agent
server.tool(
  'spawn_agent',
  'Spawn a new agent in the Pixel City office',
  {
    name: z.string().optional().describe('Display name for the agent'),
    model: z.string().optional().describe('Claude model (e.g. "sonnet", "opus")'),
    palette: z.number().optional().describe('Skin palette index (0-5)'),
    buildingId: z.string().optional().describe('Building to spawn in'),
    prompt: z.string().optional().describe('Initial prompt/task to send to the agent after spawning (e.g. "Complete PC-43: MCP spawn agent with pre prompt")'),
  },
  async (params) => {
    const id = generateAgentId()
    const resolved = withProjectDir({ ...params })

    // Build hierarchical instructions. City instructions come from
    // `~/.pixelcity/city-configuration.md`; office instructions come from
    // `<projectDir>/.pixelcity/office-instructions.md`.
    const enhancedPrompt = buildInstructions(null, resolved.projectDir, resolved.prompt)

    // Send spawn command with enhanced prompt
    const spawnParams = {
      id,
      name: resolved.name,
      model: resolved.model,
      palette: resolved.palette,
      buildingId: resolved.buildingId,
      prompt: enhancedPrompt,
    }

    const result = await sendCommand('spawn_agent', spawnParams)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Remove agent
server.tool(
  'remove_agent',
  'Remove an agent from the Pixel City office',
  {
    id: z.string().describe('Agent ID to remove'),
  },
  async (params) => {
    const result = await sendCommand('remove_agent', params)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Set agent to working mode — Claude Code is actively working, no user input needed
server.tool(
  'set_agent_working',
  'Signal that this Claude Code session is actively working (typing, running tools). The agent character will sit at their desk and type. Call this when you start working on a task. If no id is provided, uses this session\'s own agent ID.',
  {
    id: z.string().optional().describe('Agent ID (defaults to own agent ID)'),
  },
  async (params) => {
    const id = resolveAgentId(params)
    const result = await sendCommand('set_agent_working', { id })
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Set agent to idle mode — Claude Code is done, waiting for user action
server.tool(
  'set_agent_idle',
  'Signal that this Claude Code session is done working and waiting for user input. The agent character will stop typing and wander around the office. Call this when you finish a task or are waiting for user action. If no id is provided, uses this session\'s own agent ID.',
  {
    id: z.string().optional().describe('Agent ID (defaults to own agent ID)'),
  },
  async (params) => {
    const id = resolveAgentId(params)
    const result = await sendCommand('set_agent_idle', { id })
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Show current status — display what specific part of the task the agent is working on
server.tool(
  'show_current_status',
  'Display a short status text above the agent showing what specific part of the task they are working on (e.g. "Reading config files", "Writing tests", "Fixing bug in auth module"). If no id is provided, uses this session\'s own agent ID.',
  {
    id: z.string().optional().describe('Agent ID (defaults to own agent ID)'),
    text: z.string().describe('Short status text describing current activity'),
  },
  async (params) => {
    const id = resolveAgentId(params)
    const result = await sendCommand('show_current_status', { id, text: params.text })
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Send PTY input to an agent's terminal session
server.tool(
  'send_pty_input',
  'Send text input to an agent\'s terminal (PTY) session. The text is typed into the terminal as if a user typed it. By default, a newline (Enter) is appended. Use this to send commands or messages to a running Claude Code session.',
  {
    id: z.string().optional().describe('Agent ID (defaults to own agent ID)'),
    message: z.string().describe('Text to send to the terminal'),
    pressEnter: z.boolean().optional().describe('Whether to append a newline (Enter) after the message (default: true)'),
  },
  async (params) => {
    const id = resolveAgentId(params)
    const result = await sendCommand('send_pty_input', { id, message: params.message, pressEnter: params.pressEnter ?? true })
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// ── Canvas tools ────────────────────────────────────────────

// Helper: load canvas preferences from `~/.pixelcity/canvas-preferences.md`.
// projectDir kept in signature so callers don't churn — the file is global.
function loadCanvasPreferences(_projectDir) {
  return readCanvasPreferencesFile()
}

// Get canvas user preferences
server.tool(
  'get_canvas_preferences',
  'Read the user\'s canvas design preferences. IMPORTANT: You MUST call this tool before using set_canvas if the user has configured canvas preferences. Returns the user\'s style/design preferences for canvas rendering, or a message indicating no preferences are set.',
  {},
  async () => {
    const preferences = loadCanvasPreferences(SELF_PROJECT_DIR)
    canvasPreferencesFetched = true

    if (!preferences) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ hasPreferences: false, message: 'No canvas preferences configured. You may proceed with set_canvas freely.' })
        }]
      }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ hasPreferences: true, preferences })
      }]
    }
  }
)

// Open canvas panel
server.tool(
  'open_canvas',
  'Open the canvas panel below the terminal. If no id is provided, uses this session\'s own agent ID.',
  {
    id: z.string().optional().describe('Agent ID (defaults to own agent ID)'),
    height: z.number().min(10).max(90).optional().describe('Canvas height as percentage of message area (10-90, default 40)'),
  },
  async (params) => {
    const id = resolveAgentId(params)
    const result = await sendCommand('open_canvas', { id, height: params.height ?? 40 })
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Set canvas HTML content
server.tool(
  'set_canvas',
  'Set the HTML content for the agent canvas panel. Renders HTML/CSS/JS in a sandboxed iframe visible below the terminal. Auto-opens the canvas if not already open. If no id is provided, uses this session\'s own agent ID. IMPORTANT: You must call get_canvas_preferences first if the user has canvas preferences configured — this tool will reject the call otherwise.',
  {
    id: z.string().optional().describe('Agent ID (defaults to own agent ID)'),
    html: z.string().describe('Full HTML content to render (can include <style> and <script> tags)'),
    title: z.string().optional().describe('Optional title shown in the canvas header'),
  },
  async (params) => {
    // Enforce preference check: only block if preferences actually exist and haven't been fetched
    if (!canvasPreferencesFetched) {
      const preferences = loadCanvasPreferences(SELF_PROJECT_DIR)
      if (preferences) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: true,
              message: 'Canvas preferences are configured but you have not read them yet. Please call get_canvas_preferences first, then apply those preferences to your canvas HTML before calling set_canvas.'
            })
          }]
        }
      }
    }

    const id = resolveAgentId(params)
    const result = await sendCommand('set_canvas', { id, html: params.html, title: params.title ?? null })
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Clear canvas content
server.tool(
  'clear_canvas',
  'Clear the canvas content for an agent. The panel stays open with an empty state. If no id is provided, uses this session\'s own agent ID.',
  {
    id: z.string().optional().describe('Agent ID (defaults to own agent ID)'),
  },
  async (params) => {
    const id = resolveAgentId(params)
    const result = await sendCommand('clear_canvas', { id })
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Get a screenshot of the user's drawing board
server.tool(
  'get_user_canvas',
  'Get a screenshot of the user\'s drawing board (the "Draw" tab in the canvas panel). Returns a PNG data URL or SVG string of what the user has drawn. Use this to see sketches, diagrams, or visual notes the user has created for you.',
  {
    format: z.enum(['png', 'svg']).optional().default('png').describe('Export format: "png" (default) returns a data URL, "svg" returns an SVG string'),
  },
  async (params) => {
    const result = await sendCommand('get_user_canvas', { format: params.format })
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// --- Browser tools ---

// Helper: inject agent identity + optional tabId into browser command params
// Tracks the agent's "default" tabId so callers don't need to pass it every time.
let defaultTabId = null

function browserParams(params = {}) {
  const p = { ...params, agentId: SELF_AGENT_ID, agentName: SELF_AGENT_NAME }
  // Use explicit tabId if provided, otherwise fall back to the agent's default tab
  if (!p.tabId && defaultTabId) p.tabId = defaultTabId
  return p
}

server.tool(
  'browser_navigate',
  'Navigate the integrated browser to a URL. Auto-creates a tab on first use and returns a tabId. IMPORTANT: Save the returned tabId and pass it to all subsequent browser tool calls to keep working in the same tab. Use newTab: true to open additional tabs for parallel browsing (e.g. researching multiple pages at once).',
  {
    url: z.string().describe('URL to navigate to, or search query'),
    tabId: z.string().optional().describe('Tab to navigate. Pass the tabId from a previous browser_navigate call to reuse that tab. Omit on first call to auto-create a tab.'),
    newTab: z.boolean().optional().describe('Set true to open a NEW tab instead of reusing the current one. Useful when you need multiple pages open simultaneously (e.g. comparing two sites, or keeping a reference page open while browsing another).'),
  },
  async (params) => {
    const p = browserParams(params)
    if (params.newTab) delete p.tabId // Force new tab creation
    const result = await sendCommand('browser_navigate', p, BROWSER_REQUEST_TIMEOUT)
    // Track the tab so subsequent calls use it by default
    if (result.tabId) defaultTabId = result.tabId
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

server.tool(
  'browser_back',
  'Go back one page in browser history. Pass tabId to target a specific tab.',
  {
    tabId: z.string().optional().describe('Tab to go back in. Use the tabId returned from browser_navigate. Omit to use the most recently used tab.'),
  },
  async (params) => {
    const result = await sendCommand('browser_back', browserParams(params))
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

server.tool(
  'browser_forward',
  'Go forward one page in browser history. Pass tabId to target a specific tab.',
  {
    tabId: z.string().optional().describe('Tab to go forward in. Use the tabId returned from browser_navigate. Omit to use the most recently used tab.'),
  },
  async (params) => {
    const result = await sendCommand('browser_forward', browserParams(params))
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

server.tool(
  'browser_reload',
  'Reload the current page. Pass tabId to target a specific tab.',
  {
    tabId: z.string().optional().describe('Tab to reload. Use the tabId returned from browser_navigate. Omit to use the most recently used tab.'),
  },
  async (params) => {
    const result = await sendCommand('browser_reload', browserParams(params))
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

server.tool(
  'browser_show',
  'Switch the UI to show the integrated browser panel. Use this when you want the user to see your browser activity — e.g. during active frontend development, demos, or when browsing results are visually important. Optionally pass a tabId to also select a specific browser tab.',
  {
    tabId: z.string().optional().describe('Tab to activate in the browser panel. Omit to just show the browser without changing the active tab.'),
  },
  async (params) => {
    const result = await sendCommand('browser_show', browserParams(params))
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

server.tool(
  'open_file',
  'Open a file in the Pixel City file explorer. Switches the UI to the files tab and opens the file in the editor panel.',
  {
    filePath: z.string().describe('Absolute path to the file to open'),
  },
  async (params) => {
    const result = await sendCommand('open_file', params)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

server.tool(
  'browser_get_url',
  'Get the current URL, page title, and navigation state. Pass tabId to query a specific tab.',
  {
    tabId: z.string().optional().describe('Tab to query. Use the tabId returned from browser_navigate. Omit to use the most recently used tab.'),
  },
  async (params) => {
    const result = await sendCommand('browser_get_url', browserParams(params))
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'browser_get_console_logs',
  'Get console log entries from the browser. Pass tabId to read logs from a specific tab.',
  {
    tabId: z.string().optional().describe('Tab to read logs from. Use the tabId returned from browser_navigate. Omit to use the most recently used tab.'),
    level: z.enum(['log', 'warn', 'error', 'info', 'debug']).optional().describe('Filter by log level. Omit for all levels.'),
    clear: z.boolean().optional().describe('If true, clear the console logs after reading them.'),
  },
  async (params) => {
    const result = await sendCommand('browser_get_console_logs', browserParams(params))
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'browser_execute_js',
  'Execute JavaScript in a browser tab. Pass tabId to run code in a specific tab. Returns the evaluation result.',
  {
    tabId: z.string().optional().describe('Tab to execute JS in. Use the tabId returned from browser_navigate. Omit to use the most recently used tab.'),
    code: z.string().describe('JavaScript code to execute in the page context'),
  },
  async (params) => {
    const result = await sendCommand('browser_execute_js', browserParams(params), BROWSER_REQUEST_TIMEOUT)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'browser_get_page_text',
  'Extract the text content (document.body.innerText) from a browser tab. Pass tabId to read from a specific tab. Optionally save to a file.',
  {
    tabId: z.string().optional().describe('Tab to extract text from. Use the tabId returned from browser_navigate. Omit to use the most recently used tab.'),
    savePath: z.string().optional().describe('Absolute file path to save the text content (e.g. "/tmp/page.txt"). Parent directory will be created if needed. When provided, content is saved to disk and the file path is returned.'),
  },
  async (params) => {
    const result = await sendCommand('browser_get_page_text', browserParams(params), HEAVY_REQUEST_TIMEOUT)
    if (params.savePath) {
      const text = typeof result === 'string' ? result : (result.text || JSON.stringify(result, null, 2))
      const dir = path.dirname(params.savePath)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(params.savePath, text, 'utf-8')
      return { content: [{ type: 'text', text: JSON.stringify({ filePath: params.savePath, sizeBytes: Buffer.byteLength(text, 'utf-8') }) }] }
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'browser_click',
  'Click an element in a browser tab. Provide either a selector or x/y coordinates. For DOM apps: use selectors (CSS, XPath "xpath:", text "text:"/"text*:", role "role:"). Elements are auto-scrolled into view. For canvas/WebGL apps: use x/y coordinates — get accurate coords via browser_get_elements or browser_execute_js with getBoundingClientRect(), NOT by estimating from screenshots (screenshots may render at a different scale).',
  {
    tabId: z.string().optional().describe('Tab to click in. Use the tabId returned from browser_navigate. Omit to use the most recently used tab.'),
    selector: z.string().optional().describe('Selector for the element. CSS: "button.submit", "#login". XPath: "xpath://button[text()=\'Submit\']". Text: "text:Sign In" or "text*:Sign". Role: "role:button".'),
    x: z.number().optional().describe('X coordinate to click (use with y instead of selector)'),
    y: z.number().optional().describe('Y coordinate to click (use with x instead of selector)'),
    button: z.enum(['left', 'right', 'middle']).optional().describe('Mouse button (default "left")'),
    clickCount: z.number().optional().describe('Click count (default 1, use 2 for double-click)'),
  },
  async (params) => {
    if (!params.selector && params.x === undefined) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Provide either selector or x/y coordinates' }) }], isError: true }
    }
    const result = await sendCommand('browser_click', browserParams(params), BROWSER_REQUEST_TIMEOUT)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

server.tool(
  'browser_scroll',
  'Scroll at a specific position in a browser tab using mouse wheel events. Essential for canvas/WebGL apps (Figma, maps) where DOM scrollIntoView does not work. Use negative deltaY to scroll down, positive to scroll up.',
  {
    tabId: z.string().optional().describe('Tab to scroll in. Omit to use the most recently used tab.'),
    x: z.number().describe('X coordinate for scroll position'),
    y: z.number().describe('Y coordinate for scroll position'),
    deltaX: z.number().optional().describe('Horizontal scroll amount (default 0). Positive = scroll right.'),
    deltaY: z.number().optional().describe('Vertical scroll amount (default -120). Negative = scroll down, positive = scroll up. One scroll wheel notch is typically 120.'),
  },
  async (params) => {
    const result = await sendCommand('browser_scroll', browserParams(params), BROWSER_REQUEST_TIMEOUT)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

server.tool(
  'browser_right_click',
  'Right-click at x/y coordinates in a browser tab. Opens context menus in canvas/WebGL apps. Take a screenshot first to identify the target position.',
  {
    tabId: z.string().optional().describe('Tab to right-click in. Omit to use the most recently used tab.'),
    x: z.number().describe('X coordinate to right-click'),
    y: z.number().describe('Y coordinate to right-click'),
  },
  async (params) => {
    const result = await sendCommand('browser_right_click', browserParams(params), BROWSER_REQUEST_TIMEOUT)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

server.tool(
  'browser_hover',
  'Move the mouse to x/y coordinates without clicking. Triggers hover states, tooltips, and mouseover events. Works with both DOM and canvas/WebGL apps.',
  {
    tabId: z.string().optional().describe('Tab to hover in. Omit to use the most recently used tab.'),
    x: z.number().describe('X coordinate to move mouse to'),
    y: z.number().describe('Y coordinate to move mouse to'),
  },
  async (params) => {
    const result = await sendCommand('browser_hover', browserParams(params), BROWSER_REQUEST_TIMEOUT)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

server.tool(
  'browser_double_click',
  'Double-click at x/y coordinates in a browser tab. Used for text selection, entering edit mode in canvas apps, and other double-click actions.',
  {
    tabId: z.string().optional().describe('Tab to double-click in. Omit to use the most recently used tab.'),
    x: z.number().describe('X coordinate to double-click'),
    y: z.number().describe('Y coordinate to double-click'),
  },
  async (params) => {
    const result = await sendCommand('browser_double_click', browserParams(params), BROWSER_REQUEST_TIMEOUT)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

server.tool(
  'browser_drag',
  'Drag from one position to another in a browser tab. Performs mouseDown at start, smooth mouseMove in steps, then mouseUp at end. Essential for canvas apps — moving objects, drawing, resizing, selecting regions.',
  {
    tabId: z.string().optional().describe('Tab to drag in. Omit to use the most recently used tab.'),
    fromX: z.number().describe('Starting X coordinate'),
    fromY: z.number().describe('Starting Y coordinate'),
    toX: z.number().describe('Ending X coordinate'),
    toY: z.number().describe('Ending Y coordinate'),
    steps: z.number().optional().describe('Number of intermediate mouse move events (default 10). More steps = smoother drag. Use 20-50 for precise drawing.'),
  },
  async (params) => {
    const result = await sendCommand('browser_drag', browserParams(params), BROWSER_REQUEST_TIMEOUT)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

server.tool(
  'browser_type',
  'Type text into the focused input in a browser tab. Click an input first with browser_click, then use this. Pass tabId to type in a specific tab.',
  {
    tabId: z.string().optional().describe('Tab to type in. Use the tabId returned from browser_navigate. Omit to use the most recently used tab.'),
    text: z.string().describe('Text to type'),
  },
  async (params) => {
    const result = await sendCommand('browser_type', browserParams(params), BROWSER_REQUEST_TIMEOUT)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

server.tool(
  'browser_key_press',
  'Press a keyboard key in a browser tab. Pass tabId to target a specific tab.',
  {
    tabId: z.string().optional().describe('Tab to press key in. Use the tabId returned from browser_navigate. Omit to use the most recently used tab.'),
    key: z.string().describe('Key to press (e.g. "Enter", "Tab", "Escape", "Backspace", "ArrowDown", "a", "1")'),
    modifiers: z.array(z.enum(['shift', 'control', 'alt', 'meta'])).optional().describe('Modifier keys to hold (e.g. ["control", "shift"])'),
  },
  async (params) => {
    const result = await sendCommand('browser_key_press', browserParams(params), BROWSER_REQUEST_TIMEOUT)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

server.tool(
  'browser_screenshot',
  'Take a screenshot of a browser tab. Returns a PNG image plus coordinate mapping info (cssWidth, cssHeight = the click coordinate space). IMPORTANT: The screenshot image is displayed at a DIFFERENT size than the actual viewport — you CANNOT estimate x/y click coordinates by looking at the image. To click at a position you see in the screenshot, either: (1) use browser_get_elements to find clickable elements with their real coordinates, (2) use browser_execute_js with getBoundingClientRect() for specific elements, or (3) multiply your visual estimate by (cssWidth / imageDisplayWidth) to scale — but methods 1-2 are more reliable.',
  {
    tabId: z.string().optional().describe('Tab to screenshot. Use the tabId returned from browser_navigate. Omit to use the most recently used tab.'),
    savePath: z.string().optional().describe('Absolute file path to save the PNG (e.g. "/tmp/screenshot.png"). Parent directory will be created if needed. When provided, the image is saved to disk and the file path is returned instead of inline image data.'),
  },
  async (params) => {
    const result = await sendCommand('browser_screenshot', browserParams(params), HEAVY_REQUEST_TIMEOUT)
    const imgData = result.dataUrl.replace(/^data:image\/png;base64,/, '')
    const meta = {
      tabId: result.tabId,
      imageWidth: result.imageWidth,
      imageHeight: result.imageHeight,
      cssWidth: result.cssWidth,
      cssHeight: result.cssHeight,
      devicePixelRatio: result.devicePixelRatio,
      coordinateGuide: 'browser_click x/y uses CSS coordinates (cssWidth x cssHeight). The image is ' + result.imageWidth + 'x' + result.imageHeight + ' pixels (device) but the click space is ' + result.cssWidth + 'x' + result.cssHeight + ' CSS pixels. Do NOT guess coordinates from the visual — use browser_get_elements or getBoundingClientRect() instead.'
    }
    if (params.savePath) {
      const buffer = Buffer.from(imgData, 'base64')
      const dir = path.dirname(params.savePath)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(params.savePath, buffer)
      return {
        content: [
          { type: 'text', text: JSON.stringify({ ...meta, filePath: params.savePath, sizeBytes: buffer.length }) },
        ]
      }
    }
    return {
      content: [
        { type: 'image', data: imgData, mimeType: 'image/png' },
        { type: 'text', text: JSON.stringify(meta) },
      ]
    }
  }
)

server.tool(
  'browser_start_recording',
  'Start recording a browser tab as animated WebP. Only changed frames are captured — identical content is skipped. No time limit. Call browser_stop_recording to finish. Pass tabId to record a specific tab.',
  {
    tabId: z.string().optional().describe('Tab to record. Use the tabId returned from browser_navigate. Omit to use the most recently used tab.'),
    fps: z.number().optional().describe('Frames per second (default 4, max 10). Lower = smaller file, higher = smoother.'),
    maxWidth: z.number().optional().describe('Maximum width in pixels (default 800). Height scales proportionally. Lower = smaller file.'),
  },
  async (params) => {
    const result = await sendCommand('browser_start_recording', browserParams(params), BROWSER_REQUEST_TIMEOUT)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

server.tool(
  'browser_stop_recording',
  'Stop recording and save as animated WebP. Returns file path, unique frame count, and session duration. Only frames where content changed are included — still periods are compressed.',
  {
    tabId: z.string().optional().describe('Tab to stop recording. Use the tabId returned from browser_navigate. Omit to use the most recently used tab.'),
    savePath: z.string().describe('Absolute file path to save the WebP (e.g. "/tmp/recording.webp"). Parent directory will be created if needed.'),
  },
  async (params) => {
    const result = await sendCommand('browser_stop_recording', browserParams(params), HEAVY_REQUEST_TIMEOUT)
    const base64 = result.dataUrl.replace(/^data:image\/webp;base64,/, '')
    const buffer = Buffer.from(base64, 'base64')
    const savePath = params.savePath
    const dir = path.dirname(savePath)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(savePath, buffer)
    return {
      content: [
        { type: 'text', text: JSON.stringify({ filePath: savePath, frames: result.frames, duration: result.duration, tabId: result.tabId, sizeBytes: buffer.length }) },
      ]
    }
  }
)

server.tool(
  'browser_form_input',
  'Fill a form field in one step: finds the element, clicks it, clears existing value, types the new value. Works with text inputs, textareas, select dropdowns, checkboxes, radio buttons, and contenteditable elements. Handles React-controlled inputs using the native setter pattern. Supports all selector types: CSS (default), XPath ("xpath:"), text ("text:"/"text*:"), role ("role:").',
  {
    tabId: z.string().optional().describe('Tab to interact with. Omit to use the most recently used tab.'),
    selector: z.string().describe('Selector for the form field (CSS, xpath:, text:, text*:, role:)'),
    value: z.string().describe('Value to enter. For selects: option value or visible text. For checkboxes: "true"/"false". For text inputs: the text to type.'),
    clear: z.boolean().optional().describe('Clear existing value before typing (default true). Set false to append.'),
    pressEnter: z.boolean().optional().describe('Press Enter after filling (default false). Useful for search fields.'),
  },
  async (params) => {
    const result = await sendCommand('browser_form_input', browserParams(params), BROWSER_REQUEST_TIMEOUT)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

server.tool(
  'browser_get_elements',
  'Discover interactive elements on the page. Returns visible, interactive elements with their selectors, text, attributes, and bounding rects. Use this before clicking or filling forms to find the right selectors. Much more efficient than guessing selectors or using screenshots.',
  {
    tabId: z.string().optional().describe('Tab to inspect. Omit to use the most recently used tab.'),
    selector: z.string().optional().describe('Optional filter (CSS, xpath:, text:, text*:, role:). Omit to get all interactive elements (buttons, links, inputs, etc).'),
    limit: z.number().optional().describe('Max elements to return (default 50).'),
  },
  async (params) => {
    const result = await sendCommand('browser_get_elements', browserParams(params), BROWSER_REQUEST_TIMEOUT)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'browser_fill_form',
  'Fill multiple form fields in one call, then optionally submit. Each field specifies a selector and value. This is much more efficient than calling browser_form_input repeatedly — a single call replaces 20+ click/type sequences.',
  {
    tabId: z.string().optional().describe('Tab to fill form in. Omit to use the most recently used tab.'),
    fields: z.array(z.object({
      selector: z.string().describe('Selector for the form field'),
      value: z.string().describe('Value to enter'),
    })).describe('Array of {selector, value} pairs to fill sequentially'),
    submit: z.union([z.boolean(), z.string()]).optional().describe('How to submit after filling. true = press Enter, string = click that selector (e.g. "button[type=submit]"). Omit to not submit.'),
  },
  async (params) => {
    const result = await sendCommand('browser_fill_form', browserParams(params), HEAVY_REQUEST_TIMEOUT)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// Download management
server.tool(
  'browser_set_download_dir',
  'Set the download directory for this agent\'s browser tab. When set, any file download in the browser will automatically save to this directory without showing a file dialog. By default, agent downloads go to .pixelcity/downloads/<agent-name>/.',
  {
    tabId: z.string().optional().describe('Tab to set download dir for. Omit to use the most recently used tab.'),
    directory: z.string().describe('Absolute path to the download directory. Will be created if it does not exist.'),
  },
  async (params) => {
    const result = await sendCommand('browser_set_download_dir', browserParams(params), BROWSER_REQUEST_TIMEOUT)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

server.tool(
  'browser_get_downloads',
  'List recent browser downloads with their status, filename, save path, and progress. Use this to check if a download completed successfully.',
  {
    tabId: z.string().optional().describe('Tab to get downloads for. Omit to get all downloads.'),
  },
  async (params) => {
    const result = await sendCommand('browser_get_downloads', browserParams(params), BROWSER_REQUEST_TIMEOUT)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// Create permanent employee
server.tool(
  'create_employee',
  'Create a permanent employee in Pixel City (persisted to disk)',
  {
    id: z.string().describe('Unique employee ID (used as folder name)'),
    settings: z.object({
      name: z.string().describe('Display name'),
      palette: z.number().optional().describe('Skin palette (0-5)'),
      hueShift: z.number().optional().describe('Hue shift in degrees'),
      role: z.string().optional().describe('Role/title'),
      personality: z.string().optional().describe('Personality description'),
      model: z.string().optional().describe('Claude model'),
      officeId: z.string().optional().describe('Office/building ID where employee works'),
      floorId: z.string().optional().describe('Floor ID within the office (defaults to "floor-0" if not specified)'),
    }).describe('Employee settings'),
    soul: z.string().optional().describe('Soul/personality markdown text'),
    projectDir: z.string().optional().describe('Project directory for scoping'),
  },
  async (params) => {
    const result = await sendCommand('create_employee', withProjectDir(params))
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// List employees
server.tool(
  'list_employees',
  'List all permanent employees in Pixel City',
  {
    projectDir: z.string().optional().describe('Project directory for scoping'),
  },
  async (params) => {
    const result = await sendCommand('list_employees', withProjectDir(params))
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// --- Board / Task tools ---

// Get board (paginated)
server.tool(
  'get_board',
  'Get the task board for a building. Returns tasks paginated to avoid large responses. Use column filter to fetch specific columns. Returns compact results by default (no changelog, subtask counts only).',
  {
    buildingId: z.string().optional().describe('Building ID (defaults to current office)'),
    projectDir: z.string().optional().describe('Project directory for scoping'),
    column: z.string().optional().describe('Filter by column key (e.g. "planning", "planned", "todo", "progress", "testing", "closed"). If omitted, returns all columns.'),
    limit: z.number().optional().describe('Max number of tasks to return (default: 20)'),
    offset: z.number().optional().describe('Number of tasks to skip (default: 0). Use with limit for pagination.'),
    verbose: z.boolean().optional().describe('If true, include full changelog and subtask details. Default: false (compact mode).'),
  },
  async (params) => {
    const result = await sendCommand('get_board', withProjectDir(params))
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// List tasks (with optional filters)
server.tool(
  'list_tasks',
  'List tasks on the board, optionally filtered by column or assignee. Pass assignee "self" to list your own tasks. By default returns compact results (no changelog or full subtask lists). Use verbose=true for full details.',
  {
    buildingId: z.string().optional().describe('Building ID'),
    projectDir: z.string().optional().describe('Project directory'),
    column: z.string().optional().describe('Filter by column key (e.g. "planning", "planned", "todo", "progress", "testing", "closed")'),
    assignee: z.string().optional().describe('Filter by assignee key (e.g. "emp:alice", "agent:3", or "self" for own tasks)'),
    verbose: z.boolean().optional().describe('If true, include full changelog and subtask details. Default: false (compact mode — strips changelog, replaces subtasks with counts)'),
  },
  async (params) => {
    const resolved = withProjectDir({ ...params })
    // Resolve "self" to the actual assignee key
    if (resolved.assignee === 'self') {
      const selfKey = resolveSelfAssigneeKey()
      if (!selfKey) throw new Error('Cannot resolve self assignee — no PIXEL_CITY_EMPLOYEE_ID or PIXEL_CITY_AGENT_ID set')
      resolved.assignee = selfKey
    }
    const result = await sendCommand('list_tasks', resolved)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// Get a single task or story by ID (returns full details including changelog and subtasks)
server.tool(
  'get_task',
  'Get full details of a single task or story by ID, including changelog and subtasks for stories.',
  {
    taskId: z.string().describe('Task ID (e.g. "PC-43")'),
    buildingId: z.string().optional().describe('Building ID'),
    projectDir: z.string().optional().describe('Project directory'),
  },
  async (params) => {
    const result = await sendCommand('get_task', withProjectDir(params))
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// Create task
server.tool(
  'create_task',
  'Create a new task or story on the board. Stories have their own sub-board for subtasks. Assignee defaults to self if not specified. Assignee must be currently in the office.',
  {
    title: z.string().describe('Task title'),
    type: z.enum(['task', 'story']).optional().describe('Type: "task" (default) or "story" (has its own sub-board for subtasks)'),
    buildingId: z.string().optional().describe('Building ID'),
    projectDir: z.string().optional().describe('Project directory'),
    column: z.enum(['planning', 'planned', 'backlog']).optional().describe('Column key to add to (default: "planning"). Tasks can only be created in "planning", "planned", or "backlog" columns.'),
    description: z.string().optional().describe('Task description (markdown supported)'),
    assignee: z.string().optional().describe('Assignee key (e.g. "emp:alice", "agent:3", or "self"). Defaults to self.'),
    tags: z.array(z.object({
      label: z.string(),
      color: z.enum(['accent', 'warm', 'error']).optional(),
    })).optional().describe('Tags for the task'),
  },
  async (params) => {
    const resolved = withProjectDir({ ...params })
    // Default assignee to self, resolve "self" keyword
    if (!resolved.assignee || resolved.assignee === 'self') {
      resolved.assignee = resolveSelfAssigneeKey() ?? undefined
    }
    resolved._callerKey = resolveSelfAssigneeKey() ?? 'mcp'
    const result = await sendCommand('create_task', resolved)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// Update task
server.tool(
  'update_task',
  'Update an existing task (title, description, assignee, tags). Assignee must be currently in the office.',
  {
    taskId: z.string().describe('Task ID (e.g. "PC-1")'),
    buildingId: z.string().optional().describe('Building ID'),
    projectDir: z.string().optional().describe('Project directory'),
    title: z.string().optional().describe('New title'),
    description: z.string().optional().describe('New description'),
    assignee: z.string().optional().describe('New assignee key (e.g. "emp:alice", "agent:3", or "self")'),
    tags: z.array(z.object({
      label: z.string(),
      color: z.enum(['accent', 'warm', 'error']).optional(),
    })).optional().describe('New tags'),
  },
  async (params) => {
    const resolved = withProjectDir({ ...params })
    if (resolved.assignee === 'self') {
      resolved.assignee = resolveSelfAssigneeKey() ?? undefined
    }
    resolved._callerKey = resolveSelfAssigneeKey() ?? 'mcp'
    const result = await sendCommand('update_task', resolved)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Move task between columns
server.tool(
  'move_task',
  'Move a task to a different column. Moving to "closed" is disabled via MCP. Moving to/from "backlog" skips adjacency validation.',
  {
    taskId: z.string().describe('Task ID (e.g. "PC-1")'),
    toColumn: z.string().describe('Target column key (e.g. "planning", "planned", "todo", "progress", "testing", "backlog"). Note: moving to "closed" is not allowed via MCP. Moving to/from "backlog" skips adjacency validation.'),
    buildingId: z.string().optional().describe('Building ID'),
    projectDir: z.string().optional().describe('Project directory'),
  },
  async (params) => {
    // PC-67: Disable moving to close via MCP
    if (params.toColumn === 'closed') {
      throw new Error('Moving tasks to "closed" is disabled via MCP. Use the Pixel City interface directly instead.')
    }

    const resolved = withProjectDir({ ...params })
    resolved._callerKey = resolveSelfAssigneeKey() ?? 'mcp'
    try {
      const result = await sendCommand('move_task', resolved)
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    } catch (err) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: true, message: err.message }) }], isError: true }
    }
  }
)

// --- Archive tools ---

// Archive a task (move to hidden archive)
server.tool(
  'archive_task',
  'Archive a task (moves it to a hidden archive, removing it from the board). Typically used for closed tasks to keep the board clean.',
  {
    taskId: z.string().describe('Task ID (e.g. "PC-1")'),
    buildingId: z.string().optional().describe('Building ID'),
    projectDir: z.string().optional().describe('Project directory'),
  },
  async (params) => {
    const resolved = withProjectDir({ ...params })
    resolved._callerKey = resolveSelfAssigneeKey() ?? 'mcp'
    const result = await sendCommand('archive_task', resolved)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Archive all closed tasks
server.tool(
  'archive_all_closed',
  'Archive all tasks currently in the "closed" column. Moves them to a hidden archive to keep the board clean.',
  {
    buildingId: z.string().optional().describe('Building ID'),
    projectDir: z.string().optional().describe('Project directory'),
  },
  async (params) => {
    const resolved = withProjectDir({ ...params })
    resolved._callerKey = resolveSelfAssigneeKey() ?? 'mcp'
    const result = await sendCommand('archive_all_closed', resolved)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Restore a task from archive
server.tool(
  'restore_task',
  'Restore an archived task back to the board. By default restores to "closed" column.',
  {
    taskId: z.string().describe('Task ID (e.g. "PC-1")'),
    toColumn: z.string().optional().describe('Column to restore to (default: "closed")'),
    buildingId: z.string().optional().describe('Building ID'),
    projectDir: z.string().optional().describe('Project directory'),
  },
  async (params) => {
    const resolved = withProjectDir({ ...params })
    resolved._callerKey = resolveSelfAssigneeKey() ?? 'mcp'
    const result = await sendCommand('restore_task', resolved)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// List archived tasks
server.tool(
  'list_archived_tasks',
  'List all archived tasks. These are tasks that were moved to the archive to keep the board clean.',
  {
    buildingId: z.string().optional().describe('Building ID'),
    projectDir: z.string().optional().describe('Project directory'),
    verbose: z.boolean().optional().describe('If true, include full details. Default: false (compact mode).'),
  },
  async (params) => {
    const result = await sendCommand('list_archived_tasks', withProjectDir(params))
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// --- Subtask tools (inside stories) ---

// Create subtask inside a story
server.tool(
  'create_subtask',
  'Create a subtask inside a story. The subtask is added to the story\'s sub-board. Assignee must be currently in the office.',
  {
    storyId: z.string().describe('Parent story ID (e.g. "PC-3")'),
    title: z.string().describe('Subtask title'),
    buildingId: z.string().optional().describe('Building ID'),
    projectDir: z.string().optional().describe('Project directory'),
    column: z.enum(['planning', 'planned']).optional().describe('Column key to add to (default: "planning"). Subtasks can only be created in "planning" or "planned" columns.'),
    description: z.string().optional().describe('Subtask description'),
    assignee: z.string().optional().describe('Assignee key (e.g. "emp:alice", "agent:3", or "self"). Defaults to self.'),
    tags: z.array(z.object({
      label: z.string(),
      color: z.enum(['accent', 'warm', 'error']).optional(),
    })).optional().describe('Tags for the subtask'),
  },
  async (params) => {
    const resolved = withProjectDir({ ...params })
    if (!resolved.assignee || resolved.assignee === 'self') {
      resolved.assignee = resolveSelfAssigneeKey() ?? undefined
    }
    resolved._callerKey = resolveSelfAssigneeKey() ?? 'mcp'
    const result = await sendCommand('create_subtask', resolved)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// List subtasks in a story
server.tool(
  'list_subtasks',
  'List subtasks inside a story, optionally filtered by column or assignee.',
  {
    storyId: z.string().describe('Parent story ID (e.g. "PC-3")'),
    buildingId: z.string().optional().describe('Building ID'),
    projectDir: z.string().optional().describe('Project directory'),
    column: z.string().optional().describe('Filter by column key'),
    assignee: z.string().optional().describe('Filter by assignee key (use "self" for own subtasks)'),
  },
  async (params) => {
    const resolved = withProjectDir({ ...params })
    if (resolved.assignee === 'self') {
      const selfKey = resolveSelfAssigneeKey()
      if (!selfKey) throw new Error('Cannot resolve self assignee — no PIXEL_CITY_EMPLOYEE_ID or PIXEL_CITY_AGENT_ID set')
      resolved.assignee = selfKey
    }
    const result = await sendCommand('list_subtasks', resolved)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// Update subtask
server.tool(
  'update_subtask',
  'Update a subtask inside a story (title, description, assignee, tags). Assignee must be currently in the office.',
  {
    storyId: z.string().describe('Parent story ID (e.g. "PC-3")'),
    subtaskId: z.string().describe('Subtask ID (e.g. "PC-3-1")'),
    buildingId: z.string().optional().describe('Building ID'),
    projectDir: z.string().optional().describe('Project directory'),
    title: z.string().optional().describe('New title'),
    description: z.string().optional().describe('New description'),
    assignee: z.string().optional().describe('New assignee key'),
    tags: z.array(z.object({
      label: z.string(),
      color: z.enum(['accent', 'warm', 'error']).optional(),
    })).optional().describe('New tags'),
  },
  async (params) => {
    const resolved = withProjectDir({ ...params })
    if (resolved.assignee === 'self') {
      resolved.assignee = resolveSelfAssigneeKey() ?? undefined
    }
    resolved._callerKey = resolveSelfAssigneeKey() ?? 'mcp'
    const result = await sendCommand('update_subtask', resolved)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Move subtask between columns
server.tool(
  'move_subtask',
  'Move a subtask to a different column within its parent story\'s sub-board. Moving to "closed" is disabled via MCP.',
  {
    storyId: z.string().describe('Parent story ID (e.g. "PC-3")'),
    subtaskId: z.string().describe('Subtask ID (e.g. "PC-3-1")'),
    toColumn: z.string().describe('Target column key (e.g. "planning", "planned", "todo", "progress", "testing"). Note: moving to "closed" is not allowed via MCP.'),
    buildingId: z.string().optional().describe('Building ID'),
    projectDir: z.string().optional().describe('Project directory'),
  },
  async (params) => {
    // PC-67: Disable moving to close via MCP
    if (params.toColumn === 'closed') {
      throw new Error('Moving subtasks to "closed" is disabled via MCP. Use the Pixel City interface directly instead.')
    }

    const resolved = withProjectDir({ ...params })
    resolved._callerKey = resolveSelfAssigneeKey() ?? 'mcp'
    try {
      const result = await sendCommand('move_subtask', resolved)
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    } catch (err) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: true, message: err.message }) }], isError: true }
    }
  }
)

// Delete subtask
server.tool(
  'delete_subtask',
  'Delete a subtask from a story\'s sub-board',
  {
    storyId: z.string().describe('Parent story ID (e.g. "PC-3")'),
    subtaskId: z.string().describe('Subtask ID (e.g. "PC-3-1")'),
    buildingId: z.string().optional().describe('Building ID'),
    projectDir: z.string().optional().describe('Project directory'),
  },
  async (params) => {
    const result = await sendCommand('delete_subtask', withProjectDir(params))
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// ── Agent-to-Agent Messaging ─────────────────────────────────────

// Send message — send a message to another agent in the office
server.tool(
  'send_message',
  'Send a message to another agent in the office. Use this to report results, request help, or notify a teamlead that you are done with a task.',
  {
    to: z.string().describe('Recipient agent ID'),
    subject: z.string().describe('Short subject line'),
    body: z.string().describe('Full message content'),
    type: z.enum(['result', 'status', 'request', 'info']).optional().describe('Message type (default: info)'),
    replyTo: z.string().optional().describe('ID of the message you are replying to'),
  },
  async (params) => {
    const from = resolveAgentId({})
    const result = await sendCommand('send_message', {
      from,
      fromName: SELF_AGENT_NAME,
      to: params.to,
      subject: params.subject,
      body: params.body,
      type: params.type || 'info',
      replyTo: params.replyTo,
    })
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Check messages — check inbox for new messages from other agents
server.tool(
  'check_messages',
  'Check your inbox for messages from other agents. Returns unread messages by default. Call this periodically when waiting for sub-agent results.',
  {
    from: z.string().optional().describe('Filter messages from a specific agent ID'),
    unreadOnly: z.boolean().optional().describe('Only return unread messages (default: true)'),
  },
  async (params) => {
    const result = await sendCommand('check_messages', {
      agentId: resolveAgentId({}),
      from: params.from,
      unreadOnly: params.unreadOnly ?? true,
    })
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// Read message — read a specific message and mark it as read
server.tool(
  'read_message',
  'Read a specific message by ID and mark it as read.',
  {
    messageId: z.string().describe('ID of the message to read'),
  },
  async (params) => {
    const result = await sendCommand('read_message', {
      agentId: resolveAgentId({}),
      messageId: params.messageId,
    })
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// List messages — list all messages in inbox (read and unread)
server.tool(
  'list_messages',
  'List all messages in your inbox (both read and unread), sorted newest first.',
  {
    limit: z.number().optional().describe('Max messages to return (default: 20)'),
    offset: z.number().optional().describe('Skip first N messages (default: 0)'),
  },
  async (params) => {
    const result = await sendCommand('list_messages', {
      agentId: resolveAgentId({}),
      limit: params.limit ?? 20,
      offset: params.offset ?? 0,
    })
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// ── Meetings (Group Chat) ────────────────────────────────────────

// Helper: load meeting guidelines from system prompt or project config
function loadMeetingGuidelines(projectDir) {
  // First check project config for user-customized guidelines
  const config = loadProjectConfig(projectDir)
  if (config && config.meetingGuidelines) {
    const resolved = resolveInstructionText(config.meetingGuidelines)
    if (resolved) return resolved
  }
  // Fall back to the default system prompt
  const defaultPath = path.join(SYSTEM_PROMPTS_DIR, 'meeting-guidelines.md')
  try {
    if (fs.existsSync(defaultPath)) {
      return fs.readFileSync(defaultPath, 'utf8').trim() || null
    }
  } catch (err) {
    process.stderr.write(`[pixel-city-mcp] Warning: Could not read meeting guidelines from ${defaultPath}: ${err.message}\n`)
  }
  return null
}

// Helper: enforce meeting guidelines gate — returns error response if not fetched, or null if OK
function enforceMeetingGuidelines() {
  if (meetingGuidelinesFetched) return null
  const guidelines = loadMeetingGuidelines(SELF_PROJECT_DIR)
  if (guidelines) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: true,
          message: 'Meeting guidelines are configured but you have not read them yet. Please call get_meeting_guidelines first before using any meeting tools. This ensures your meeting speech sounds natural and human-like.'
        })
      }]
    }
  }
  return null
}

// Get meeting guidelines — MUST be called before any other meeting tool
server.tool(
  'get_meeting_guidelines',
  'Read the meeting voice & speech guidelines. IMPORTANT: You MUST call this tool before using any meeting tools (create_meeting, join_meeting, meeting_send, etc.). Returns instructions on how to speak naturally in meetings — filler words, sentence length, conversational tone. This tool will also return user-customized guidelines if configured.',
  {},
  async () => {
    const guidelines = loadMeetingGuidelines(SELF_PROJECT_DIR)
    meetingGuidelinesFetched = true

    if (!guidelines) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ hasGuidelines: false, message: 'No meeting guidelines configured. You may proceed with meeting tools freely, but try to keep your speech natural and conversational.' })
        }]
      }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ hasGuidelines: true, guidelines })
      }]
    }
  }
)

// Create meeting — start a new group meeting
server.tool(
  'create_meeting',
  'Create a new meeting (group chat) for agents to brainstorm and collaborate. You become the host.',
  {
    title: z.string().describe('Meeting title (e.g. "Sprint Planning", "Architecture Review")'),
    participants: z.array(z.string()).optional().describe('Agent IDs to invite. You are automatically included as host.'),
  },
  async (params) => {
    const blocked = enforceMeetingGuidelines()
    if (blocked) return blocked
    const hostId = resolveAgentId({})
    const result = await sendCommand('create_meeting', {
      hostId,
      hostName: SELF_AGENT_NAME,
      title: params.title,
      buildingId: SELF_BUILDING_ID || undefined,
      participants: params.participants ? [hostId, ...params.participants.filter(p => p !== hostId)] : [hostId],
    })
    // Host speaks first — tell them directly in the response
    const meeting = result?.meeting
    if (meeting) {
      result._turnInstruction = `[YOUR TURN] You speak first in "${meeting.title}" (${meeting.id}). Call meeting_send({ meetingId: "${meeting.id}", text: "...", delivery: "..." }) now.`
    }
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Join meeting — join an existing active meeting
server.tool(
  'join_meeting',
  'Join an active meeting as a participant.',
  {
    meetingId: z.string().describe('ID of the meeting to join'),
  },
  async (params) => {
    const blocked = enforceMeetingGuidelines()
    if (blocked) return blocked
    const result = await sendCommand('join_meeting', {
      meetingId: params.meetingId,
      agentId: resolveAgentId({}),
    })
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Leave meeting — leave a meeting
server.tool(
  'leave_meeting',
  'Leave a meeting you are currently in.',
  {
    meetingId: z.string().describe('ID of the meeting to leave'),
  },
  async (params) => {
    const blocked = enforceMeetingGuidelines()
    if (blocked) return blocked
    const result = await sendCommand('leave_meeting', {
      meetingId: params.meetingId,
      agentId: resolveAgentId({}),
    })
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Close meeting — end a meeting (host only conceptually, but any participant can close for now)
server.tool(
  'close_meeting',
  'Close/end a meeting. The meeting becomes read-only after closing.',
  {
    meetingId: z.string().describe('ID of the meeting to close'),
  },
  async (params) => {
    const blocked = enforceMeetingGuidelines()
    if (blocked) return blocked
    const result = await sendCommand('close_meeting', {
      meetingId: params.meetingId,
    })
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Delete meeting — permanently remove a meeting and all its messages
server.tool(
  'delete_meeting',
  'Permanently delete a meeting and all its messages. This cannot be undone.',
  {
    meetingId: z.string().describe('ID of the meeting to delete'),
  },
  async (params) => {
    const blocked = enforceMeetingGuidelines()
    if (blocked) return blocked
    const result = await sendCommand('delete_meeting', {
      meetingId: params.meetingId,
    })
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Meeting send — send a message to a meeting group chat (turn-based)
server.tool(
  'meeting_send',
  `Send a spoken message to a meeting group chat. You must be a participant AND it must be your turn.

TURN SYSTEM: When you see [YOUR TURN] in your messages (via check_messages), respond immediately with this tool. The message body includes recent conversation so do NOT call meeting_messages first. You have ~60 seconds before auto-skip, plus a 15-second grace period even after that. After you speak, the next participant is notified automatically.

Send your full message as a single "text" string (3-4 sentences max). Add a "delivery" instruction describing the overall tone and arc of how it should be spoken — this goes to the TTS engine as a single generation for consistent voice.

Example:
  text: "Hmm, that's an interesting point. I think we could take a different approach though. What if we split the work into two phases?"
  delivery: "Start thoughtful and considering, then shift to confident as the idea forms. End with a curious, proposing tone."

Good delivery descriptors: "casual and relaxed", "thinking out loud, then landing on a conclusion", "warm agreement building into a new idea", "hesitant at first, then more confident", "matter-of-fact with a curious question at the end"`,
  {
    meetingId: z.string().describe('ID of the meeting'),
    text: z.string().describe('The full spoken message (3-4 sentences max). Write naturally with filler words, contractions, and conversational phrasing.'),
    delivery: z.string().optional().describe('How the TTS voice should deliver the message — describe the overall tone and emotional arc. e.g. "Start casual, build confidence, end with a question"'),
  },
  async (params) => {
    const blocked = enforceMeetingGuidelines()
    if (blocked) return blocked
    const result = await sendCommand('meeting_send', {
      meetingId: params.meetingId,
      agentId: resolveAgentId({}),
      agentName: SELF_AGENT_NAME,
      text: params.text,
      delivery: params.delivery,
    })
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Skip turn — host can skip the current speaker's turn
server.tool(
  'skip_turn',
  'Skip the current turn and advance to the next participant. Only the meeting host can do this. The next participant will be notified via [YOUR TURN] in their terminal.',
  {
    meetingId: z.string().describe('ID of the meeting'),
  },
  async (params) => {
    const blocked = enforceMeetingGuidelines()
    if (blocked) return blocked
    const result = await sendCommand('skip_turn', {
      meetingId: params.meetingId,
      requesterId: resolveAgentId({}),
    })
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Meeting messages — read messages from a meeting
server.tool(
  'meeting_messages',
  'Read messages from a meeting group chat. Returns messages in chronological order.',
  {
    meetingId: z.string().describe('ID of the meeting'),
    limit: z.number().optional().describe('Max messages to return (default: 50)'),
    offset: z.number().optional().describe('Skip first N messages (default: 0)'),
  },
  async (params) => {
    const blocked = enforceMeetingGuidelines()
    if (blocked) return blocked
    const result = await sendCommand('meeting_messages', {
      meetingId: params.meetingId,
      limit: params.limit ?? 50,
      offset: params.offset ?? 0,
    })
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// Get meeting — get details about a specific meeting
server.tool(
  'get_meeting',
  'Get details about a specific meeting including participants, status, and message count.',
  {
    meetingId: z.string().describe('ID of the meeting'),
  },
  async (params) => {
    const blocked = enforceMeetingGuidelines()
    if (blocked) return blocked
    const result = await sendCommand('get_meeting', {
      meetingId: params.meetingId,
    })
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// List meetings — list all meetings
server.tool(
  'list_meetings',
  'List all meetings. Filter by status: active, closed, or all.',
  {
    status: z.enum(['active', 'closed', 'all']).optional().describe('Filter by meeting status (default: all)'),
  },
  async (params) => {
    const blocked = enforceMeetingGuidelines()
    if (blocked) return blocked
    const result = await sendCommand('list_meetings', {
      status: params.status ?? 'all',
      buildingId: SELF_BUILDING_ID || undefined,
    })
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// --- Plan & Voting tools ---

// Get plan — read the shared plan and proposals
server.tool(
  'meeting_get_plan',
  'Get the shared plan document and all proposals for a meeting. Use this to see the current state of the plan and any pending votes.',
  {
    meetingId: z.string().describe('ID of the meeting'),
  },
  async (params) => {
    const blocked = enforceMeetingGuidelines()
    if (blocked) return blocked
    const result = await sendCommand('meeting_get_plan', {
      meetingId: params.meetingId,
    })
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// Update plan — host directly edits the plan document
server.tool(
  'meeting_update_plan',
  'Directly update the shared plan document (host only). Use this to set the initial plan or make edits based on accepted proposals. The plan is markdown.',
  {
    meetingId: z.string().describe('ID of the meeting'),
    plan: z.string().describe('The full updated plan content (markdown)'),
  },
  async (params) => {
    const blocked = enforceMeetingGuidelines()
    if (blocked) return blocked
    const result = await sendCommand('meeting_update_plan', {
      meetingId: params.meetingId,
      requesterId: resolveAgentId({}),
      plan: params.plan,
    })
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Propose — submit a proposal for plan changes
server.tool(
  'meeting_propose',
  `Submit a proposal for changes to the shared plan. All participants will vote on it.

VOTING RULES:
- Unanimous YES → proposal is automatically accepted and appended to the plan
- Any NO → proposal is rejected (proposer can refine and re-submit)
- You can propose during your speaking turn or at any time

Keep proposals focused — one idea per proposal. Include a rationale so others understand why.`,
  {
    meetingId: z.string().describe('ID of the meeting'),
    content: z.string().describe('The proposed plan content (markdown). This will be appended to the plan if accepted.'),
    rationale: z.string().optional().describe('Brief explanation of why this change matters'),
  },
  async (params) => {
    const blocked = enforceMeetingGuidelines()
    if (blocked) return blocked
    const result = await sendCommand('meeting_propose', {
      meetingId: params.meetingId,
      agentId: resolveAgentId({}),
      agentName: SELF_AGENT_NAME,
      content: params.content,
      rationale: params.rationale,
    })
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// Vote — vote on a proposal
server.tool(
  'meeting_vote',
  `Vote on a pending proposal. Cast "yes" to approve or "no" to reject. Optionally include a reason.

When all participants have voted:
- All YES → proposal is accepted and auto-appended to the plan
- Any NO → proposal is rejected

If rejected, the proposer may refine and re-submit.`,
  {
    meetingId: z.string().describe('ID of the meeting'),
    proposalId: z.string().describe('ID of the proposal to vote on'),
    vote: z.enum(['yes', 'no']).describe('Your vote: "yes" to approve, "no" to reject'),
    reason: z.string().optional().describe('Optional reason for your vote'),
  },
  async (params) => {
    const blocked = enforceMeetingGuidelines()
    if (blocked) return blocked
    const result = await sendCommand('meeting_vote', {
      meetingId: params.meetingId,
      proposalId: params.proposalId,
      agentId: resolveAgentId({}),
      agentName: SELF_AGENT_NAME,
      vote: params.vote,
      reason: params.reason,
    })
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// --- Start ---

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('[pixel-city-mcp] MCP server started, waiting for commands...\n')
}

main().catch((err) => {
  process.stderr.write(`[pixel-city-mcp] Fatal: ${err.message}\n`)
  process.exit(1)
})
