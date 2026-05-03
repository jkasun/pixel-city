#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { sendCommand } from '../shared/ws-client.js'
import {
  SELF_AGENT_ID,
  SELF_AGENT_NAME,
  BROWSER_REQUEST_TIMEOUT,
  HEAVY_REQUEST_TIMEOUT,
} from '../shared/env.js'

const server = new McpServer({
  name: 'pixel-city-browser-control',
  version: '1.0.0',
})

// Helper: inject agent identity + optional tabId into browser command params
let defaultTabId = null

function browserParams(params = {}) {
  const p = { ...params, agentId: SELF_AGENT_ID, agentName: SELF_AGENT_NAME }
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
    if (params.newTab) delete p.tabId
    const result = await sendCommand('browser_navigate', p, BROWSER_REQUEST_TIMEOUT)
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

// --- Start ---
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('[pixel-city-browser-control] MCP server started\n')
}

main().catch((err) => {
  process.stderr.write(`[pixel-city-browser-control] Fatal: ${err.message}\n`)
  process.exit(1)
})
