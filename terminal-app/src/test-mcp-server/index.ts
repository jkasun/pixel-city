#!/usr/bin/env node
/**
 * Test MCP Server for Pixel City
 *
 * End-to-end testing MCP server for the Pixel City Electron app.
 * Connects to a dedicated test WebSocket server and provides comprehensive
 * tools for automated UI testing: screenshots, DOM inspection, interactions,
 * JS execution, log capture, waiting/polling, performance metrics, and
 * app-specific state queries.
 *
 * Usage: node dist/electron/test-mcp-server/index.js
 * Env:   PIXEL_CITY_TEST_WS_URL (default: ws://localhost:19842)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import WebSocket from 'ws';

// ---------------------------------------------------------------------------
// WebSocket connection to Pixel City test harness
// ---------------------------------------------------------------------------

const WS_URL = process.env.PIXEL_CITY_TEST_WS_URL || 'ws://localhost:19842';
const REQUEST_TIMEOUT = 15_000;
const SCREENSHOT_TIMEOUT = 30_000;
const WAIT_TIMEOUT = 30_000;
const CONNECT_TIMEOUT = 5_000;

let ws: WebSocket | null = null;
let msgIdCounter = 0;
const pendingRequests = new Map<
  number,
  { resolve: (v: any) => void; reject: (e: Error) => void }
>();

function ensureConnected(): Promise<WebSocket> {
  if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve(ws);
  if (ws) {
    try { ws.close(); } catch { /* ignore */ }
    ws = null;
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`WebSocket connect timeout (${WS_URL})`));
      try { socket.close(); } catch { /* ignore */ }
    }, CONNECT_TIMEOUT);

    const socket = new WebSocket(WS_URL);

    socket.on('open', () => {
      clearTimeout(timer);
      ws = socket;
      resolve(socket);
    });

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
      for (const [id, p] of pendingRequests) {
        p.reject(new Error('WebSocket closed'));
        pendingRequests.delete(id);
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function sendCommand(
  action: string,
  params: Record<string, any> = {},
  timeout = REQUEST_TIMEOUT,
): Promise<any> {
  const socket = await ensureConnected();
  const id = msgIdCounter++;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Timeout waiting for ${action} (${timeout}ms)`));
    }, timeout);

    pendingRequests.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });

    socket.send(JSON.stringify({ id, action, params }));
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wrap a tool handler with standard error handling. */
function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function fail(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true as const };
}

function json(data: unknown) {
  return ok(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer(
  { name: 'pixel-city-test', version: '1.0.0' },
);

// ============================= Screenshots & Visual =============================

server.tool(
  'test_screenshot',
  'Capture a full-window screenshot of the Pixel City Electron app. ' +
  'Returns a base64-encoded PNG image. Use this for visual regression testing ' +
  'or to understand the current visual state of the UI.',
  {},
  async () => {
    try {
      const result = await sendCommand('test:screenshot', {}, SCREENSHOT_TIMEOUT);
      return {
        content: [
          { type: 'image' as const, data: result.base64, mimeType: 'image/png' as const },
          { type: 'text' as const, text: `Screenshot captured: ${result.width}x${result.height}` },
        ],
      };
    } catch (err: any) {
      return fail(`Screenshot failed: ${err.message}`);
    }
  },
);

server.tool(
  'test_screenshot_region',
  'Capture a screenshot of a specific rectangular region of the app window. ' +
  'Useful for focusing on a particular UI area without capturing the entire window.',
  {
    x: z.number().describe('Left offset in pixels from the window origin'),
    y: z.number().describe('Top offset in pixels from the window origin'),
    width: z.number().describe('Width of the region in pixels'),
    height: z.number().describe('Height of the region in pixels'),
  },
  async ({ x, y, width, height }) => {
    try {
      const result = await sendCommand(
        'test:screenshot-region',
        { x, y, width, height },
        SCREENSHOT_TIMEOUT,
      );
      return {
        content: [
          { type: 'image' as const, data: result.base64, mimeType: 'image/png' as const },
          { type: 'text' as const, text: `Region screenshot: ${width}x${height} at (${x},${y})` },
        ],
      };
    } catch (err: any) {
      return fail(`Region screenshot failed: ${err.message}`);
    }
  },
);

server.tool(
  'test_screenshot_element',
  'Capture a full-window screenshot and also return the bounding rectangle of a ' +
  'specific DOM element. Combines screenshot + DOM query so you can visually verify ' +
  'an element in a single call. Returns both the image and the element bounds.',
  {
    selector: z.string().describe('CSS selector of the element to locate in the screenshot'),
  },
  async ({ selector }) => {
    try {
      const result = await sendCommand(
        'test:screenshot-element',
        { selector },
        SCREENSHOT_TIMEOUT,
      );
      const parts: any[] = [
        { type: 'image', data: result.base64, mimeType: 'image/png' },
      ];
      if (result.element) {
        parts.push({
          type: 'text',
          text: `Element "${selector}" bounds: ${JSON.stringify(result.element.rect)}\n` +
                `Screenshot: ${result.width}x${result.height}`,
        });
      } else {
        parts.push({
          type: 'text',
          text: `Element "${selector}" not found. Screenshot: ${result.width}x${result.height}`,
        });
      }
      return { content: parts };
    } catch (err: any) {
      return fail(`Element screenshot failed: ${err.message}`);
    }
  },
);

// ============================= DOM Inspection =============================

server.tool(
  'test_query_dom',
  'Query a single DOM element by CSS selector. Returns tag name, id, className, ' +
  'text content, bounding rect, attributes, child count, and visibility state. ' +
  'Returns null fields if the element is not found.',
  {
    selector: z.string().describe('CSS selector (e.g. "#app", ".panel", "[data-testid=login]")'),
  },
  async ({ selector }) => {
    try {
      const result = await sendCommand('test:query-dom', { selector });
      if (!result.found) {
        return ok(`No element found for selector: ${selector}`);
      }
      return json(result);
    } catch (err: any) {
      return fail(`DOM query failed: ${err.message}`);
    }
  },
);

server.tool(
  'test_list_dom',
  'List all DOM elements matching a CSS selector. Returns an array of element summaries ' +
  '(tag, id, className, textSnippet, rect). Useful for enumerating lists, buttons, etc.',
  {
    selector: z.string().describe('CSS selector to match'),
    limit: z.number().optional().default(50).describe('Max number of elements to return (default 50)'),
  },
  async ({ selector, limit }) => {
    try {
      const result = await sendCommand('test:list-dom', { selector, limit });
      return json(result.elements ?? []);
    } catch (err: any) {
      return fail(`DOM list failed: ${err.message}`);
    }
  },
);

server.tool(
  'test_get_text',
  'Get the text content of one or more elements matching a CSS selector. ' +
  'Returns an array of { selector, index, text } objects. Useful for asserting ' +
  'visible text without needing the full DOM structure.',
  {
    selector: z.string().describe('CSS selector to match'),
    limit: z.number().optional().default(20).describe('Max elements to read text from (default 20)'),
  },
  async ({ selector, limit }) => {
    try {
      const result = await sendCommand('test:get-text', { selector, limit });
      return json(result.texts ?? []);
    } catch (err: any) {
      return fail(`Get text failed: ${err.message}`);
    }
  },
);

server.tool(
  'test_get_computed_styles',
  'Get computed CSS styles for an element. Returns a map of property names to values. ' +
  'Specify which properties you need to avoid an overwhelming response.',
  {
    selector: z.string().describe('CSS selector for the target element'),
    properties: z.array(z.string()).describe(
      'List of CSS property names to retrieve (e.g. ["color", "display", "opacity"])',
    ),
  },
  async ({ selector, properties }) => {
    try {
      const result = await sendCommand('test:get-computed-styles', { selector, properties });
      if (!result.found) {
        return ok(`Element not found: ${selector}`);
      }
      return json(result.styles);
    } catch (err: any) {
      return fail(`Computed styles failed: ${err.message}`);
    }
  },
);

server.tool(
  'test_get_accessibility_tree',
  'Get a snapshot of the accessibility tree starting from a root element. ' +
  'Returns a tree of { role, name, children, properties } nodes. Useful for ' +
  'verifying that the app is accessible and for finding elements by ARIA role.',
  {
    selector: z.string().optional().default('body').describe('Root element selector (default "body")'),
    depth: z.number().optional().default(5).describe('Max tree depth to traverse (default 5)'),
  },
  async ({ selector, depth }) => {
    try {
      const result = await sendCommand('test:get-accessibility-tree', { selector, depth });
      return json(result.tree);
    } catch (err: any) {
      return fail(`Accessibility tree failed: ${err.message}`);
    }
  },
);

// ============================= Interactions =============================

server.tool(
  'test_click',
  'Click a DOM element identified by CSS selector. Scrolls the element into view ' +
  'first if needed. Returns success/failure and the element that was clicked.',
  {
    selector: z.string().describe('CSS selector of the element to click'),
    button: z.enum(['left', 'right', 'middle']).optional().default('left').describe('Mouse button (default "left")'),
    doubleClick: z.boolean().optional().default(false).describe('Perform a double-click (default false)'),
    modifiers: z.object({
      ctrl: z.boolean().optional(),
      shift: z.boolean().optional(),
      alt: z.boolean().optional(),
      meta: z.boolean().optional(),
    }).optional().describe('Keyboard modifiers to hold during click'),
  },
  async ({ selector, button, doubleClick, modifiers }) => {
    try {
      const result = await sendCommand('test:click', { selector, button, doubleClick, modifiers });
      if (!result.clicked) {
        return ok(`Element not found or not clickable: ${selector}`);
      }
      return ok(`Clicked "${selector}" (${result.tag}${result.id ? '#' + result.id : ''})`);
    } catch (err: any) {
      return fail(`Click failed: ${err.message}`);
    }
  },
);

server.tool(
  'test_type',
  'Type text into a focused or selected input/textarea element. Optionally clear ' +
  'the field first. Simulates real keypress events.',
  {
    selector: z.string().describe('CSS selector of the input element'),
    text: z.string().describe('Text to type into the element'),
    clear: z.boolean().optional().default(false).describe('Clear the field before typing (default false)'),
    pressEnter: z.boolean().optional().default(false).describe('Press Enter after typing (default false)'),
    delay: z.number().optional().default(0).describe('Delay in ms between keystrokes (default 0 = instant)'),
  },
  async ({ selector, text, clear, pressEnter, delay }) => {
    try {
      const result = await sendCommand('test:type', { selector, text, clear, pressEnter, delay });
      if (!result.typed) {
        return ok(`Element not found or not typeable: ${selector}`);
      }
      return ok(`Typed ${text.length} chars into "${selector}"${pressEnter ? ' + Enter' : ''}`);
    } catch (err: any) {
      return fail(`Type failed: ${err.message}`);
    }
  },
);

server.tool(
  'test_dispatch_event',
  'Dispatch a custom DOM event on an element. Useful for triggering non-standard ' +
  'interactions like drag events, custom app events, or React synthetic events.',
  {
    selector: z.string().describe('CSS selector of the target element'),
    event: z.string().describe('Event type (e.g. "click", "input", "custom:myevent")'),
    detail: z.record(z.string(), z.any()).optional().describe('Event detail/payload object (for CustomEvent)'),
    bubbles: z.boolean().optional().default(true).describe('Whether the event bubbles (default true)'),
  },
  async ({ selector, event, detail, bubbles }) => {
    try {
      const result = await sendCommand('test:dispatch-event', { selector, event, detail, bubbles });
      if (!result.dispatched) {
        return ok(`Element not found: ${selector}`);
      }
      return ok(`Dispatched "${event}" on "${selector}"`);
    } catch (err: any) {
      return fail(`Dispatch event failed: ${err.message}`);
    }
  },
);

server.tool(
  'test_navigate',
  'Navigate the app to a specific route or view. This triggers the app\'s internal ' +
  'routing, not a page load. Use for switching between views (e.g. board, office, files).',
  {
    route: z.string().describe('Route or view name to navigate to (e.g. "/board", "/office", "/files")'),
  },
  async ({ route }) => {
    try {
      const result = await sendCommand('test:navigate', { route });
      return ok(`Navigated to "${route}" (success: ${result.success})`);
    } catch (err: any) {
      return fail(`Navigation failed: ${err.message}`);
    }
  },
);

// ============================= JavaScript Execution =============================

server.tool(
  'test_execute_js',
  'Execute arbitrary JavaScript in the Electron renderer process. Has full access to ' +
  'the DOM, window, React internals, Node.js APIs, and Electron APIs. The code is ' +
  'evaluated with await support (top-level await works). Returns the stringified result.',
  {
    code: z.string().describe('JavaScript code to execute in the renderer'),
  },
  async ({ code }) => {
    try {
      const result = await sendCommand('test:execute-js', { code });
      if (result.error) {
        return ok(`Error: ${result.error}\n${result.stack || ''}`);
      }
      return ok(result.value ?? 'undefined');
    } catch (err: any) {
      return fail(`JS execution failed: ${err.message}`);
    }
  },
);

server.tool(
  'test_get_react_state',
  'Extract React component state by traversing the React fiber tree from a given DOM ' +
  'element. Returns the component name, props, state, and hooks data. Useful for ' +
  'asserting internal component state without relying solely on DOM output.',
  {
    selector: z.string().describe('CSS selector of the DOM element rendered by the React component'),
    depth: z.number().optional().default(1).describe('How many parent fiber levels to traverse (default 1)'),
  },
  async ({ selector, depth }) => {
    try {
      const result = await sendCommand('test:get-react-state', { selector, depth });
      if (!result.found) {
        return ok(`No React fiber found for element: ${selector}`);
      }
      return json(result.components);
    } catch (err: any) {
      return fail(`React state extraction failed: ${err.message}`);
    }
  },
);

// ============================= Logs & Debugging =============================

server.tool(
  'test_get_logs',
  'Retrieve captured console logs from the renderer process. Logs are buffered ' +
  'in-memory (up to 1000 entries). Filter by level or pattern to find specific messages.',
  {
    count: z.number().optional().default(100).describe('Number of recent entries to return (default 100)'),
    level: z.enum(['log', 'warn', 'error', 'info', 'debug']).optional().describe('Filter by log level'),
    pattern: z.string().optional().describe('Regex pattern to filter log messages'),
    since: z.number().optional().describe('Only return logs after this Unix timestamp (ms)'),
  },
  async ({ count, level, pattern, since }) => {
    try {
      const result = await sendCommand('test:get-logs', { count, level, pattern, since });
      if (!result.logs || result.logs.length === 0) {
        return ok('No matching logs found.');
      }
      const formatted = result.logs.map((l: any) => {
        const time = new Date(l.timestamp).toISOString().substring(11, 23);
        return `[${time}] [${l.level.toUpperCase().padEnd(5)}] ${l.args}`;
      }).join('\n');
      return ok(`${result.logs.length} log entries:\n\n${formatted}`);
    } catch (err: any) {
      return fail(`Get logs failed: ${err.message}`);
    }
  },
);

server.tool(
  'test_clear_logs',
  'Clear the in-memory console log buffer. Use before a test scenario to get a ' +
  'clean baseline for log assertions.',
  {},
  async () => {
    try {
      await sendCommand('test:clear-logs');
      return ok('Log buffer cleared.');
    } catch (err: any) {
      return fail(`Clear logs failed: ${err.message}`);
    }
  },
);

server.tool(
  'test_get_window_info',
  'Get metadata about the Electron window: bounds (x, y, width, height), title, URL, ' +
  'focus state, visibility, fullscreen, devtools open/closed, and display info.',
  {},
  async () => {
    try {
      const result = await sendCommand('test:get-window-info');
      return json(result);
    } catch (err: any) {
      return fail(`Get window info failed: ${err.message}`);
    }
  },
);

server.tool(
  'test_toggle_devtools',
  'Open or close the Chromium DevTools for the Electron renderer window. ' +
  'Useful for debugging test failures interactively.',
  {
    open: z.boolean().optional().describe('true to open, false to close. Omit to toggle.'),
  },
  async ({ open }) => {
    try {
      const result = await sendCommand('test:toggle-devtools', { open });
      return ok(`DevTools ${result.isOpen ? 'opened' : 'closed'}.`);
    } catch (err: any) {
      return fail(`Toggle devtools failed: ${err.message}`);
    }
  },
);

// ============================= Waiting / Polling =============================

server.tool(
  'test_wait_for_selector',
  'Wait for a DOM element matching a CSS selector to appear in the document. ' +
  'Polls at a configurable interval until the element is found or timeout is reached. ' +
  'Returns the element info once found. Essential for testing async UI updates.',
  {
    selector: z.string().describe('CSS selector to wait for'),
    timeout: z.number().optional().default(10000).describe('Max wait time in ms (default 10000)'),
    interval: z.number().optional().default(200).describe('Polling interval in ms (default 200)'),
    visible: z.boolean().optional().default(false).describe('If true, wait for element to also be visible (default false)'),
  },
  async ({ selector, timeout, interval, visible }) => {
    try {
      const result = await sendCommand(
        'test:wait-for-selector',
        { selector, timeout, interval, visible },
        Math.max(WAIT_TIMEOUT, (timeout ?? 10000) + 5000),
      );
      if (!result.found) {
        return ok(`Timeout: element "${selector}" did not appear within ${timeout}ms`);
      }
      return json({ found: true, elapsed: result.elapsed, element: result.element });
    } catch (err: any) {
      return fail(`Wait for selector failed: ${err.message}`);
    }
  },
);

server.tool(
  'test_wait_for_text',
  'Wait for specific text to appear anywhere in the DOM (or within a scoped selector). ' +
  'Useful for asserting that async operations complete and render expected text.',
  {
    text: z.string().describe('Text string or regex pattern to wait for'),
    selector: z.string().optional().default('body').describe('Scope the search to this selector (default "body")'),
    timeout: z.number().optional().default(10000).describe('Max wait time in ms (default 10000)'),
    interval: z.number().optional().default(200).describe('Polling interval in ms (default 200)'),
    regex: z.boolean().optional().default(false).describe('Treat text as a regex pattern (default false)'),
  },
  async ({ text, selector, timeout, interval, regex }) => {
    try {
      const result = await sendCommand(
        'test:wait-for-text',
        { text, selector, timeout, interval, regex },
        Math.max(WAIT_TIMEOUT, (timeout ?? 10000) + 5000),
      );
      if (!result.found) {
        return ok(`Timeout: text "${text}" did not appear within ${timeout}ms`);
      }
      return json({ found: true, elapsed: result.elapsed, matchedIn: result.matchedIn });
    } catch (err: any) {
      return fail(`Wait for text failed: ${err.message}`);
    }
  },
);

// ============================= Performance & Health =============================

server.tool(
  'test_get_performance',
  'Get performance timing metrics from the renderer: navigation timing, paint timing, ' +
  'resource loading stats, long tasks, and frame rate info.',
  {
    metrics: z.array(z.string()).optional().describe(
      'Specific metric categories to include (e.g. ["navigation", "paint", "resources"]). ' +
      'Omit for all metrics.',
    ),
  },
  async ({ metrics }) => {
    try {
      const result = await sendCommand('test:get-performance', { metrics });
      return json(result);
    } catch (err: any) {
      return fail(`Get performance failed: ${err.message}`);
    }
  },
);

server.tool(
  'test_get_memory',
  'Get memory usage information for the Electron renderer process. Returns JS heap size, ' +
  'total heap, used heap, and external memory. Useful for detecting memory leaks.',
  {},
  async () => {
    try {
      const result = await sendCommand('test:get-memory');
      return json(result);
    } catch (err: any) {
      return fail(`Get memory failed: ${err.message}`);
    }
  },
);

server.tool(
  'test_check_health',
  'Run a comprehensive health check on the app: verifies the window is visible, the ' +
  'renderer has loaded, there are no uncaught errors in the console, the React root is ' +
  'mounted, and the WebSocket bridge is connected. Returns a pass/fail status for each check.',
  {},
  async () => {
    try {
      const result = await sendCommand('test:check-health');
      const checks = result.checks ?? {};
      const allPassed = Object.values(checks).every((v) => v === true || (v as any)?.pass === true);
      const summary = Object.entries(checks)
        .map(([k, v]) => {
          const passed = v === true || (v as any)?.pass === true;
          const detail = typeof v === 'object' && v !== null && 'detail' in (v as any)
            ? ` (${(v as any).detail})`
            : '';
          return `  ${passed ? 'PASS' : 'FAIL'} ${k}${detail}`;
        })
        .join('\n');
      return ok(`Health check: ${allPassed ? 'ALL PASSED' : 'SOME FAILED'}\n\n${summary}`);
    } catch (err: any) {
      return fail(`Health check failed: ${err.message}`);
    }
  },
);

server.tool(
  'test_reload',
  'Reload the Electron renderer (equivalent to Cmd+R / Ctrl+R). Use to reset the app ' +
  'to a clean state between test scenarios. Optionally wait for the app to finish loading.',
  {
    waitForLoad: z.boolean().optional().default(true).describe('Wait for the app to finish loading after reload (default true)'),
    timeout: z.number().optional().default(15000).describe('Max time to wait for reload completion in ms (default 15000)'),
  },
  async ({ waitForLoad, timeout }) => {
    try {
      const result = await sendCommand(
        'test:reload',
        { waitForLoad, timeout },
        Math.max(REQUEST_TIMEOUT, (timeout ?? 15000) + 5000),
      );
      return ok(`App reloaded.${result.loadTime ? ` Load time: ${result.loadTime}ms` : ''}`);
    } catch (err: any) {
      return fail(`Reload failed: ${err.message}`);
    }
  },
);

// ============================= App-Specific Testing =============================

server.tool(
  'test_get_app_state',
  'Get high-level application state: current view/route, active agent, selected building, ' +
  'sidebar state, modal state, and user info. This is a convenience wrapper around JS ' +
  'execution that extracts common app state from React context and global stores.',
  {},
  async () => {
    try {
      const result = await sendCommand('test:get-app-state');
      return json(result);
    } catch (err: any) {
      return fail(`Get app state failed: ${err.message}`);
    }
  },
);

server.tool(
  'test_list_agents',
  'List all agents currently visible in the Pixel City UI. Returns agent id, name, ' +
  'status (idle/working/error), current task, and position. Queries both the DOM and ' +
  'the internal agent store for a complete picture.',
  {},
  async () => {
    try {
      const result = await sendCommand('test:list-agents');
      if (!result.agents || result.agents.length === 0) {
        return ok('No agents found in the UI.');
      }
      return json(result.agents);
    } catch (err: any) {
      return fail(`List agents failed: ${err.message}`);
    }
  },
);

server.tool(
  'test_get_board_state',
  'Get the current state of the task board: columns, tasks in each column, task titles, ' +
  'assignees, labels, and subtask counts. Useful for verifying task management operations.',
  {},
  async () => {
    try {
      const result = await sendCommand('test:get-board-state');
      return json(result);
    } catch (err: any) {
      return fail(`Get board state failed: ${err.message}`);
    }
  },
);

server.tool(
  'test_get_office_state',
  'Get the current state of the virtual office: characters present, their positions, ' +
  'seat assignments, room layout, and activity status. Useful for verifying office ' +
  'simulation state.',
  {},
  async () => {
    try {
      const result = await sendCommand('test:get-office-state');
      return json(result);
    } catch (err: any) {
      return fail(`Get office state failed: ${err.message}`);
    }
  },
);

// ---------------------------------------------------------------------------
// Performance Profiling
// ---------------------------------------------------------------------------

server.tool(
  'test_profile_fps',
  'Measure the actual frame rate (FPS) of the Pixel City renderer over a duration. ' +
  'Reports avg/min/max/p95 frame times, jank frames (>50ms), and FPS. ' +
  'Use this to detect rendering performance issues, dropped frames, and animation jank.',
  {
    duration: z.number().optional().describe('Measurement duration in ms (default 3000)'),
  },
  async ({ duration }) => {
    try {
      const result = await sendCommand('test:profile-fps', { duration: duration || 3000 }, WAIT_TIMEOUT);
      const lines = [
        `FPS Profile (${result.durationMs}ms, ${result.frameCount} frames)`,
        `  Avg FPS: ${result.avgFps}`,
        `  Avg frame: ${result.avgFrameMs}ms`,
        `  P95 frame: ${result.p95FrameMs}ms`,
        `  Min frame: ${result.minFrameMs}ms`,
        `  Max frame: ${result.maxFrameMs}ms`,
        `  Jank frames (>50ms): ${result.jankFrames} (${result.jankPercent}%)`,
      ];
      if (result.jankPercent > 5) lines.push(`\n⚠️ WARNING: ${result.jankPercent}% jank — UI is likely stuttering`);
      if (result.avgFps < 30) lines.push(`\n⚠️ WARNING: Avg FPS ${result.avgFps} is below 30 — poor performance`);
      return ok(lines.join('\n'));
    } catch (err: any) {
      return fail(`FPS profiling failed: ${err.message}`);
    }
  },
);

server.tool(
  'test_profile_renders',
  'Monitor React re-render frequency using a MutationObserver. Tracks which components ' +
  'cause the most DOM mutations over a period. Use this to find components that re-render ' +
  'too often and identify unnecessary render cycles.',
  {
    duration: z.number().optional().describe('Measurement duration in ms (default 5000)'),
  },
  async ({ duration }) => {
    try {
      const result = await sendCommand('test:profile-renders', { duration: duration || 5000 }, WAIT_TIMEOUT);
      if (result.error) return fail(result.error);
      const lines = [
        `Render Profile (${result.durationMs}ms)`,
        `  Total DOM mutations: ${result.totalMutations}`,
        `  Mutations/second: ${result.mutationsPerSecond}`,
        '',
        'Top components by mutation count:',
        ...result.topComponents.map((c: any, i: number) =>
          `  ${i + 1}. ${c.component}: ${c.mutations} mutations`
        ),
      ];
      if (result.mutationsPerSecond > 100) lines.push(`\n⚠️ WARNING: ${result.mutationsPerSecond} mutations/sec is excessive — likely unnecessary re-renders`);
      return ok(lines.join('\n'));
    } catch (err: any) {
      return fail(`Render profiling failed: ${err.message}`);
    }
  },
);

server.tool(
  'test_detect_leaks',
  'Detect potential memory and DOM leaks. Checks DOM node count, inline event handlers, ' +
  'iframe count, canvas count, and JS heap usage. Reports warnings for high counts.',
  {},
  async () => {
    try {
      const result = await sendCommand('test:detect-leaks');
      const lines = [
        'Leak Detection Report',
        `  DOM nodes: ${result.domNodeCount}`,
        `  Inline handlers: ${result.inlineHandlerCount}`,
        `  Iframes: ${result.iframeCount}`,
        `  Canvases: ${result.canvasCount}`,
      ];
      if (result.memory) {
        lines.push(`  JS Heap: ${result.memory.usedMB}MB / ${result.memory.totalMB}MB (${result.memory.usagePercent}%)`);
      }
      if (result.warnings.length > 0) {
        lines.push('', 'Warnings:');
        for (const w of result.warnings) lines.push(`  ⚠️ ${w}`);
      } else {
        lines.push('', '✓ No leak indicators detected');
      }
      return ok(lines.join('\n'));
    } catch (err: any) {
      return fail(`Leak detection failed: ${err.message}`);
    }
  },
);

server.tool(
  'test_long_tasks',
  'Detect long tasks (>50ms) that block the main thread using PerformanceObserver. ' +
  'Reports count, total blocked time, and warnings. Use this to find JavaScript that ' +
  'causes UI freezes and input lag.',
  {
    duration: z.number().optional().describe('Observation duration in ms (default 5000)'),
  },
  async ({ duration }) => {
    try {
      const result = await sendCommand('test:long-tasks', { duration: duration || 5000 }, WAIT_TIMEOUT);
      if (result.error) return fail(result.error);
      const lines = [
        `Long Tasks Report (${result.durationMs}ms)`,
        `  Long tasks detected: ${result.count}`,
        `  Total blocked time: ${result.totalBlockedMs}ms`,
        `  Avg blocked time: ${result.avgBlockedMs}ms`,
      ];
      if (result.longTasks.length > 0) {
        lines.push('', 'Tasks:');
        for (const t of result.longTasks.slice(0, 10)) {
          lines.push(`  - ${t.name || 'unknown'}: ${t.duration}ms at ${t.startTime}ms`);
        }
      }
      if (result.warnings.length > 0) {
        lines.push('');
        for (const w of result.warnings) lines.push(`  ⚠️ ${w}`);
      } else {
        lines.push('', '✓ No problematic long tasks detected');
      }
      return ok(lines.join('\n'));
    } catch (err: any) {
      return fail(`Long task detection failed: ${err.message}`);
    }
  },
);

server.tool(
  'test_layout_thrashing',
  'Detect layout thrashing by monitoring getBoundingClientRect calls and layout shifts. ' +
  'High reflow counts indicate forced synchronous layouts that cause jank. ' +
  'Use this to find code that repeatedly reads layout then writes to DOM.',
  {
    duration: z.number().optional().describe('Observation duration in ms (default 3000)'),
  },
  async ({ duration }) => {
    try {
      const result = await sendCommand('test:layout-thrashing', { duration: duration || 3000 }, WAIT_TIMEOUT);
      if (result.error) return fail(result.error);
      const lines = [
        `Layout Thrashing Report (${result.durationMs}ms)`,
        `  Layout shifts: ${result.layoutShifts}`,
        `  CLS score: ${result.cumulativeLayoutShift}`,
        `  getBoundingClientRect calls: ${result.getBoundingClientRectCalls}`,
        `  Reflows/second: ${result.reflowsPerSecond}`,
      ];
      if (result.warnings.length > 0) {
        lines.push('');
        for (const w of result.warnings) lines.push(`  ⚠️ ${w}`);
      } else {
        lines.push('', '✓ No layout thrashing detected');
      }
      return ok(lines.join('\n'));
    } catch (err: any) {
      return fail(`Layout thrashing detection failed: ${err.message}`);
    }
  },
);

server.tool(
  'test_full_perf_audit',
  'Run a comprehensive performance audit combining FPS measurement, render profiling, ' +
  'leak detection, long task monitoring, and layout thrashing detection. ' +
  'Returns a unified report with all findings and warnings. Use this as a one-shot ' +
  'health check for the entire application.',
  {},
  async () => {
    try {
      const results: string[] = ['=== Pixel City Performance Audit ===', ''];

      // 1. FPS
      try {
        const fps = await sendCommand('test:profile-fps', { duration: 2000 }, WAIT_TIMEOUT);
        results.push(`📊 FPS: ${fps.avgFps} avg, ${fps.p95FrameMs}ms p95, ${fps.jankFrames} jank frames (${fps.jankPercent}%)`);
        if (fps.avgFps < 30) results.push('  ⚠️ Low FPS — below 30');
        if (fps.jankPercent > 5) results.push('  ⚠️ High jank rate');
      } catch { results.push('📊 FPS: measurement failed'); }

      // 2. Memory
      try {
        const mem = await sendCommand('test:get-memory', {});
        const rendererHeap = mem.renderer?.jsHeap;
        if (rendererHeap) {
          const usedMB = Math.round(rendererHeap.used / 1048576);
          const totalMB = Math.round(rendererHeap.total / 1048576);
          results.push(`💾 Memory: ${usedMB}MB / ${totalMB}MB renderer heap`);
          if (rendererHeap.used / rendererHeap.limit > 0.8) results.push('  ⚠️ Heap usage > 80%');
        }
        results.push(`  Main process: ${Math.round(mem.main.rss / 1048576)}MB RSS`);
      } catch { results.push('💾 Memory: measurement failed'); }

      // 3. DOM leaks
      try {
        const leaks = await sendCommand('test:detect-leaks', {});
        results.push(`🌳 DOM: ${leaks.domNodeCount} nodes, ${leaks.iframeCount} iframes, ${leaks.canvasCount} canvases`);
        for (const w of leaks.warnings) results.push(`  ⚠️ ${w}`);
      } catch { results.push('🌳 DOM: check failed'); }

      // 4. Long tasks
      try {
        const lt = await sendCommand('test:long-tasks', { duration: 2000 }, WAIT_TIMEOUT);
        results.push(`⏱️ Long tasks: ${lt.count} detected, ${lt.totalBlockedMs}ms total blocked`);
        for (const w of (lt.warnings || [])) results.push(`  ⚠️ ${w}`);
      } catch { results.push('⏱️ Long tasks: measurement failed'); }

      // 5. Layout thrashing
      try {
        const lt = await sendCommand('test:layout-thrashing', { duration: 2000 }, WAIT_TIMEOUT);
        results.push(`📐 Layout: ${lt.getBoundingClientRectCalls} reflows, ${lt.reflowsPerSecond}/sec, CLS ${lt.cumulativeLayoutShift}`);
        for (const w of (lt.warnings || [])) results.push(`  ⚠️ ${w}`);
      } catch { results.push('📐 Layout: measurement failed'); }

      // 6. Console errors
      try {
        const logs = await sendCommand('test:get-logs', { level: 'error', count: 10 });
        if (logs.logs.length > 0) {
          results.push(`🔴 Console errors: ${logs.logs.length} recent`);
          for (const l of logs.logs.slice(0, 3)) {
            results.push(`  - ${l.args.substring(0, 120)}`);
          }
        } else {
          results.push('🟢 Console errors: none');
        }
      } catch { results.push('🔴 Console: check failed'); }

      results.push('', '=== End Audit ===');
      return ok(results.join('\n'));
    } catch (err: any) {
      return fail(`Full audit failed: ${err.message}`);
    }
  },
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[pixel-city-test] Test MCP server started (${WS_URL}), waiting for commands...\n`);
}

main().catch((err) => {
  process.stderr.write(`[pixel-city-test] Fatal: ${err.message}\n`);
  process.exit(1);
});
