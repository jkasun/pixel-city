import { WebSocketServer, WebSocket } from 'ws';
import { app } from 'electron';
import type { BrowserWindow } from 'electron';

const MCP_WS_PORT = app.isPackaged ? 19841 : 19840;

const externalClients = new Set<WebSocket>();
let rendererWs: WebSocket | null = null;

interface PendingRequest {
  externalWs: WebSocket;
  clientMsgId: any;
}

const pendingRequests = new Map<number, PendingRequest>();
let requestIdCounter = 0;

// --- Dev command log buffer ---
const MAX_LOG_BUFFER = 500;
const logBuffer: { level: string; args: string; timestamp: number }[] = [];
let logCaptureInjected = false;

// --- Error capture buffer ---
const MAX_ERROR_BUFFER = 200;
const errorBuffer: { type: string; message: string; filename?: string; lineno?: number; colno?: number; stack?: string; timestamp: number }[] = [];
let errorCaptureInjected = false;

// --- Build status tracking ---
const buildStatus: { lastHmrTimestamp: number; status: 'idle' | 'updating' | 'error'; errors: { file?: string; line?: number; message: string }[]; lastError?: string } = {
  lastHmrTimestamp: 0,
  status: 'idle',
  errors: [],
};
let buildStatusInjected = false;

function broadcastToExternal(msg: any) {
  const raw = JSON.stringify(msg);
  for (const ws of externalClients) {
    try { ws.send(raw); } catch { /* ignore */ }
  }
}

async function injectLogCapture(win: BrowserWindow) {
  if (logCaptureInjected) return;
  logCaptureInjected = true;
  // Inject console interceptor into renderer to capture logs via IPC
  await win.webContents.executeJavaScript(`
    (function() {
      if (window.__devMcpLogCapture) return;
      window.__devMcpLogCapture = true;
      const orig = {};
      ['log', 'warn', 'error', 'info', 'debug'].forEach(level => {
        orig[level] = console[level];
        console[level] = function(...args) {
          orig[level].apply(console, args);
          try {
            const { ipcRenderer } = require('electron');
            ipcRenderer.send('__dev-mcp-log', {
              level,
              args: args.map(a => {
                try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
                catch { return String(a); }
              }).join(' '),
              timestamp: Date.now()
            });
          } catch {}
        };
      });
    })();
  `);
}

async function injectErrorCapture(win: BrowserWindow) {
  if (errorCaptureInjected) return;
  errorCaptureInjected = true;
  await win.webContents.executeJavaScript(`
    (function() {
      if (window.__devMcpErrorCapture) return;
      window.__devMcpErrorCapture = true;
      const { ipcRenderer } = require('electron');
      window.addEventListener('error', (e) => {
        ipcRenderer.send('__dev-mcp-error', {
          type: 'uncaught',
          message: e.message,
          filename: e.filename,
          lineno: e.lineno,
          colno: e.colno,
          stack: e.error ? e.error.stack : undefined,
          timestamp: Date.now()
        });
      });
      window.addEventListener('unhandledrejection', (e) => {
        ipcRenderer.send('__dev-mcp-error', {
          type: 'unhandled-rejection',
          message: String(e.reason),
          stack: e.reason && e.reason.stack ? e.reason.stack : undefined,
          timestamp: Date.now()
        });
      });
    })();
  `);
}

async function injectBuildStatusCapture(win: BrowserWindow) {
  if (buildStatusInjected) return;
  buildStatusInjected = true;
  // import.meta is a syntax-level construct — it throws SyntaxError at parse time,
  // not runtime. We must use eval() to defer parsing so the error is catchable.
  await win.webContents.executeJavaScript(`
    (function() {
      if (window.__devMcpBuildStatus) return;
      window.__devMcpBuildStatus = true;
      var ipc = require('electron').ipcRenderer;
      try {
        eval(
          "if (import.meta.hot) {" +
          "  import.meta.hot.on('vite:beforeUpdate', function() {" +
          "    ipc.send('__dev-mcp-build', { event: 'updating', timestamp: Date.now() });" +
          "  });" +
          "  import.meta.hot.on('vite:afterUpdate', function() {" +
          "    ipc.send('__dev-mcp-build', { event: 'updated', timestamp: Date.now() });" +
          "  });" +
          "  import.meta.hot.on('vite:error', function(data) {" +
          "    ipc.send('__dev-mcp-build', {" +
          "      event: 'error'," +
          "      timestamp: Date.now()," +
          "      message: data.err ? data.err.message : 'Unknown build error'," +
          "      stack: data.err ? data.err.stack : undefined," +
          "      file: data.err ? data.err.id : undefined" +
          "    });" +
          "  });" +
          "}"
        );
      } catch (e) { /* import.meta not available outside Vite module context */ }
    })();
  `);
}

async function handleDevCommand(
  action: string,
  params: any,
  getMainWindow: () => BrowserWindow | null
): Promise<{ result?: any; error?: string }> {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) {
    return { error: 'Main window not available' };
  }

  switch (action) {
    case 'dev:execute-js': {
      try {
        const result = await win.webContents.executeJavaScript(params.code, true);
        return { result: { value: result !== undefined ? String(result) : 'undefined' } };
      } catch (err: any) {
        // Electron gives a generic message for syntax errors. Try to get more detail.
        let detail = err.message;
        if (detail.includes('Script failed to execute')) {
          try {
            // Use eval inside renderer to get the actual error message
            const evalResult = await win.webContents.executeJavaScript(`
              (function() {
                try { eval(${JSON.stringify(params.code)}); return null; }
                catch (e) { return { name: e.name, message: e.message }; }
              })();
            `, true);
            if (evalResult) detail = `${evalResult.name}: ${evalResult.message}`;
          } catch { /* keep original */ }
        }
        return { result: { error: detail, stack: err.stack } };
      }
    }

    case 'dev:get-logs': {
      await injectLogCapture(win);
      const count = params.count || 100;
      const level = params.level;
      const since = params.since;
      let logs = [...logBuffer];
      if (level) logs = logs.filter(l => l.level === level);
      if (since) logs = logs.filter(l => l.timestamp >= since);
      if (params.pattern) {
        try {
          const re = new RegExp(params.pattern, 'i');
          logs = logs.filter(l => re.test(l.args));
        } catch { /* invalid regex, skip filter */ }
      }
      if (params.clear) logBuffer.length = 0;
      return { result: { logs: logs.slice(-count), total: logBuffer.length } };
    }

    case 'dev:clear-logs': {
      logBuffer.length = 0;
      return { result: { cleared: true } };
    }

    case 'dev:screenshot': {
      try {
        const image = await win.webContents.capturePage();
        const png = image.toPNG();
        return { result: { base64: png.toString('base64'), width: image.getSize().width, height: image.getSize().height } };
      } catch (err: any) {
        return { error: `Screenshot failed: ${err.message}` };
      }
    }

    case 'dev:get-window-info': {
      const bounds = win.getBounds();
      const url = win.webContents.getURL();
      return {
        result: {
          bounds,
          url,
          title: win.getTitle(),
          focused: win.isFocused(),
          visible: win.isVisible(),
          devToolsOpen: win.webContents.isDevToolsOpened(),
        }
      };
    }

    case 'dev:query-dom': {
      try {
        const result = await win.webContents.executeJavaScript(`
          (function() {
            const selector = ${JSON.stringify(params.selector || 'body')};
            const el = document.querySelector(selector);
            if (!el) return { found: false };
            const rect = el.getBoundingClientRect();
            return {
              found: true,
              tagName: el.tagName,
              id: el.id,
              className: el.className,
              textContent: el.textContent?.substring(0, 500),
              innerHTML: el.innerHTML?.substring(0, 1000),
              rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
              childCount: el.children.length,
            };
          })();
        `);
        return { result };
      } catch (err: any) {
        return { error: `DOM query failed: ${err.message}` };
      }
    }

    case 'dev:browser-list-tabs': {
      try {
        const result = await win.webContents.executeJavaScript(`
          (function() {
            const tabs = window.__pixelCityBrowserTabs;
            if (!tabs || tabs.size === 0) return { tabs: [] };
            return {
              tabs: Array.from(tabs.entries()).map(([id, bridge]) => ({
                tabId: id,
                url: bridge.getUrl(),
                title: bridge.getTitle(),
                isLoading: bridge.isLoading(),
                canGoBack: bridge.canGoBack(),
                canGoForward: bridge.canGoForward(),
              })),
            };
          })();
        `);
        return { result };
      } catch (err: any) {
        return { error: `Browser list tabs failed: ${err.message}` };
      }
    }

    case 'dev:list-dom': {
      try {
        const result = await win.webContents.executeJavaScript(`
          (function() {
            const selector = ${JSON.stringify(params.selector || '*')};
            const limit = ${params.limit || 50};
            const els = document.querySelectorAll(selector);
            return Array.from(els).slice(0, limit).map(el => ({
              tagName: el.tagName,
              id: el.id || undefined,
              className: el.className || undefined,
              textSnippet: el.textContent?.substring(0, 80)?.trim() || undefined,
            }));
          })();
        `);
        return { result: { elements: result } };
      } catch (err: any) {
        return { error: `DOM list failed: ${err.message}` };
      }
    }

    // --- Click element ---
    case 'dev:click': {
      try {
        const result = await win.webContents.executeJavaScript(`
          (function() {
            const selector = ${JSON.stringify(params.selector)};
            if (!selector) return { error: 'No selector provided' };
            const el = document.querySelector(selector);
            if (!el) return { clicked: false, error: 'Element not found: ' + selector };
            el.scrollIntoView({ block: 'center', behavior: 'instant' });
            const rect = el.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const mods = ${JSON.stringify(params.modifiers || {})};
            const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, altKey: !!mods.alt, metaKey: !!mods.meta };
            el.dispatchEvent(new MouseEvent('mousedown', opts));
            el.dispatchEvent(new MouseEvent('mouseup', opts));
            el.dispatchEvent(new MouseEvent('click', opts));
            if (${!!params.doubleClick}) {
              el.dispatchEvent(new MouseEvent('dblclick', opts));
            }
            return { clicked: true, tag: el.tagName, id: el.id || undefined };
          })();
        `);
        return { result };
      } catch (err: any) {
        return { error: `Click failed: ${err.message}` };
      }
    }

    // --- Type into element ---
    case 'dev:type': {
      try {
        const result = await win.webContents.executeJavaScript(`
          (function() {
            const selector = ${JSON.stringify(params.selector || '')};
            const text = ${JSON.stringify(params.text || '')};
            const clear = ${!!params.clear};
            let el = selector ? document.querySelector(selector) : document.activeElement;
            if (!el) return { typed: false, error: 'No element found' };
            if (selector) el.focus();
            if (clear && ('value' in el)) el.value = '';
            if ('value' in el) {
              const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
              const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
              if (nativeSetter) {
                nativeSetter.call(el, (clear ? '' : el.value) + text);
              } else {
                el.value = (clear ? '' : el.value) + text;
              }
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
              document.execCommand('insertText', false, text);
            }
            if (${!!params.pressEnter}) {
              el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
              el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
            }
            return { typed: true, tag: el.tagName };
          })();
        `);
        return { result };
      } catch (err: any) {
        return { error: `Type failed: ${err.message}` };
      }
    }

    // --- Wait for selector ---
    case 'dev:wait-for-selector': {
      const timeout = params.timeout || 10000;
      const interval = params.interval || 200;
      const selector = params.selector;
      if (!selector) return { error: 'No selector provided' };
      const start = Date.now();
      while (Date.now() - start < timeout) {
        try {
          const found = await win.webContents.executeJavaScript(`
            (function() {
              const el = document.querySelector(${JSON.stringify(selector)});
              if (!el) return false;
              if (${!!params.visible}) {
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
              }
              return true;
            })();
          `);
          if (found) {
            const element = await win.webContents.executeJavaScript(`
              (function() {
                const el = document.querySelector(${JSON.stringify(selector)});
                const r = el.getBoundingClientRect();
                return { tag: el.tagName, id: el.id, className: el.className, rect: { top: r.top, left: r.left, width: r.width, height: r.height } };
              })();
            `);
            return { result: { found: true, elapsed: Date.now() - start, element } };
          }
        } catch {
          return { error: 'Window destroyed during wait' };
        }
        await new Promise(r => setTimeout(r, interval));
      }
      return { result: { found: false, elapsed: Date.now() - start, timedOut: true } };
    }

    // --- Wait for text ---
    case 'dev:wait-for-text': {
      const timeout = params.timeout || 10000;
      const interval = params.interval || 200;
      const text = params.text;
      const scope = params.selector || 'body';
      const useRegex = !!params.regex;
      if (!text) return { error: 'No text provided' };
      const start = Date.now();
      while (Date.now() - start < timeout) {
        try {
          const found = await win.webContents.executeJavaScript(`
            (function() {
              const el = document.querySelector(${JSON.stringify(scope)});
              if (!el) return false;
              const content = el.textContent || '';
              if (${useRegex}) {
                return new RegExp(${JSON.stringify(text)}).test(content);
              }
              return content.includes(${JSON.stringify(text)});
            })();
          `);
          if (found) {
            return { result: { found: true, elapsed: Date.now() - start } };
          }
        } catch {
          return { error: 'Window destroyed during wait' };
        }
        await new Promise(r => setTimeout(r, interval));
      }
      return { result: { found: false, elapsed: Date.now() - start, timedOut: true } };
    }

    // --- React state extraction ---
    case 'dev:get-react-state': {
      try {
        const result = await win.webContents.executeJavaScript(`
          (function() {
            var selector = ${JSON.stringify(params.selector || '#root')};
            var maxDepth = ${params.depth || 5};
            var el = document.querySelector(selector);
            if (!el) return { found: false, error: 'Element not found' };
            var fiberKey = Object.keys(el).find(function(k) { return k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'); });
            if (!fiberKey && el.firstElementChild) {
              el = el.firstElementChild;
              fiberKey = Object.keys(el).find(function(k) { return k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'); });
            }
            if (!fiberKey) return { found: false, error: 'No React fiber found on element or its first child' };

            // Safe serializer: handles circular refs, DOM nodes, depth limit
            function safeSerialize(obj, maxSerializeDepth) {
              var seen = new Set();
              return JSON.parse(JSON.stringify(obj, function(key, val) {
                if (typeof val === 'function') return '[Function]';
                if (val instanceof HTMLElement) return '[HTMLElement: ' + val.tagName + ']';
                if (val instanceof Node) return '[Node]';
                if (val && typeof val === 'object') {
                  if (seen.has(val)) return '[Circular]';
                  seen.add(val);
                  // Skip React fiber internal keys
                  if (key === 'queue' || key === 'baseQueue') return undefined;
                }
                return val;
              }));
            }

            // Extract meaningful hook values from memoizedState chain
            function extractHookValues(memoizedState) {
              var hooks = [];
              var node = memoizedState;
              var i = 0;
              while (node && i < 20) {
                if (node.memoizedState !== undefined && node.memoizedState !== null) {
                  var val = node.memoizedState;
                  // useState stores [value, dispatch] — grab just the value
                  if (Array.isArray(val) && val.length === 2 && typeof val[1] === 'function') {
                    val = val[0];
                  }
                  if (typeof val !== 'function') {
                    try {
                      hooks.push(safeSerialize(val));
                    } catch(e) {
                      hooks.push('[unserializable]');
                    }
                  }
                }
                node = node.next;
                i++;
              }
              return hooks.length > 0 ? hooks : undefined;
            }

            var current = el[fiberKey];
            var components = [];
            while (current && components.length < maxDepth) {
              if (current.memoizedState || current.memoizedProps) {
                var name = (current.type && (current.type.displayName || current.type.name)) || 'Anonymous';
                if (name === 'Anonymous') { current = current.return; continue; }
                var entry = { name: name };
                if (current.memoizedProps) {
                  try { entry.props = safeSerialize(current.memoizedProps); }
                  catch(e) { entry.props = '[unserializable]'; }
                }
                if (current.memoizedState) {
                  entry.hooks = extractHookValues(current.memoizedState);
                }
                components.push(entry);
              }
              current = current.return;
            }
            return { found: true, components: components };
          })();
        `);
        return { result };
      } catch (err: any) {
        return { error: `React state failed: ${err.message}` };
      }
    }

    // --- Health check ---
    case 'dev:health-check': {
      try {
        const readyState = await win.webContents.executeJavaScript('document.readyState');
        const memory = process.memoryUsage();
        return {
          result: {
            alive: true,
            rendererReady: readyState,
            wsClients: externalClients.size,
            rendererConnected: rendererWs !== null && rendererWs.readyState === WebSocket.OPEN,
            errorCount: errorBuffer.length,
            logCount: logBuffer.length,
            uptime: process.uptime(),
            memory: {
              rss: Math.round(memory.rss / 1024 / 1024),
              heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
              heapTotal: Math.round(memory.heapTotal / 1024 / 1024),
            },
            buildStatus: { ...buildStatus },
          },
        };
      } catch (err: any) {
        return { result: { alive: false, error: err.message } };
      }
    }

    // --- Get aggregated errors ---
    case 'dev:get-errors': {
      await injectErrorCapture(win);
      const count = params.count || 50;
      const since = params.since;
      let errors = [...errorBuffer];
      if (since) errors = errors.filter(e => e.timestamp >= since);
      return { result: { errors: errors.slice(-count), total: errorBuffer.length } };
    }

    // --- Clear error buffer ---
    case 'dev:clear-errors': {
      errorBuffer.length = 0;
      return { result: { cleared: true } };
    }

    // --- Build status ---
    case 'dev:build-status': {
      await injectBuildStatusCapture(win);
      return { result: { ...buildStatus } };
    }

    // --- Office: get agents/characters ---
    case 'dev:office-get-agents': {
      try {
        const result = await win.webContents.executeJavaScript(`
          (function() {
            var container = document.querySelector('[data-testid="office-canvas-container"]') || document.querySelector('.office-canvas-wrapper');
            if (!container) return { error: 'Office canvas not found — is the office view open?' };
            var fKey = Object.keys(container).find(function(k) { return k.indexOf('__reactFiber$') === 0; });
            if (!fKey) return { error: 'No React fiber on canvas container' };
            var cur = container[fKey];
            while (cur) {
              var n = cur.type && (cur.type.displayName || cur.type.name);
              if (n === 'OfficeCanvas') break;
              cur = cur.return;
            }
            if (!cur) return { error: 'OfficeCanvas component not found in fiber tree' };
            var state = cur.memoizedProps.officeState;
            if (!state) return { error: 'officeState prop not found' };
            var chars = state.characters;
            if (!chars || typeof chars.entries !== 'function') return { agents: [], selectedAgentId: state.selectedAgentId };
            var agents = [];
            var entries = Array.from(chars.entries());
            for (var i = 0; i < entries.length; i++) {
              var id = entries[i][0];
              var ch = entries[i][1];
              agents.push({
                id: id,
                name: ch.name || null,
                tileCol: ch.tileCol,
                tileRow: ch.tileRow,
                x: ch.x,
                y: ch.y,
                state: ch.state,
                dir: ch.dir,
                isActive: ch.isActive,
                seatId: ch.seatId,
                statusText: ch.statusText || null,
                currentTool: ch.currentTool || null,
                isSubagent: ch.isSubagent,
                parentAgentId: ch.parentAgentId || null,
                hasPath: ch.path && ch.path.length > 0,
                pathLength: ch.path ? ch.path.length : 0
              });
            }
            return { agents: agents, selectedAgentId: state.selectedAgentId, cameraFollowId: state.cameraFollowId };
          })();
        `);
        return { result };
      } catch (err: any) {
        return { error: `office-get-agents failed: ${err.message}` };
      }
    }

    // --- Office: select an agent ---
    case 'dev:office-select-agent': {
      try {
        const agentId = params.agentId;
        if (!agentId) return { error: 'agentId is required' };
        const result = await win.webContents.executeJavaScript(`
          (function() {
            var container = document.querySelector('[data-testid="office-canvas-container"]') || document.querySelector('.office-canvas-wrapper');
            if (!container) return { error: 'Office canvas not found' };
            var fKey = Object.keys(container).find(function(k) { return k.indexOf('__reactFiber$') === 0; });
            if (!fKey) return { error: 'No React fiber' };
            var cur = container[fKey];
            while (cur) {
              var n = cur.type && (cur.type.displayName || cur.type.name);
              if (n === 'OfficeCanvas') break;
              cur = cur.return;
            }
            if (!cur) return { error: 'OfficeCanvas not found' };
            var state = cur.memoizedProps.officeState;
            var onClick = cur.memoizedProps.onClick;
            var targetId = ${JSON.stringify(agentId)};
            var ch = state.characters.get(targetId);
            if (!ch) return { error: 'Agent not found: ' + targetId, availableIds: Array.from(state.characters.keys()) };
            // Directly set selection on officeState (same as click handler does)
            state.selectedAgentId = targetId;
            state.cameraFollowId = targetId;
            // Also call the onClick callback to notify parent components
            if (onClick) onClick(targetId);
            return { selected: true, agentId: targetId, name: ch.name || null, tileCol: ch.tileCol, tileRow: ch.tileRow };
          })();
        `);
        return { result };
      } catch (err: any) {
        return { error: `office-select-agent failed: ${err.message}` };
      }
    }

    // --- Office: move agent to tile (triggers pathfinding) ---
    case 'dev:office-move-agent': {
      try {
        const agentId = params.agentId;
        const col = params.col;
        const row = params.row;
        if (agentId === undefined || col === undefined || row === undefined) {
          return { error: 'agentId, col, and row are required' };
        }
        const result = await win.webContents.executeJavaScript(`
          (function() {
            var container = document.querySelector('[data-testid="office-canvas-container"]') || document.querySelector('.office-canvas-wrapper');
            if (!container) return { error: 'Office canvas not found' };
            var fKey = Object.keys(container).find(function(k) { return k.indexOf('__reactFiber$') === 0; });
            if (!fKey) return { error: 'No React fiber' };
            var cur = container[fKey];
            while (cur) {
              var n = cur.type && (cur.type.displayName || cur.type.name);
              if (n === 'OfficeCanvas') break;
              cur = cur.return;
            }
            if (!cur) return { error: 'OfficeCanvas not found' };
            var state = cur.memoizedProps.officeState;
            var targetId = ${JSON.stringify(agentId)};
            var ch = state.characters.get(targetId);
            if (!ch) return { error: 'Agent not found: ' + targetId };
            var targetCol = ${Number(col)};
            var targetRow = ${Number(row)};
            // Ensure agent is selected (required for walkToTile in some code paths)
            state.selectedAgentId = targetId;
            var walked = state.walkToTile(targetId, targetCol, targetRow);
            return {
              moved: walked,
              agentId: targetId,
              from: { col: ch.tileCol, row: ch.tileRow },
              to: { col: targetCol, row: targetRow },
              pathLength: ch.path ? ch.path.length : 0
            };
          })();
        `);
        return { result };
      } catch (err: any) {
        return { error: `office-move-agent failed: ${err.message}` };
      }
    }

    // --- Office: get full state snapshot ---
    case 'dev:office-get-state': {
      try {
        const result = await win.webContents.executeJavaScript(`
          (function() {
            var container = document.querySelector('[data-testid="office-canvas-container"]') || document.querySelector('.office-canvas-wrapper');
            if (!container) return { error: 'Office canvas not found — is the office view open?' };
            var fKey = Object.keys(container).find(function(k) { return k.indexOf('__reactFiber$') === 0; });
            if (!fKey) return { error: 'No React fiber' };
            var cur = container[fKey];
            var zoom = null;
            var panRef = null;
            while (cur) {
              var n = cur.type && (cur.type.displayName || cur.type.name);
              if (n === 'OfficeCanvas') {
                zoom = cur.memoizedProps.zoom;
                panRef = cur.memoizedProps.panRef;
                break;
              }
              cur = cur.return;
            }
            if (!cur) return { error: 'OfficeCanvas not found' };
            var state = cur.memoizedProps.officeState;
            var layout = state.layout || state.getLayout();
            var pan = panRef ? (panRef.current || panRef) : { x: 0, y: 0 };
            var seats = [];
            if (state.seats && typeof state.seats.entries === 'function') {
              var seatAgent = {};
              if (state.characters && typeof state.characters.forEach === 'function') {
                state.characters.forEach(function(ch, id) { if (ch.seatId) seatAgent[ch.seatId] = id; });
              }
              var sEntries = Array.from(state.seats.entries());
              for (var i = 0; i < sEntries.length; i++) {
                var sid = sEntries[i][0];
                var s = sEntries[i][1];
                var col = (s.seatCol !== undefined ? s.seatCol : s.col);
                var row = (s.seatRow !== undefined ? s.seatRow : s.row);
                seats.push({ id: sid, col: col, row: row, agentId: seatAgent[sid] || null });
              }
            }
            return {
              selectedAgentId: state.selectedAgentId,
              cameraFollowId: state.cameraFollowId,
              zoom: zoom,
              pan: { x: Math.round(pan.x), y: Math.round(pan.y) },
              layoutCols: layout ? layout.cols : null,
              layoutRows: layout ? layout.rows : null,
              characterCount: state.characters ? state.characters.size : 0,
              furnitureCount: state.furniture ? state.furniture.length : 0,
              seatCount: seats.length,
              seats: seats,
              hoveredAgentId: state.hoveredAgentId,
              hoveredTile: state.hoveredTile
            };
          })();
        `);
        return { result };
      } catch (err: any) {
        return { error: `office-get-state failed: ${err.message}` };
      }
    }

    default:
      return { error: `Unknown dev action: ${action}` };
  }
}

interface WsServerDeps {
  getMainWindow: () => BrowserWindow | null;
}

export function start(deps?: WsServerDeps) {
  const wss = new WebSocketServer({ port: MCP_WS_PORT });
  console.log(`[MCP Bridge] WebSocket server listening on ws://localhost:${MCP_WS_PORT}`);

  // Listen for log capture IPC messages from renderer
  if (deps?.getMainWindow) {
    const { ipcMain } = require('electron');
    ipcMain.on('__dev-mcp-log', (_event: any, entry: any) => {
      logBuffer.push(entry);
      if (logBuffer.length > MAX_LOG_BUFFER) logBuffer.shift();
    });
    ipcMain.on('__dev-mcp-error', (_event: any, entry: any) => {
      errorBuffer.push(entry);
      if (errorBuffer.length > MAX_ERROR_BUFFER) errorBuffer.shift();
    });
    ipcMain.on('__dev-mcp-build', (_event: any, data: any) => {
      if (data.event === 'updating') {
        buildStatus.status = 'updating';
      } else if (data.event === 'updated') {
        buildStatus.status = 'idle';
        buildStatus.lastHmrTimestamp = data.timestamp;
        buildStatus.errors = [];
        buildStatus.lastError = undefined;
      } else if (data.event === 'error') {
        buildStatus.status = 'error';
        buildStatus.lastError = data.message;
        buildStatus.errors.push({ file: data.file, message: data.message });
        // Keep only last 20 build errors
        if (buildStatus.errors.length > 20) buildStatus.errors.shift();
      }
    });
  }

  wss.on('connection', (ws) => {
    let clientType: 'unknown' | 'renderer' | 'external' = 'unknown';

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (clientType === 'unknown') {
          if (msg.type === 'renderer-connect') {
            clientType = 'renderer';
            rendererWs = ws;
            console.log('[MCP Bridge] Renderer connected via WebSocket');
            // Auto-inject log capture, error capture, and build status when renderer connects
            if (deps?.getMainWindow) {
              const win = deps.getMainWindow();
              if (win) {
                injectLogCapture(win).catch(() => {});
                injectErrorCapture(win).catch(() => {});
                injectBuildStatusCapture(win).catch(() => {});
              }
            }
            return;
          } else {
            clientType = 'external';
            externalClients.add(ws);
          }
        }

        if (clientType === 'renderer') {
          if (msg.type === 'mcp-response') {
            const pending = pendingRequests.get(msg.requestId);
            if (!pending) return;
            pendingRequests.delete(msg.requestId);
            const response: any = { id: pending.clientMsgId };
            if (msg.error) response.error = msg.error;
            else response.result = msg.result;
            try { pending.externalWs.send(JSON.stringify(response)); } catch { /* client may have disconnected */ }
          } else if (msg.type === 'office-event') {
            const { type: _, ...payload } = msg;
            broadcastToExternal({ type: 'event', ...payload });
          }
        } else {
          const { id, action, params } = msg;

          // --- Dev commands: handle directly in main process ---
          if (typeof action === 'string' && action.startsWith('dev:') && deps?.getMainWindow) {
            const response = await handleDevCommand(action, params || {}, deps.getMainWindow);
            try { ws.send(JSON.stringify({ id, ...response })); } catch { /* ignore */ }
            return;
          }

          if (!rendererWs || rendererWs.readyState !== WebSocket.OPEN) {
            ws.send(JSON.stringify({ id, error: 'Pixel City window not available' }));
            return;
          }

          const requestId = requestIdCounter++;
          pendingRequests.set(requestId, { externalWs: ws, clientMsgId: id });

          rendererWs.send(JSON.stringify({
            type: 'mcp-command',
            requestId,
            action,
            params: params || {},
          }));
        }
      } catch (err: any) {
        try { ws.send(JSON.stringify({ error: 'Invalid JSON', details: err.message })); } catch { /* ignore */ }
      }
    });

    ws.on('close', () => {
      if (clientType === 'renderer') {
        rendererWs = null;
        logCaptureInjected = false;
        errorCaptureInjected = false;
        buildStatusInjected = false;
        console.log('[MCP Bridge] Renderer disconnected');
      } else {
        externalClients.delete(ws);
        for (const [reqId, pending] of pendingRequests) {
          if (pending.externalWs === ws) pendingRequests.delete(reqId);
        }
        console.log('[MCP Bridge] External client disconnected');
      }
    });
  });

  wss.on('error', (err) => {
    console.error('[MCP Bridge] WebSocket server error:', err.message);
  });
}
