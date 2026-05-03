import { WebSocketServer, WebSocket } from 'ws';
import type { BrowserWindow, NativeImage } from 'electron';

const TEST_WS_PORT = 19842;

interface TestWsServerDeps {
  getMainWindow: () => BrowserWindow | null;
}

// --- Separate log buffer for test server ---
const MAX_LOG_BUFFER = 1000;
const logBuffer: { level: string; args: string; timestamp: number }[] = [];
let logCaptureInjected = false;
let wssInstance: WebSocketServer | null = null;

export function isTestServerEnabled(): boolean {
  const val = (process.env.ENABLE_TEST_MCP || '').toLowerCase().trim();
  return val === 'true' || val === '1';
}

async function injectTestLogCapture(win: BrowserWindow) {
  if (logCaptureInjected) return;
  logCaptureInjected = true;
  await win.webContents.executeJavaScript(`
    (function() {
      if (window.__testMcpLogCapture) return;
      window.__testMcpLogCapture = true;
      const orig = {};
      ['log', 'warn', 'error', 'info', 'debug'].forEach(level => {
        orig[level] = console[level];
        console[level] = function(...args) {
          orig[level].apply(console, args);
          try {
            const { ipcRenderer } = require('electron');
            ipcRenderer.send('__test-mcp-log', {
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

async function handleTestCommand(
  action: string,
  params: any,
  getMainWindow: () => BrowserWindow | null
): Promise<{ result?: any; error?: string }> {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) {
    return { error: 'Main window not available' };
  }

  switch (action) {
    // --- Screenshots ---
    case 'test:screenshot': {
      try {
        const image = await win.webContents.capturePage();
        const png = image.toPNG();
        return {
          result: {
            base64: png.toString('base64'),
            width: image.getSize().width,
            height: image.getSize().height,
          },
        };
      } catch (err: any) {
        return { error: `Screenshot failed: ${err.message}` };
      }
    }

    case 'test:screenshot-region': {
      try {
        const { x, y, width, height } = params;
        if (x == null || y == null || width == null || height == null) {
          return { error: 'Missing required params: x, y, width, height' };
        }
        const image = await win.webContents.capturePage({
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(width),
          height: Math.round(height),
        });
        const png = image.toPNG();
        return {
          result: {
            base64: png.toString('base64'),
            width: image.getSize().width,
            height: image.getSize().height,
          },
        };
      } catch (err: any) {
        return { error: `Region screenshot failed: ${err.message}` };
      }
    }

    // --- JS execution ---
    case 'test:execute-js': {
      try {
        const result = await win.webContents.executeJavaScript(params.code, true);
        return { result: { value: result !== undefined ? String(result) : 'undefined' } };
      } catch (err: any) {
        return { result: { error: err.message, stack: err.stack } };
      }
    }

    // --- Logging ---
    case 'test:get-logs': {
      await injectTestLogCapture(win);
      const count = params.count || 100;
      const level = params.level;
      const since = params.since; // optional timestamp filter
      let logs = [...logBuffer];
      if (level) logs = logs.filter(l => l.level === level);
      if (since) logs = logs.filter(l => l.timestamp >= since);
      if (params.pattern) {
        const re = new RegExp(params.pattern, 'i');
        logs = logs.filter(l => re.test(l.args));
      }
      return { result: { logs: logs.slice(-count), total: logBuffer.length } };
    }

    case 'test:clear-logs': {
      logBuffer.length = 0;
      return { result: { cleared: true } };
    }

    // --- Window info ---
    case 'test:get-window-info': {
      const bounds = win.getBounds();
      return {
        result: {
          bounds,
          url: win.webContents.getURL(),
          title: win.getTitle(),
          focused: win.isFocused(),
          visible: win.isVisible(),
          minimized: win.isMinimized(),
          maximized: win.isMaximized(),
          fullscreen: win.isFullScreen(),
          devToolsOpen: win.webContents.isDevToolsOpened(),
        },
      };
    }

    // --- DOM queries ---
    case 'test:query-dom': {
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
              id: el.id || undefined,
              className: el.className || undefined,
              textContent: el.textContent?.substring(0, 500),
              innerHTML: el.innerHTML?.substring(0, 1000),
              attributes: Array.from(el.attributes).reduce((acc, attr) => {
                acc[attr.name] = attr.value;
                return acc;
              }, {}),
              rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
              childCount: el.children.length,
              visible: rect.width > 0 && rect.height > 0,
            };
          })();
        `);
        return { result };
      } catch (err: any) {
        return { error: `DOM query failed: ${err.message}` };
      }
    }

    case 'test:list-dom': {
      try {
        const result = await win.webContents.executeJavaScript(`
          (function() {
            const selector = ${JSON.stringify(params.selector || '*')};
            const limit = ${params.limit || 50};
            const els = document.querySelectorAll(selector);
            return Array.from(els).slice(0, limit).map((el, i) => {
              const rect = el.getBoundingClientRect();
              return {
                index: i,
                tagName: el.tagName,
                id: el.id || undefined,
                className: el.className || undefined,
                textSnippet: el.textContent?.substring(0, 80)?.trim() || undefined,
                rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
                visible: rect.width > 0 && rect.height > 0,
              };
            });
          })();
        `);
        return { result: { elements: result, total: result.length } };
      } catch (err: any) {
        return { error: `DOM list failed: ${err.message}` };
      }
    }

    // --- Interactions ---
    case 'test:click-element': {
      try {
        const result = await win.webContents.executeJavaScript(`
          (function() {
            const selector = ${JSON.stringify(params.selector)};
            if (!selector) return { error: 'No selector provided' };
            const el = document.querySelector(selector);
            if (!el) return { found: false, error: 'Element not found: ' + selector };
            const rect = el.getBoundingClientRect();
            const opts = { bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
            el.dispatchEvent(new MouseEvent('mousedown', opts));
            el.dispatchEvent(new MouseEvent('mouseup', opts));
            el.dispatchEvent(new MouseEvent('click', opts));
            return { found: true, tagName: el.tagName, clicked: true };
          })();
        `);
        return { result };
      } catch (err: any) {
        return { error: `Click failed: ${err.message}` };
      }
    }

    case 'test:type-text': {
      try {
        const result = await win.webContents.executeJavaScript(`
          (function() {
            const selector = ${JSON.stringify(params.selector || '')};
            const text = ${JSON.stringify(params.text || '')};
            const clear = ${!!params.clear};
            let el = selector ? document.querySelector(selector) : document.activeElement;
            if (!el) return { error: 'No element found' };
            if (selector) el.focus();
            if (clear && ('value' in el)) el.value = '';
            if ('value' in el) {
              const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value'
              )?.set;
              if (nativeInputValueSetter) {
                nativeInputValueSetter.call(el, (clear ? '' : el.value) + text);
              } else {
                el.value = (clear ? '' : el.value) + text;
              }
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
              // contenteditable
              document.execCommand('insertText', false, text);
            }
            return { typed: true, tagName: el.tagName };
          })();
        `);
        return { result };
      } catch (err: any) {
        return { error: `Type failed: ${err.message}` };
      }
    }

    // --- React state ---
    case 'test:get-react-state': {
      try {
        const result = await win.webContents.executeJavaScript(`
          (function() {
            const selector = ${JSON.stringify(params.selector || '#root')};
            const el = document.querySelector(selector);
            if (!el) return { error: 'Element not found' };
            // Walk React fiber tree
            const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
            if (!fiberKey) return { error: 'No React fiber found on element' };
            const fiber = el[fiberKey];
            let current = fiber;
            const components = [];
            while (current && components.length < 10) {
              if (current.memoizedState || current.memoizedProps) {
                const name = current.type?.displayName || current.type?.name || 'Anonymous';
                const entry = { name };
                if (current.memoizedProps) {
                  try { entry.props = JSON.parse(JSON.stringify(current.memoizedProps, (k, v) => typeof v === 'function' ? '[Function]' : v)); }
                  catch { entry.props = '[unserializable]'; }
                }
                if (current.memoizedState) {
                  try { entry.state = JSON.parse(JSON.stringify(current.memoizedState, (k, v) => typeof v === 'function' ? '[Function]' : v)); }
                  catch { entry.state = '[unserializable]'; }
                }
                components.push(entry);
              }
              current = current.return;
            }
            return { components };
          })();
        `);
        return { result };
      } catch (err: any) {
        return { error: `React state extraction failed: ${err.message}` };
      }
    }

    // --- Performance & memory ---
    case 'test:get-performance': {
      try {
        const result = await win.webContents.executeJavaScript(`
          (function() {
            const nav = performance.getEntriesByType('navigation')[0];
            const paint = performance.getEntriesByType('paint');
            return {
              timing: nav ? {
                domContentLoaded: nav.domContentLoadedEventEnd,
                loadComplete: nav.loadEventEnd,
                domInteractive: nav.domInteractive,
                responseEnd: nav.responseEnd,
                duration: nav.duration,
              } : null,
              paint: paint.map(p => ({ name: p.name, startTime: p.startTime })),
              memory: performance.memory ? {
                usedJSHeapSize: performance.memory.usedJSHeapSize,
                totalJSHeapSize: performance.memory.totalJSHeapSize,
                jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
              } : null,
              now: performance.now(),
            };
          })();
        `);
        return { result };
      } catch (err: any) {
        return { error: `Performance metrics failed: ${err.message}` };
      }
    }

    case 'test:get-memory': {
      try {
        const processMemory = process.memoryUsage();
        const rendererMetrics = await win.webContents.executeJavaScript(`
          (function() {
            return {
              jsHeap: performance.memory ? {
                used: performance.memory.usedJSHeapSize,
                total: performance.memory.totalJSHeapSize,
                limit: performance.memory.jsHeapSizeLimit,
              } : null,
            };
          })();
        `);
        return {
          result: {
            main: {
              rss: processMemory.rss,
              heapUsed: processMemory.heapUsed,
              heapTotal: processMemory.heapTotal,
              external: processMemory.external,
            },
            renderer: rendererMetrics,
          },
        };
      } catch (err: any) {
        return { error: `Memory stats failed: ${err.message}` };
      }
    }

    // --- Waiting / polling ---
    case 'test:wait-for-selector': {
      const timeout = params.timeout || 5000;
      const interval = params.interval || 100;
      const selector = params.selector;
      if (!selector) return { error: 'No selector provided' };
      const start = Date.now();
      while (Date.now() - start < timeout) {
        try {
          const found = await win.webContents.executeJavaScript(`
            !!document.querySelector(${JSON.stringify(selector)})
          `);
          if (found) {
            return { result: { found: true, elapsed: Date.now() - start } };
          }
        } catch {
          // window may have been destroyed during polling
          return { error: 'Window destroyed during wait' };
        }
        await new Promise(r => setTimeout(r, interval));
      }
      return { result: { found: false, elapsed: Date.now() - start, timedOut: true } };
    }

    case 'test:wait-for-text': {
      const timeout = params.timeout || 5000;
      const interval = params.interval || 100;
      const text = params.text;
      const selector = params.selector || 'body';
      if (!text) return { error: 'No text provided' };
      const start = Date.now();
      while (Date.now() - start < timeout) {
        try {
          const found = await win.webContents.executeJavaScript(`
            (function() {
              const el = document.querySelector(${JSON.stringify(selector)});
              return el ? el.textContent.includes(${JSON.stringify(text)}) : false;
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

    // --- Accessibility ---
    case 'test:get-accessibility-tree': {
      try {
        const result = await win.webContents.executeJavaScript(`
          (function() {
            const rootSelector = ${JSON.stringify(params.selector || 'body')};
            const maxDepth = ${params.maxDepth || 5};
            const root = document.querySelector(rootSelector);
            if (!root) return { error: 'Root element not found' };
            function walk(el, depth) {
              if (depth > maxDepth) return null;
              const role = el.getAttribute('role') || el.tagName.toLowerCase();
              const label = el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title') || '';
              const text = el.children.length === 0 ? (el.textContent?.trim()?.substring(0, 100) || '') : '';
              const node = { role, label: label || undefined, text: text || undefined };
              const children = [];
              for (const child of el.children) {
                const c = walk(child, depth + 1);
                if (c) children.push(c);
              }
              if (children.length > 0) node.children = children;
              return node;
            }
            return walk(root, 0);
          })();
        `);
        return { result };
      } catch (err: any) {
        return { error: `Accessibility tree failed: ${err.message}` };
      }
    }

    // --- Computed styles ---
    case 'test:get-computed-styles': {
      try {
        const properties = params.properties || [
          'display', 'visibility', 'opacity', 'position',
          'width', 'height', 'color', 'backgroundColor',
          'fontSize', 'fontFamily', 'overflow',
        ];
        const result = await win.webContents.executeJavaScript(`
          (function() {
            const el = document.querySelector(${JSON.stringify(params.selector)});
            if (!el) return { error: 'Element not found' };
            const computed = getComputedStyle(el);
            const props = ${JSON.stringify(properties)};
            const styles = {};
            for (const p of props) {
              styles[p] = computed.getPropertyValue(p.replace(/([A-Z])/g, '-$1').toLowerCase()) || computed[p];
            }
            return { styles };
          })();
        `);
        return { result };
      } catch (err: any) {
        return { error: `Computed styles failed: ${err.message}` };
      }
    }

    // --- Custom event dispatch ---
    case 'test:dispatch-event': {
      try {
        const result = await win.webContents.executeJavaScript(`
          (function() {
            const el = document.querySelector(${JSON.stringify(params.selector)});
            if (!el) return { error: 'Element not found' };
            const eventType = ${JSON.stringify(params.eventType || 'click')};
            const detail = ${JSON.stringify(params.detail || null)};
            const bubbles = ${params.bubbles !== false};
            let event;
            if (detail !== null) {
              event = new CustomEvent(eventType, { bubbles, cancelable: true, detail });
            } else {
              event = new Event(eventType, { bubbles, cancelable: true });
            }
            const dispatched = el.dispatchEvent(event);
            return { dispatched, eventType };
          })();
        `);
        return { result };
      } catch (err: any) {
        return { error: `Dispatch event failed: ${err.message}` };
      }
    }

    // --- Network idle check ---
    case 'test:get-network-idle': {
      try {
        const result = await win.webContents.executeJavaScript(`
          (function() {
            const entries = performance.getEntriesByType('resource');
            const recent = entries.filter(e => e.responseEnd > performance.now() - 1000);
            const pending = entries.filter(e => e.responseEnd === 0);
            return {
              idle: pending.length === 0,
              recentRequests: recent.length,
              pendingRequests: pending.length,
              totalResources: entries.length,
            };
          })();
        `);
        return { result };
      } catch (err: any) {
        return { error: `Network idle check failed: ${err.message}` };
      }
    }

    // --- DevTools toggle ---
    case 'test:toggle-devtools': {
      try {
        if (win.webContents.isDevToolsOpened()) {
          win.webContents.closeDevTools();
          return { result: { devToolsOpen: false } };
        } else {
          win.webContents.openDevTools({ mode: params.mode || 'detach' });
          return { result: { devToolsOpen: true } };
        }
      } catch (err: any) {
        return { error: `Toggle devtools failed: ${err.message}` };
      }
    }

    // --- Reload ---
    case 'test:reload': {
      try {
        if (params.hard) {
          win.webContents.reloadIgnoringCache();
        } else {
          win.webContents.reload();
        }
        return { result: { reloaded: true, hard: !!params.hard } };
      } catch (err: any) {
        return { error: `Reload failed: ${err.message}` };
      }
    }

    // --- Navigate ---
    case 'test:navigate': {
      try {
        if (params.url) {
          await win.webContents.loadURL(params.url);
          return { result: { navigated: true, url: params.url } };
        } else if (params.route) {
          // Push route within SPA via renderer JS
          const result = await win.webContents.executeJavaScript(`
            (function() {
              if (window.__pixelCityNavigate) {
                window.__pixelCityNavigate(${JSON.stringify(params.route)});
                return { navigated: true, route: ${JSON.stringify(params.route)} };
              }
              // Fallback: try history.pushState + popstate
              history.pushState(null, '', ${JSON.stringify(params.route)});
              window.dispatchEvent(new PopStateEvent('popstate'));
              return { navigated: true, route: ${JSON.stringify(params.route)}, method: 'pushState' };
            })();
          `);
          return { result };
        }
        return { error: 'Provide either url or route param' };
      } catch (err: any) {
        return { error: `Navigate failed: ${err.message}` };
      }
    }

    // --- App-specific state queries ---
    case 'test:get-app-state': {
      try {
        const result = await win.webContents.executeJavaScript(`
          (function() {
            const root = document.getElementById('root');
            const fiberKey = root ? Object.keys(root).find(k => k.startsWith('__reactFiber$')) : null;
            // Try to find the main app state by reading context from React tree
            const state = {
              url: location.href,
              title: document.title,
              activeView: document.querySelector('.panel-tab.active')?.textContent || null,
              sidebarVisible: !!document.querySelector('#dm-sidebar-header'),
              officeVisible: !!document.querySelector('canvas'),
              agentCount: document.querySelectorAll('.dm-item').length,
              terminalVisible: !!document.querySelector('#terminal-area'),
              loginVisible: !!document.querySelector('.login-page'),
              errorBoundary: !!document.querySelector('.error-boundary'),
            };
            return state;
          })();
        `);
        return { result };
      } catch (err: any) {
        return { error: `App state query failed: ${err.message}` };
      }
    }

    case 'test:list-agents': {
      try {
        const result = await win.webContents.executeJavaScript(`
          (function() {
            const items = document.querySelectorAll('.dm-item');
            const agents = [];
            for (const item of items) {
              const nameEl = item.querySelector('.dm-item-name');
              const statusEl = item.querySelector('.dm-item-status');
              const isActive = item.classList.contains('active');
              agents.push({
                name: nameEl?.textContent?.trim() || 'Unknown',
                status: statusEl?.textContent?.trim() || null,
                active: isActive,
              });
            }
            return { agents, count: agents.length };
          })();
        `);
        return { result };
      } catch (err: any) {
        return { error: `List agents failed: ${err.message}` };
      }
    }

    case 'test:get-board-state': {
      try {
        const result = await win.webContents.executeJavaScript(`
          (function() {
            const columns = document.querySelectorAll('.board-column');
            const board = {};
            for (const col of columns) {
              const header = col.querySelector('.board-column-header');
              const colName = header?.textContent?.trim() || 'unknown';
              const cards = col.querySelectorAll('.board-card');
              board[colName] = [];
              for (const card of cards) {
                const title = card.querySelector('.board-card-title')?.textContent?.trim() || '';
                const assignee = card.querySelector('.board-card-assignee')?.textContent?.trim() || null;
                board[colName].push({ title, assignee });
              }
            }
            return { columns: board, columnCount: columns.length };
          })();
        `);
        return { result };
      } catch (err: any) {
        return { error: `Board state query failed: ${err.message}` };
      }
    }

    case 'test:get-office-state': {
      try {
        const result = await win.webContents.executeJavaScript(`
          (function() {
            // Access the office state from the module-level ref
            try {
              const stateModule = window.__pixelCityOfficeState;
              if (stateModule) {
                const os = stateModule;
                const characters = [];
                for (const [id, ch] of os.characters) {
                  characters.push({
                    id,
                    name: ch.name,
                    isActive: ch.isActive,
                    isPermanent: ch.isPermanent,
                    seatId: ch.seatId,
                    x: Math.round(ch.x),
                    y: Math.round(ch.y),
                    model: ch.model,
                    statusText: ch.statusText,
                  });
                }
                return {
                  characterCount: os.characters.size,
                  seatCount: os.seats.size,
                  selectedAgentId: os.selectedAgentId,
                  characters,
                };
              }
            } catch {}
            // Fallback: check if canvas exists
            const canvas = document.querySelector('canvas');
            return {
              canvasPresent: !!canvas,
              canvasSize: canvas ? { width: canvas.width, height: canvas.height } : null,
              note: 'Office state ref not exposed. Set window.__pixelCityOfficeState for full access.',
            };
          })();
        `);
        return { result };
      } catch (err: any) {
        return { error: `Office state query failed: ${err.message}` };
      }
    }

    // --- Performance profiling ---
    case 'test:profile-fps': {
      const durationMs = params.duration || 3000;
      try {
        const result = await win.webContents.executeJavaScript(`
          new Promise(resolve => {
            const frames = [];
            let rafId;
            const start = performance.now();
            function tick() {
              const now = performance.now();
              frames.push(now);
              if (now - start < ${durationMs}) {
                rafId = requestAnimationFrame(tick);
              } else {
                const durations = [];
                for (let i = 1; i < frames.length; i++) durations.push(frames[i] - frames[i - 1]);
                durations.sort((a, b) => a - b);
                const avg = durations.reduce((s, d) => s + d, 0) / durations.length;
                const fps = 1000 / avg;
                const p95 = durations[Math.floor(durations.length * 0.95)] || 0;
                const jank = durations.filter(d => d > 50).length; // frames > 50ms = jank
                resolve({
                  frameCount: frames.length,
                  durationMs: frames[frames.length - 1] - frames[0],
                  avgFps: Math.round(fps * 10) / 10,
                  avgFrameMs: Math.round(avg * 100) / 100,
                  p95FrameMs: Math.round(p95 * 100) / 100,
                  minFrameMs: Math.round(durations[0] * 100) / 100,
                  maxFrameMs: Math.round(durations[durations.length - 1] * 100) / 100,
                  jankFrames: jank,
                  jankPercent: Math.round(jank / durations.length * 1000) / 10,
                });
              }
            }
            rafId = requestAnimationFrame(tick);
          });
        `);
        return { result };
      } catch (err: any) {
        return { error: `FPS profiling failed: ${err.message}` };
      }
    }

    case 'test:profile-renders': {
      const durationMs = params.duration || 5000;
      try {
        const result = await win.webContents.executeJavaScript(`
          new Promise(resolve => {
            // Patch React's commit to count renders
            const root = document.getElementById('root');
            if (!root) { resolve({ error: 'No #root element' }); return; }
            const fiberKey = Object.keys(root).find(k => k.startsWith('__reactContainer$'));
            if (!fiberKey) { resolve({ error: 'No React container found' }); return; }

            let renderCount = 0;
            const componentRenders = {};

            // Use MutationObserver as a proxy for DOM mutations (caused by React renders)
            const observer = new MutationObserver(mutations => {
              renderCount += mutations.length;
              for (const m of mutations) {
                // Try to identify which component re-rendered
                const target = m.target;
                const fiber = Object.keys(target).find(k => k.startsWith('__reactFiber$'));
                if (fiber) {
                  let f = target[fiber];
                  while (f && !f.type?.name && !f.type?.displayName) f = f.return;
                  const name = f?.type?.displayName || f?.type?.name || 'Unknown';
                  componentRenders[name] = (componentRenders[name] || 0) + 1;
                }
              }
            });
            observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });

            setTimeout(() => {
              observer.disconnect();
              const sorted = Object.entries(componentRenders)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 20)
                .map(([name, count]) => ({ component: name, mutations: count }));
              resolve({
                totalMutations: renderCount,
                durationMs: ${durationMs},
                mutationsPerSecond: Math.round(renderCount / ${durationMs} * 1000 * 10) / 10,
                topComponents: sorted,
              });
            }, ${durationMs});
          });
        `);
        return { result };
      } catch (err: any) {
        return { error: `Render profiling failed: ${err.message}` };
      }
    }

    case 'test:detect-leaks': {
      try {
        const result = await win.webContents.executeJavaScript(`
          (function() {
            // Count DOM nodes
            const nodeCount = document.querySelectorAll('*').length;

            // Count event listeners (if getEventListeners available in devtools)
            // Fallback: count elements with inline handlers
            let inlineHandlers = 0;
            const allEls = document.querySelectorAll('*');
            const handlerAttrs = ['onclick', 'onmousedown', 'onmouseup', 'onkeydown', 'onkeyup', 'onchange', 'oninput'];
            for (const el of allEls) {
              for (const attr of handlerAttrs) {
                if (el[attr]) inlineHandlers++;
              }
            }

            // Check for detached DOM trees (nodes not in document)
            const iframes = document.querySelectorAll('iframe').length;
            const canvases = document.querySelectorAll('canvas').length;

            // Memory if available
            const memory = performance.memory ? {
              usedMB: Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10,
              totalMB: Math.round(performance.memory.totalJSHeapSize / 1048576 * 10) / 10,
              limitMB: Math.round(performance.memory.jsHeapSizeLimit / 1048576 * 10) / 10,
              usagePercent: Math.round(performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit * 1000) / 10,
            } : null;

            // Check for timers
            let timerEstimate = 'unknown';
            try {
              // Count setInterval/setTimeout by temporarily wrapping (snapshot)
              timerEstimate = 'Use test:execute_js to check specific timer patterns';
            } catch {}

            return {
              domNodeCount: nodeCount,
              inlineHandlerCount: inlineHandlers,
              iframeCount: iframes,
              canvasCount: canvases,
              memory,
              warnings: [
                ...(nodeCount > 10000 ? ['HIGH: DOM node count (' + nodeCount + ') exceeds 10,000 — potential DOM leak'] : []),
                ...(memory && memory.usagePercent > 80 ? ['HIGH: JS heap usage at ' + memory.usagePercent + '% — potential memory leak'] : []),
                ...(iframes > 10 ? ['MEDIUM: ' + iframes + ' iframes detected — check for cleanup'] : []),
              ],
            };
          })();
        `);
        return { result };
      } catch (err: any) {
        return { error: `Leak detection failed: ${err.message}` };
      }
    }

    case 'test:long-tasks': {
      const durationMs = params.duration || 5000;
      try {
        const result = await win.webContents.executeJavaScript(`
          new Promise(resolve => {
            const longTasks = [];
            const observer = new PerformanceObserver(list => {
              for (const entry of list.getEntries()) {
                longTasks.push({
                  name: entry.name,
                  startTime: Math.round(entry.startTime),
                  duration: Math.round(entry.duration),
                });
              }
            });
            try {
              observer.observe({ entryTypes: ['longtask'] });
            } catch {
              resolve({ error: 'PerformanceObserver longtask not supported' });
              return;
            }
            setTimeout(() => {
              observer.disconnect();
              resolve({
                longTasks,
                count: longTasks.length,
                durationMs: ${durationMs},
                totalBlockedMs: longTasks.reduce((s, t) => s + t.duration, 0),
                avgBlockedMs: longTasks.length > 0 ? Math.round(longTasks.reduce((s, t) => s + t.duration, 0) / longTasks.length) : 0,
                warnings: [
                  ...(longTasks.length > 10 ? ['HIGH: ' + longTasks.length + ' long tasks in ' + ${durationMs} + 'ms — UI likely janky'] : []),
                  ...(longTasks.some(t => t.duration > 200) ? ['HIGH: Tasks > 200ms detected — noticeable UI freeze'] : []),
                ],
              });
            }, ${durationMs});
          });
        `);
        return { result };
      } catch (err: any) {
        return { error: `Long task profiling failed: ${err.message}` };
      }
    }

    case 'test:layout-thrashing': {
      const durationMs = params.duration || 3000;
      try {
        const result = await win.webContents.executeJavaScript(`
          new Promise(resolve => {
            const entries = [];
            const observer = new PerformanceObserver(list => {
              for (const entry of list.getEntries()) {
                entries.push({
                  name: entry.name,
                  startTime: Math.round(entry.startTime * 100) / 100,
                  duration: Math.round(entry.duration * 100) / 100,
                });
              }
            });
            try {
              observer.observe({ entryTypes: ['layout-shift'] });
            } catch {}

            // Also watch for forced reflows by counting getBoundingClientRect calls
            let reflowCount = 0;
            const origGetBCR = Element.prototype.getBoundingClientRect;
            Element.prototype.getBoundingClientRect = function() {
              reflowCount++;
              return origGetBCR.call(this);
            };

            setTimeout(() => {
              observer.disconnect();
              Element.prototype.getBoundingClientRect = origGetBCR;
              const totalCLS = entries.reduce((s, e) => s + e.duration, 0);
              resolve({
                layoutShifts: entries.length,
                cumulativeLayoutShift: Math.round(totalCLS * 1000) / 1000,
                getBoundingClientRectCalls: reflowCount,
                durationMs: ${durationMs},
                reflowsPerSecond: Math.round(reflowCount / ${durationMs} * 1000 * 10) / 10,
                warnings: [
                  ...(reflowCount > 100 ? ['HIGH: ' + reflowCount + ' getBoundingClientRect calls in ' + ${durationMs} + 'ms — possible layout thrashing'] : []),
                  ...(entries.length > 5 ? ['MEDIUM: ' + entries.length + ' layout shifts detected'] : []),
                ],
              });
            }, ${durationMs});
          });
        `);
        return { result };
      } catch (err: any) {
        return { error: `Layout thrashing detection failed: ${err.message}` };
      }
    }

    default:
      return { error: `Unknown test action: ${action}` };
  }
}

export function startTestServer(deps: TestWsServerDeps) {
  if (!isTestServerEnabled()) {
    console.log('[Test WS] ENABLE_TEST_MCP not set, test server disabled');
    return;
  }

  if (wssInstance) {
    console.log('[Test WS] Server already running');
    return;
  }

  const wss = new WebSocketServer({ port: TEST_WS_PORT });
  wssInstance = wss;
  console.log(`[Test WS] Test WebSocket server listening on ws://localhost:${TEST_WS_PORT}`);

  // Listen for test log capture IPC messages from renderer
  const { ipcMain } = require('electron');
  ipcMain.on('__test-mcp-log', (_event: any, entry: any) => {
    logBuffer.push(entry);
    if (logBuffer.length > MAX_LOG_BUFFER) logBuffer.shift();
  });

  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log('[Test WS] Client connected');

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const { id, action, params } = msg;

        if (!action || typeof action !== 'string') {
          ws.send(JSON.stringify({ id, error: 'Missing or invalid action' }));
          return;
        }

        if (action.startsWith('test:')) {
          // Handle test commands directly in main process
          const response = await handleTestCommand(action, params || {}, deps.getMainWindow);
          try {
            ws.send(JSON.stringify({ id, ...response }));
          } catch { /* client disconnected */ }
        } else {
          // Forward non-test commands to renderer via the existing MCP bridge WS connection
          // Import the renderer WS reference from wsServer — we send via main window executeJS
          const win = deps.getMainWindow();
          if (!win || win.isDestroyed()) {
            ws.send(JSON.stringify({ id, error: 'Main window not available' }));
            return;
          }
          try {
            const result = await win.webContents.executeJavaScript(`
              (function() {
                return new Promise((resolve, reject) => {
                  const ws = window.__mcpRendererWs;
                  if (!ws || ws.readyState !== 1) {
                    reject(new Error('Renderer MCP bridge not connected'));
                    return;
                  }
                  const msgId = Math.random().toString(36).slice(2);
                  const handler = (evt) => {
                    try {
                      const data = JSON.parse(evt.data);
                      if (data.type === 'mcp-response' && data._forwardId === msgId) {
                        ws.removeEventListener('message', handler);
                        resolve(data.result || data.error || data);
                      }
                    } catch {}
                  };
                  ws.addEventListener('message', handler);
                  setTimeout(() => {
                    ws.removeEventListener('message', handler);
                    reject(new Error('Forward timeout'));
                  }, 30000);
                  ws.send(JSON.stringify({
                    type: 'mcp-command',
                    _forwardId: msgId,
                    action: ${JSON.stringify(action)},
                    params: ${JSON.stringify(params || {})},
                  }));
                });
              })();
            `);
            ws.send(JSON.stringify({ id, result }));
          } catch (err: any) {
            ws.send(JSON.stringify({ id, error: `Forward to renderer failed: ${err.message}` }));
          }
        }
      } catch (err: any) {
        try {
          ws.send(JSON.stringify({ error: 'Invalid JSON', details: err.message }));
        } catch { /* ignore */ }
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      console.log('[Test WS] Client disconnected');
    });

    ws.on('error', (err) => {
      console.error('[Test WS] Client error:', err.message);
      clients.delete(ws);
    });
  });

  wss.on('error', (err) => {
    console.error('[Test WS] Server error:', err.message);
  });

  // Cleanup function
  return () => {
    for (const ws of clients) {
      try { ws.close(); } catch { /* ignore */ }
    }
    clients.clear();
    wss.close();
    wssInstance = null;
    logBuffer.length = 0;
    logCaptureInjected = false;
    console.log('[Test WS] Server stopped');
  };
}
