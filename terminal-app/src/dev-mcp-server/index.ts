#!/usr/bin/env node
/**
 * Dev MCP Server for Pixel City
 *
 * Development-only MCP server that provides debugging tools for the Electron app.
 * Connects to the Pixel City WebSocket bridge and sends dev:* commands that are
 * handled directly in the main process (not forwarded to renderer).
 *
 * Usage: node dist/electron/dev-mcp-server/index.js
 * Env:   PIXEL_CITY_WS_URL (default: ws://localhost:19840)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import WebSocket from 'ws';

// MCP clients may pass booleans as strings ("true"/"false").
// z.coerce.boolean() would treat "false" as true (non-empty string), so we preprocess.
const zBool = () => z.preprocess(
  (v) => (v === 'true' ? true : v === 'false' ? false : v),
  z.boolean(),
);

// --- WebSocket connection to Pixel City ---

const WS_URL = process.env.PIXEL_CITY_WS_URL || 'ws://localhost:19840';
const REQUEST_TIMEOUT = 15_000;
const SCREENSHOT_TIMEOUT = 30_000;
const WAIT_TIMEOUT = 30_000;
const CONNECT_TIMEOUT = 5_000;

let ws: WebSocket | null = null;
let msgIdCounter = 0;
let connectionState: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 10_000;
const pendingRequests = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

function log(msg: string) {
  process.stderr.write(`[pixel-city-dev-mcp] ${msg}\n`);
}

function setupSocket(socket: WebSocket) {
  socket.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.id !== undefined) {
        const pending = pendingRequests.get(msg.id);
        if (pending) {
          pendingRequests.delete(msg.id);
          if (msg.error) pending.reject(new Error(msg.error));
          else pending.resolve(msg.result);
        }
      }
    } catch { /* ignore malformed */ }
  });

  socket.on('close', () => {
    ws = null;
    connectionState = 'disconnected';
    // Reject all pending
    for (const [id, p] of pendingRequests) {
      p.reject(new Error('WebSocket closed'));
      pendingRequests.delete(id);
    }
    // Schedule reconnect
    scheduleReconnect();
  });

  socket.on('error', () => {
    // error event is always followed by close, so reconnect happens there
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  log(`Reconnecting in ${reconnectDelay}ms...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket().catch(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    });
  }, reconnectDelay);
}

function connectWebSocket(): Promise<WebSocket> {
  if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve(ws);
  if (connectionState === 'connecting') {
    return new Promise((resolve, reject) => {
      const check = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) { clearInterval(check); resolve(ws); }
        else if (connectionState === 'disconnected') { clearInterval(check); reject(new Error('Connection failed')); }
      }, 100);
      setTimeout(() => { clearInterval(check); reject(new Error('Connect wait timeout')); }, CONNECT_TIMEOUT);
    });
  }

  connectionState = 'connecting';
  if (ws) { try { ws.close(); } catch {} ws = null; }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      connectionState = 'disconnected';
      reject(new Error(`WebSocket connect timeout (${WS_URL})`));
      try { socket.close(); } catch {}
    }, CONNECT_TIMEOUT);

    const socket = new WebSocket(WS_URL);

    socket.on('open', () => {
      clearTimeout(timer);
      ws = socket;
      connectionState = 'connected';
      reconnectDelay = 1000; // reset backoff
      log(`Connected to ${WS_URL}`);
      setupSocket(socket);
      resolve(socket);
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      connectionState = 'disconnected';
      reject(err);
    });
  });
}

function ensureConnected(): Promise<WebSocket> {
  return connectWebSocket();
}

async function sendCommand(action: string, params: Record<string, any> = {}, timeout = REQUEST_TIMEOUT): Promise<any> {
  const socket = await ensureConnected();
  const id = msgIdCounter++;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Timeout waiting for ${action}`));
    }, timeout);

    pendingRequests.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });

    socket.send(JSON.stringify({ id, action, params }));
  });
}

// --- MCP Server ---

const server = new McpServer(
  { name: 'pixel-city-dev', version: '1.0.0' },
);

// Tool: Execute JavaScript in the Electron renderer
server.tool(
  'execute_js',
  'Execute JavaScript code in the Pixel City Electron renderer process. ' +
  'Has full access to the DOM, React internals, Node.js APIs, and Electron APIs. ' +
  'Returns the stringified result of the expression.',
  {
    code: z.string().describe('JavaScript code to execute in the renderer process'),
  },
  async ({ code }) => {
    try {
      const result = await sendCommand('dev:execute-js', { code });
      if (result.error) {
        return { content: [{ type: 'text', text: `Error: ${result.error}\n${result.stack || ''}` }] };
      }
      return { content: [{ type: 'text', text: result.value }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Failed: ${err.message}` }], isError: true };
    }
  }
);

// Tool: Get console logs from the renderer
server.tool(
  'get_console_logs',
  'Retrieve captured console logs (log/warn/error/info/debug) from the Pixel City Electron renderer. ' +
  'Logs are buffered in-memory (up to 500 entries). Use this to debug renderer issues.',
  {
    count: z.coerce.number().optional().describe('Number of recent log entries to return (default 100)'),
    level: z.string().optional().describe('Filter by log level: log, warn, error, info, debug'),
    pattern: z.string().optional().describe('Regex pattern to filter log messages (case-insensitive)'),
    since: z.coerce.number().optional().describe('Only return logs after this Unix timestamp (ms)'),
    clear: zBool().optional().describe('Clear the log buffer after reading (default false)'),
  },
  async ({ count, level, pattern, since, clear }) => {
    try {
      const result = await sendCommand('dev:get-logs', { count, level, pattern, since, clear });
      if (!result.logs || result.logs.length === 0) {
        return { content: [{ type: 'text', text: 'No logs captured.' }] };
      }
      const formatted = result.logs.map((l: any) => {
        const time = new Date(l.timestamp).toISOString().substr(11, 12);
        return `[${time}] [${l.level.toUpperCase().padEnd(5)}] ${l.args}`;
      }).join('\n');
      return { content: [{ type: 'text', text: `${result.logs.length} log entries:\n\n${formatted}` }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Failed: ${err.message}` }], isError: true };
    }
  }
);

// Tool: Clear console logs
server.tool(
  'clear_console_logs',
  'Clear the captured console log buffer.',
  {},
  async () => {
    try {
      await sendCommand('dev:clear-logs');
      return { content: [{ type: 'text', text: 'Log buffer cleared.' }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Failed: ${err.message}` }], isError: true };
    }
  }
);

// Tool: Screenshot the Electron window
server.tool(
  'screenshot',
  'Take a screenshot of the Pixel City Electron window. Returns a base64-encoded PNG image.',
  {},
  async () => {
    try {
      const result = await sendCommand('dev:screenshot', {}, SCREENSHOT_TIMEOUT);
      return {
        content: [
          { type: 'image', data: result.base64, mimeType: 'image/png' },
          { type: 'text', text: `Screenshot captured: ${result.width}x${result.height}` },
        ]
      };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Screenshot failed: ${err.message}` }], isError: true };
    }
  }
);

// Tool: Get window info
server.tool(
  'get_window_info',
  'Get information about the Pixel City Electron window: bounds, URL, title, focus state, devtools status.',
  {},
  async () => {
    try {
      const result = await sendCommand('dev:get-window-info');
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Failed: ${err.message}` }], isError: true };
    }
  }
);

// Tool: Query a DOM element
server.tool(
  'query_dom',
  'Query a DOM element in the Pixel City renderer using a CSS selector. ' +
  'Returns tag, id, className, text content, bounding rect, and child count.',
  {
    selector: z.string().describe('CSS selector to query (e.g. "#app", ".panel", "[data-testid=xyz]")'),
  },
  async ({ selector }) => {
    try {
      const result = await sendCommand('dev:query-dom', { selector });
      if (!result.found) {
        return { content: [{ type: 'text', text: `No element found for selector: ${selector}` }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Failed: ${err.message}` }], isError: true };
    }
  }
);

// Tool: List DOM elements
server.tool(
  'list_dom',
  'List DOM elements matching a CSS selector. Returns tag, id, class, and text snippet for each match.',
  {
    selector: z.string().optional().describe('CSS selector (default "*")'),
    limit: z.coerce.number().optional().describe('Max elements to return (default 50)'),
  },
  async ({ selector, limit }) => {
    try {
      const result = await sendCommand('dev:list-dom', { selector, limit });
      return { content: [{ type: 'text', text: JSON.stringify(result.elements, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Failed: ${err.message}` }], isError: true };
    }
  }
);

// Tool: List browser tabs
server.tool(
  'browser_list_tabs',
  'List all open browser tabs in the Pixel City integrated browser. ' +
  'Returns tabId, URL, title, loading state, and navigation state for each tab.',
  {},
  async () => {
    try {
      const result = await sendCommand('dev:browser-list-tabs');
      if (!result.tabs || result.tabs.length === 0) {
        return { content: [{ type: 'text', text: 'No browser tabs open.' }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result.tabs, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Failed: ${err.message}` }], isError: true };
    }
  }
);

// ============================= Interactions =============================

// Tool: Click a DOM element
server.tool(
  'click',
  'Click a DOM element by CSS selector. Scrolls into view first, dispatches mousedown/mouseup/click events. ' +
  'Use this to test interactive UI elements like buttons, links, tabs, etc.',
  {
    selector: z.string().describe('CSS selector of the element to click'),
    doubleClick: zBool().optional().describe('Perform a double-click (default false)'),
    modifiers: z.object({
      ctrl: zBool().optional(),
      shift: zBool().optional(),
      alt: zBool().optional(),
      meta: zBool().optional(),
    }).optional().describe('Keyboard modifiers to hold during click'),
  },
  async ({ selector, doubleClick, modifiers }) => {
    try {
      const result = await sendCommand('dev:click', { selector, doubleClick, modifiers });
      if (!result.clicked) {
        return { content: [{ type: 'text', text: `Element not found or not clickable: ${selector}` }] };
      }
      return { content: [{ type: 'text', text: `Clicked "${selector}" (${result.tag}${result.id ? '#' + result.id : ''})` }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Click failed: ${err.message}` }], isError: true };
    }
  }
);

// Tool: Type into an input/textarea
server.tool(
  'type',
  'Type text into a focused or selected input/textarea element. Simulates real input events ' +
  'that React will pick up. Use this to fill forms, search boxes, etc.',
  {
    selector: z.string().describe('CSS selector of the input element'),
    text: z.string().describe('Text to type into the element'),
    clear: zBool().optional().describe('Clear the field before typing (default false)'),
    pressEnter: zBool().optional().describe('Press Enter after typing (default false)'),
  },
  async ({ selector, text, clear, pressEnter }) => {
    try {
      const result = await sendCommand('dev:type', { selector, text, clear, pressEnter });
      if (!result.typed) {
        return { content: [{ type: 'text', text: `Element not found or not typeable: ${selector}` }] };
      }
      return { content: [{ type: 'text', text: `Typed ${text.length} chars into "${selector}"${pressEnter ? ' + Enter' : ''}` }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Type failed: ${err.message}` }], isError: true };
    }
  }
);

// ============================= Waiting / Polling =============================

// Tool: Wait for a DOM element to appear
server.tool(
  'wait_for_selector',
  'Wait for a DOM element matching a CSS selector to appear. Polls until found or timeout. ' +
  'Essential for testing async UI updates — call this after an action to wait for the result.',
  {
    selector: z.string().describe('CSS selector to wait for'),
    timeout: z.coerce.number().optional().describe('Max wait time in ms (default 10000)'),
    visible: zBool().optional().describe('Wait for element to also be visible (default false)'),
  },
  async ({ selector, timeout, visible }) => {
    try {
      const effectiveTimeout = timeout ?? 10000;
      const result = await sendCommand(
        'dev:wait-for-selector',
        { selector, timeout: effectiveTimeout, visible },
        Math.max(WAIT_TIMEOUT, effectiveTimeout + 5000),
      );
      if (!result.found) {
        return { content: [{ type: 'text', text: `Timeout: "${selector}" did not appear within ${effectiveTimeout}ms` }] };
      }
      return { content: [{ type: 'text', text: `Found "${selector}" after ${result.elapsed}ms\n${JSON.stringify(result.element, null, 2)}` }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Wait failed: ${err.message}` }], isError: true };
    }
  }
);

// Tool: Wait for text to appear
server.tool(
  'wait_for_text',
  'Wait for specific text to appear in the DOM. Polls until found or timeout. ' +
  'Use after triggering an action to verify expected text renders.',
  {
    text: z.string().describe('Text string or regex pattern to wait for'),
    selector: z.string().optional().describe('Scope the search to this CSS selector (default "body")'),
    timeout: z.coerce.number().optional().describe('Max wait time in ms (default 10000)'),
    regex: zBool().optional().describe('Treat text as a regex pattern (default false)'),
  },
  async ({ text, selector, timeout, regex }) => {
    try {
      const effectiveTimeout = timeout ?? 10000;
      const result = await sendCommand(
        'dev:wait-for-text',
        { text, selector, timeout: effectiveTimeout, regex },
        Math.max(WAIT_TIMEOUT, effectiveTimeout + 5000),
      );
      if (!result.found) {
        return { content: [{ type: 'text', text: `Timeout: text "${text}" did not appear within ${effectiveTimeout}ms` }] };
      }
      return { content: [{ type: 'text', text: `Found text "${text}" after ${result.elapsed}ms` }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Wait failed: ${err.message}` }], isError: true };
    }
  }
);

// ============================= React State =============================

// Tool: Get React component state
server.tool(
  'get_react_state',
  'Extract React component state by traversing the fiber tree from a DOM element. ' +
  'Returns component names, props, and state. Use to verify internal state after interactions.',
  {
    selector: z.string().describe('CSS selector of the DOM element rendered by the React component'),
    depth: z.coerce.number().optional().describe('How many parent fiber levels to traverse (default 5)'),
  },
  async ({ selector, depth }) => {
    try {
      const result = await sendCommand('dev:get-react-state', { selector, depth });
      if (!result.found) {
        return { content: [{ type: 'text', text: `No React fiber found for: ${selector}` }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result.components, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `React state failed: ${err.message}` }], isError: true };
    }
  }
);

// ============================= Health & Diagnostics =============================

// Tool: Health check
server.tool(
  'health_check',
  'Check if the Pixel City Electron app is alive and healthy. Returns: window state, ' +
  'renderer ready state, WebSocket connections, error count, memory usage, build status, uptime. ' +
  'Call this before starting work and after suspected crashes.',
  {},
  async () => {
    try {
      const result = await sendCommand('dev:health-check', {});
      const lines = [
        `Alive: ${result.alive}`,
        `Renderer: ${result.rendererReady}`,
        `WS Clients: ${result.wsClients}`,
        `Renderer Connected: ${result.rendererConnected}`,
        `Errors: ${result.errorCount}`,
        `Logs: ${result.logCount}`,
        `Uptime: ${Math.round(result.uptime)}s`,
        `Memory: ${result.memory.rss}MB RSS, ${result.memory.heapUsed}MB heap`,
        `Build: ${result.buildStatus.status}${result.buildStatus.lastHmrTimestamp ? ' (last HMR: ' + new Date(result.buildStatus.lastHmrTimestamp).toISOString().substring(11, 23) + ')' : ''}`,
      ];
      if (result.buildStatus.errors.length > 0) {
        lines.push(`Build Errors:`);
        for (const e of result.buildStatus.errors) {
          lines.push(`  ${e.file || 'unknown'}: ${e.message}`);
        }
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Health check failed (app may be down): ${err.message}` }], isError: true };
    }
  }
);

// Tool: Get aggregated errors
server.tool(
  'get_errors',
  'Get aggregated errors from the Electron renderer: uncaught exceptions, unhandled promise rejections. ' +
  'Each entry has type, message, stack trace, filename, line number, and timestamp. ' +
  'Check this first when something looks wrong.',
  {
    count: z.coerce.number().optional().describe('Number of recent errors to return (default 50)'),
    since: z.coerce.number().optional().describe('Only return errors after this Unix timestamp (ms)'),
  },
  async ({ count, since }) => {
    try {
      const result = await sendCommand('dev:get-errors', { count, since });
      if (!result.errors || result.errors.length === 0) {
        return { content: [{ type: 'text', text: 'No errors captured.' }] };
      }
      const formatted = result.errors.map((e: any) => {
        const time = new Date(e.timestamp).toISOString().substring(11, 23);
        const loc = e.filename ? ` at ${e.filename}:${e.lineno || '?'}` : '';
        return `[${time}] [${e.type}] ${e.message}${loc}${e.stack ? '\n  ' + e.stack.split('\n').slice(1, 3).join('\n  ') : ''}`;
      }).join('\n\n');
      return { content: [{ type: 'text', text: `${result.errors.length} errors (${result.total} total):\n\n${formatted}` }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Get errors failed: ${err.message}` }], isError: true };
    }
  }
);

// Tool: Build status
server.tool(
  'build_status',
  'Check the Vite HMR / build status. Returns: current status (idle/updating/error), ' +
  'last successful HMR timestamp, and any build errors with file paths. ' +
  'Call this after saving files to know when HMR is done and if there are compile errors.',
  {},
  async () => {
    try {
      const result = await sendCommand('dev:build-status', {});
      const lines = [
        `Status: ${result.status}`,
        result.lastHmrTimestamp
          ? `Last HMR: ${new Date(result.lastHmrTimestamp).toISOString().substring(11, 23)} (${Math.round((Date.now() - result.lastHmrTimestamp) / 1000)}s ago)`
          : 'Last HMR: none',
      ];
      if (result.errors.length > 0) {
        lines.push(`Errors:`);
        for (const e of result.errors) {
          lines.push(`  ${e.file || 'unknown'}: ${e.message}`);
        }
      }
      if (result.lastError) {
        lines.push(`Last Error: ${result.lastError}`);
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Build status failed: ${err.message}` }], isError: true };
    }
  }
);

// ============================= Office Canvas Tools =============================

// Tool: Get agents in the office
server.tool(
  'office_get_agents',
  'Get all agents/characters in the office canvas with their positions, state, and activity. ' +
  'Returns tile coordinates, animation state (idle/walk/type), active tool, status text, and whether they are subagents. ' +
  'The office sidebar must be open for this to work.',
  {},
  async () => {
    try {
      const result = await sendCommand('dev:office-get-agents', {});
      if (result.error) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true };
      }
      if (!result.agents || result.agents.length === 0) {
        return { content: [{ type: 'text', text: `No agents in the office. Selected: ${result.selectedAgentId ?? 'none'}` }] };
      }
      const lines = result.agents.map((a: any) =>
        `${a.name || a.id} — tile(${a.tileCol},${a.tileRow}) state=${a.state} active=${a.isActive} seat=${a.seatId ?? 'none'}${a.statusText ? ' status="' + a.statusText + '"' : ''}${a.hasPath ? ' walking(' + a.pathLength + ' tiles)' : ''}`
      );
      lines.unshift(`${result.agents.length} agent(s) — selected: ${result.selectedAgentId ?? 'none'}`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Failed: ${err.message}` }], isError: true };
    }
  }
);

// Tool: Select an agent on the office canvas
server.tool(
  'office_select_agent',
  'Select an agent on the office canvas by their ID. This is equivalent to clicking on the agent character. ' +
  'The selected agent will be highlighted and their terminal panel will open on the right. ' +
  'Use office_get_agents first to find available agent IDs.',
  {
    agentId: z.string().describe('The agent ID to select'),
  },
  async ({ agentId }) => {
    try {
      const result = await sendCommand('dev:office-select-agent', { agentId });
      if (result.error) {
        return { content: [{ type: 'text', text: `Error: ${result.error}${result.availableIds ? '\nAvailable IDs: ' + result.availableIds.join(', ') : ''}` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Selected agent "${result.name || result.agentId}" at tile(${result.tileCol},${result.tileRow})` }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Failed: ${err.message}` }], isError: true };
    }
  }
);

// Tool: Move an agent to a tile (triggers A* pathfinding)
server.tool(
  'office_move_agent',
  'Move an agent to a specific tile on the office canvas using A* pathfinding. ' +
  'The agent will walk along the computed path, navigating around furniture and walls. ' +
  'Returns whether a valid path was found and its length.',
  {
    agentId: z.string().describe('The agent ID to move'),
    col: z.coerce.number().describe('Target tile column'),
    row: z.coerce.number().describe('Target tile row'),
  },
  async ({ agentId, col, row }) => {
    try {
      const result = await sendCommand('dev:office-move-agent', { agentId, col, row });
      if (result.error) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true };
      }
      if (!result.moved) {
        return { content: [{ type: 'text', text: `Cannot move to tile(${col},${row}) — no valid path or tile is blocked` }] };
      }
      return { content: [{ type: 'text', text: `Moving agent from tile(${result.from.col},${result.from.row}) to tile(${col},${row}) — path: ${result.pathLength} tiles` }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Failed: ${err.message}` }], isError: true };
    }
  }
);

// Tool: Get full office state snapshot
server.tool(
  'office_get_state',
  'Get a full snapshot of the office state: selected agent, camera position, zoom level, layout size, ' +
  'seat assignments, furniture count, and character count. Use this to verify the overall office state.',
  {},
  async () => {
    try {
      const result = await sendCommand('dev:office-get-state', {});
      if (result.error) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true };
      }
      const lines = [
        `Selected: ${result.selectedAgentId ?? 'none'}`,
        `Camera Follow: ${result.cameraFollowId ?? 'none'}`,
        `Zoom: ${result.zoom}`,
        `Pan: (${result.pan.x}, ${result.pan.y})`,
        `Layout: ${result.layoutCols}x${result.layoutRows} tiles`,
        `Characters: ${result.characterCount}`,
        `Furniture: ${result.furnitureCount}`,
        `Seats: ${result.seatCount}`,
      ];
      if (result.seats.length > 0) {
        lines.push('Seat assignments:');
        for (const s of result.seats) {
          lines.push(`  ${s.id} — tile(${s.col},${s.row}) agent=${s.agentId ?? 'empty'}`);
        }
      }
      if (result.hoveredTile) {
        lines.push(`Hovered: tile(${result.hoveredTile.col},${result.hoveredTile.row})`);
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Failed: ${err.message}` }], isError: true };
    }
  }
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[pixel-city-dev-mcp] Dev MCP server started, waiting for commands...\n');
}

main().catch((err) => {
  process.stderr.write(`[pixel-city-dev-mcp] Fatal: ${err.message}\n`);
  process.exit(1);
});
