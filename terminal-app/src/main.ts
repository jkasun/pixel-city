import { app, BrowserWindow, ipcMain, Menu, screen, shell, session } from 'electron';
import path from 'path';
import os from 'os';
import fs from 'fs';
import http from 'http';

// --- Load .env file for ENABLE_TEST_MCP and other dev settings ---
try {
  // __dirname is dist/electron/ in dev, so go up two levels to reach terminal-app/
  const envPath = path.join(__dirname, '..', '..', '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
} catch { /* .env loading is best-effort */ }

// --- IPC Handler modules ---
import { register as registerDialogs } from './ipcHandlers/dialogHandlers';
import { register as registerPty } from './ipcHandlers/ptyManager';
import { register as registerLayouts } from './ipcHandlers/layoutHandlers';
import { register as registerBoard } from './ipcHandlers/boardHandlers';
import { register as registerConfig } from './ipcHandlers/configHandlers';
import { register as registerEmployees } from './ipcHandlers/employeeHandlers';
import { register as registerUsage } from './ipcHandlers/usageHandlers';
import { register as registerTts } from './ipcHandlers/ttsHandler';
import { register as registerDynamicPlugins } from './ipcHandlers/dynamicPluginHandlers';
import { register as registerMessages } from './ipcHandlers/messageStore';
import { register as registerCanvasFile } from './ipcHandlers/canvasFileHandlers';
import { start as startWsServer } from './ipcHandlers/wsServer';
import { startTestServer, isTestServerEnabled } from './ipcHandlers/testWsServer';
import { startPubSubWsServer, stopPubSubWsServer } from './ipcHandlers/pubsubWsServer';
import { getResolvedEnv } from './ipcHandlers/shellEnv';
import { registerLogIpc, pruneOldLogs, writeLogLine } from './main/logger';
import { installMcpInstance, teardownMcpInstance } from './main/mcpInstance';

// --- Resolve the user's shell environment early (VS Code-style) ---
getResolvedEnv();

// --- GPU stability for webview guests ---
// Prevent SIGSEGV (exit 11) crashes in webview renderer processes on macOS.
// The GPU sandbox in Electron 28 can cause segfaults with WebGL/3D content.
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer');

// Chromium 120 (Electron 28) window occlusion detection crashes GPU process
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// Prevent GPU watchdog from killing GPU process on heavy 3D/media content
app.commandLine.appendSwitch('disable-gpu-watchdog');

// Prevent renderer throttling that causes stale GPU state on tab switch
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// Increase GPU memory budget to prevent premature resource eviction
app.commandLine.appendSwitch('force-gpu-mem-available-mb', '1024');

// Don't give up on GPU after repeated crashes (fallback is worse)
app.commandLine.appendSwitch('disable-gpu-process-crash-limit');

// Prevent Chromium from auto-blocking WebGL after GPU crashes
app.disableDomainBlockingFor3DAPIs();

// --- Browser user agent (must be set before any window is created) ---
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
app.userAgentFallback = BROWSER_USER_AGENT;

// --- Window state persistence ---

let mainWindow: BrowserWindow | null = null;
const windowStatePath = path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState(): Electron.Rectangle | null {
  try {
    return JSON.parse(fs.readFileSync(windowStatePath, 'utf8'));
  } catch {
    return null;
  }
}

function saveWindowState(win: BrowserWindow) {
  if (win.isMinimized() || win.isMaximized()) return;
  fs.writeFileSync(windowStatePath, JSON.stringify(win.getBounds()), 'utf8');
}

function isWithinDisplayBounds(bounds: Electron.Rectangle): boolean {
  return screen.getAllDisplays().some((display) => {
    const { x, y, width, height } = display.workArea;
    return (
      bounds.x < x + width &&
      bounds.x + bounds.width > x &&
      bounds.y < y + height &&
      bounds.y + bounds.height > y
    );
  });
}

// --- Main window ---

// App version used in observability log entries. Mirrors the value emitted at
// app-startup in whenReady(); kept as a module-level constant so crash-recovery
// handlers and the startup marker stay in sync.
const APP_VERSION = '1.2.1';

function logEntry(level: 'info' | 'warn' | 'error' | 'fatal', compartment: string, extra: object) {
  writeLogLine({
    ts: new Date().toISOString(),
    level,
    compartment,
    appVersion: APP_VERSION,
    electron: process.versions.electron,
    platform: process.platform + '-' + process.arch,
    ...extra,
  });
}

function createWindow() {
  const saved = loadWindowState();
  const isDev = !!process.env.VITE_DEV_SERVER_URL;
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1400,
    height: 700,
    minWidth: 800,
    minHeight: 400,
    title: 'Pixel City - Virtual Office',
    titleBarStyle: 'default',
    backgroundColor: '#0a0a0c',
    show: !isDev,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
    },
  };

  if (saved && isWithinDisplayBounds(saved)) {
    windowOptions.x = saved.x;
    windowOptions.y = saved.y;
    windowOptions.width = saved.width;
    windowOptions.height = saved.height;
  }

  mainWindow = new BrowserWindow(windowOptions);

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // In dev mode, show the window without stealing focus or switching macOS spaces
  if (isDev) {
    mainWindow.once('ready-to-show', () => {
      mainWindow?.showInactive();
    });
  }

  mainWindow.on('close', () => saveWindowState(mainWindow!));
  mainWindow.on('closed', () => { mainWindow = null; });

  // --- Crash-recovery handlers for the main renderer ---
  // Auto-reload on renderer death so a crash doesn't leave a black window.
  // Local logging only — no remote crash reporter or dump uploader.
  const win = mainWindow;
  let unresponsiveTimer: NodeJS.Timeout | null = null;

  win.webContents.on('render-process-gone', (_e, details) => {
    logEntry('fatal', 'renderer-process', { reason: details.reason, exitCode: details.exitCode });
    if (details.reason !== 'clean-exit' && !win.isDestroyed()) {
      win.reload();
      if (details.reason === 'oom') {
        // TODO(step-8): the 'pixelcity:toast' event is forward-compatible; the
        // renderer doesn't consume it yet. Step 8 will surface a UI for it.
        win.webContents.once('did-finish-load', () => {
          win.webContents.executeJavaScript(
            `window.dispatchEvent(new CustomEvent('pixelcity:toast', { detail: { kind: 'warn', message: 'Window restarted due to memory pressure.' } }))`
          ).catch(() => {});
        });
      }
    }
  });

  win.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    // Skip the benign -3 (ABORTED) that fires on devtools open etc.
    if (errorCode === -3) return;
    logEntry('error', 'main-window', { errorCode, errorDescription, validatedURL });
  });

  win.webContents.on('unresponsive', () => {
    logEntry('warn', 'main-window', { event: 'unresponsive' });
    if (unresponsiveTimer) return;
    unresponsiveTimer = setTimeout(() => {
      if (!win.isDestroyed() && win.webContents.isCrashed?.() === false) {
        // Heuristic: Electron doesn't expose a definitive isUnresponsive,
        // so reload only as a last resort if the window is still alive.
        logEntry('error', 'main-window', { event: 'unresponsive-still', action: 'reload' });
        try { win.reload(); } catch { /* ignore */ }
      }
      unresponsiveTimer = null;
    }, 8000);
  });

  win.webContents.on('responsive', () => {
    if (unresponsiveTimer) { clearTimeout(unresponsiveTimer); unresponsiveTimer = null; }
    logEntry('info', 'main-window', { event: 'responsive' });
  });

  // Inject preload script into all webview guests for stealth patches.
  // This runs BEFORE any page scripts, unlike dom-ready injection.
  const webviewPreloadPath = path.join(__dirname, 'webview-preload.js');
  mainWindow.webContents.on('will-attach-webview', (_event, webPreferences, _params) => {
    // Ensure our stealth preload runs in the page's JS world (not isolated)
    webPreferences.preload = webviewPreloadPath;
    webPreferences.contextIsolation = false;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    // Allow the preload to use require('electron') for ipcRenderer
    webPreferences.sandbox = false;
  });
}

// --- Auth callback server ---
// Temporary local HTTP server to receive OAuth credentials from system browser

let authServer: http.Server | null = null;

function startAuthServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    authServer = http.createServer((req, res) => {
      // CORS headers for the home page to POST to us
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === 'POST' && req.url === '/auth-callback') {
        let body = '';
        req.on('data', (chunk: string) => { body += chunk; });
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));

          // Forward credentials to renderer
          if (mainWindow) {
            mainWindow.webContents.send('auth-callback', body);
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
          }

          // Shut down server after receiving callback
          stopAuthServer();
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });

    // Listen on random available port
    authServer.listen(0, '127.0.0.1', () => {
      const addr = authServer!.address();
      if (addr && typeof addr === 'object') {
        resolve(addr.port);
      } else {
        reject(new Error('Failed to get auth server port'));
      }
    });

    authServer.on('error', reject);
  });
}

function stopAuthServer() {
  if (authServer) {
    authServer.close();
    authServer = null;
  }
}

// IPC: start auth server and open system browser
ipcMain.handle('start-oauth', async (_event, loginUrl: string) => {
  stopAuthServer(); // Clean up any previous server
  const port = await startAuthServer();
  const url = `${loginUrl}${loginUrl.includes('?') ? '&' : '?'}callbackPort=${port}`;
  await shell.openExternal(url);
  return port;
});

// IPC: return the current app version from package.json
ipcMain.handle('get-app-version', () => app.getVersion());

// IPC: open URL in system browser
ipcMain.handle('open-external', (_event, url: string) => {
  return shell.openExternal(url);
});

// IPC: focus the main window's webContents (used when leaving the browser
// panel so that Electron menu roles route to the main renderer, not a webview)
ipcMain.handle('focus-main-webcontents', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.focus();
  }
});

// --- App lifecycle ---

// --- Download management ---
// Maps webContentsId → tab ownership info so will-download can route synchronously
const downloadInfoMap = new Map<number, { isAgent: boolean; agentName?: string; downloadDir?: string }>();
let downloadProjectCwd: string | null = null;
let downloadIdCounter = 0;

// Renderer tells us about tab ownership when a webview attaches
ipcMain.on('set-download-info', (_event, data: { webContentsId: number; isAgent: boolean; agentName?: string }) => {
  const existing = downloadInfoMap.get(data.webContentsId);
  downloadInfoMap.set(data.webContentsId, {
    isAgent: data.isAgent,
    agentName: data.agentName,
    downloadDir: existing?.downloadDir,
  });
});

// Agent sets a custom download directory via MCP
ipcMain.on('set-agent-download-dir', (_event, data: { webContentsId: number; downloadDir: string }) => {
  const existing = downloadInfoMap.get(data.webContentsId);
  if (existing) {
    existing.downloadDir = data.downloadDir;
  } else {
    downloadInfoMap.set(data.webContentsId, { isAgent: true, downloadDir: data.downloadDir });
  }
});

// Renderer sends project cwd for default download path
ipcMain.on('set-download-project-cwd', (_event, cwd: string) => {
  downloadProjectCwd = cwd;
});

// --- Webview session: set headers to look like a standard Chrome browser ---

// Managed popup window for OAuth, payments, and other flows that need a real window.
// Chrome distinguishes popups from new-tab requests by the presence of window features
// (width, height, etc.) or the disposition. We mirror that behavior:
//   - window.open(url, '_blank', 'width=500,height=600') → popup window
//   - <a target="_blank"> or window.open(url) with no features → new tab
function createManagedPopup(url: string, parentSession: Electron.Session, features?: string) {
  // Parse width/height from features string if provided
  let width = 500, height = 700;
  if (features) {
    const w = features.match(/width=(\d+)/);
    const h = features.match(/height=(\d+)/);
    if (w) width = Math.max(400, Math.min(parseInt(w[1], 10), 1200));
    if (h) height = Math.max(400, Math.min(parseInt(h[1], 10), 900));
  }

  const popup = new BrowserWindow({
    width,
    height,
    parent: mainWindow || undefined,
    modal: false,
    show: true,
    title: 'Popup',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      session: parentSession,
    },
  });

  popup.webContents.setUserAgent(BROWSER_USER_AGENT);
  popup.loadURL(url);

  // Prevent the popup from spawning further child windows — navigate in place
  popup.webContents.setWindowOpenHandler(({ url: childUrl }) => {
    popup.loadURL(childUrl);
    return { action: 'deny' };
  });
}

app.on('web-contents-created', (_event, contents) => {
  // Only configure webview guest contents (not the main renderer)
  if (contents.getType() !== 'webview') return;

  const ses = contents.session;

  // Set the user agent at the session level so all requests use it
  ses.setUserAgent(BROWSER_USER_AGENT);

  // Accept self-signed / invalid certificates for localhost development servers
  // (e.g. IIS Express, ASP.NET Core on https://localhost:*)
  ses.setCertificateVerifyProc((request, callback) => {
    try {
      const url = new URL(request.hostname.includes('://') ? request.hostname : `https://${request.hostname}`);
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        // Trust localhost certificates (self-signed dev certs)
        callback(0); // 0 = success / trust
        return;
      }
    } catch {}
    // For all other hosts, use default Chromium certificate verification
    callback(-3); // -3 = use default verification
  });

  // Add standard Chrome headers to all outgoing requests
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };

    // Modern Chrome client hints
    headers['Sec-CH-UA'] = '"Chromium";v="136", "Google Chrome";v="136", "Not_A Brand";v="99"';
    headers['Sec-CH-UA-Mobile'] = '?0';
    headers['Sec-CH-UA-Platform'] = '"macOS"';

    // Sec-Fetch headers — critical for Microsoft OAuth endpoints
    if (details.resourceType === 'mainFrame') {
      headers['Sec-Fetch-Dest'] = 'document';
      headers['Sec-Fetch-Mode'] = 'navigate';
      headers['Sec-Fetch-User'] = '?1';
      // Preserve cross-site for form POSTs (OAuth redirects)
      if (!headers['Sec-Fetch-Site']) {
        headers['Sec-Fetch-Site'] = 'none';
      }
    } else if (details.resourceType === 'xhr' || details.resourceType === 'other') {
      if (!headers['Sec-Fetch-Dest']) headers['Sec-Fetch-Dest'] = 'empty';
      if (!headers['Sec-Fetch-Mode']) headers['Sec-Fetch-Mode'] = 'cors';
      if (!headers['Sec-Fetch-Site']) headers['Sec-Fetch-Site'] = 'same-origin';
    }

    // Standard Accept-Language
    if (!headers['Accept-Language']) {
      headers['Accept-Language'] = 'en-US,en;q=0.9';
    }

    callback({ requestHeaders: headers });
  });

  // Handle new-window requests from webview guests.
  // NEVER return { action: 'allow' } — allowing webview guests to create child
  // BrowserWindows is unreliable in Electron 28 and crashes the guest renderer.
  //
  // Instead, mirror Chrome's behavior:
  //   - "new-popup" disposition (window.open with features) → managed BrowserWindow
  //     This covers OAuth, payment flows, and any site requesting a popup.
  //   - "foreground-tab"/"background-tab" disposition (target="_blank" links,
  //     window.open without features) → new tab in the integrated browser.
  contents.setWindowOpenHandler(({ url, disposition, features }) => {
    if (url) {
      const isPopup = disposition === 'new-window' || (features && features.length > 0);
      if (isPopup) {
        createManagedPopup(url, contents.session, features);
      } else if (mainWindow) {
        mainWindow.webContents.send('webview-new-window', url, contents.id);
      }
    }
    return { action: 'deny' };
  });

  // --- Download handling ---
  // Route downloads: agent tabs auto-save, user tabs show file dialog
  ses.on('will-download', (_dlEvent, item, webContents) => {
    const wcId = webContents.id;
    const info = downloadInfoMap.get(wcId);
    const dlId = String(++downloadIdCounter);
    const filename = item.getFilename();

    if (info?.isAgent) {
      // Agent tab: auto-save without dialog
      const dir = info.downloadDir
        || (downloadProjectCwd ? path.join(downloadProjectCwd, '.pixelcity', 'downloads', info.agentName || 'unknown') : path.join(app.getPath('downloads'), 'pixelcity', info.agentName || 'unknown'));
      fs.mkdirSync(dir, { recursive: true });
      item.setSavePath(path.join(dir, filename));
    }
    // User tab: don't call setSavePath → Electron shows OS file dialog

    // Track progress and send updates to renderer
    const sendUpdate = (state: string) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-progress', {
          id: dlId,
          filename,
          url: item.getURL(),
          savePath: item.getSavePath(),
          state,
          receivedBytes: item.getReceivedBytes(),
          totalBytes: item.getTotalBytes(),
          webContentsId: wcId,
        });
      }
    };

    item.on('updated', (_ev, updateState) => {
      sendUpdate(updateState); // 'progressing' or 'interrupted'
    });

    item.once('done', (_ev, doneState) => {
      sendUpdate(doneState); // 'completed', 'cancelled', or 'interrupted'
    });

    // Send initial event
    sendUpdate('progressing');
  });

  // Log detailed crash info from the main process (has full RenderProcessGoneDetails)
  contents.on('render-process-gone', (_event, details) => {
    console.error('[WebView] Renderer process gone:', JSON.stringify(details));
  });
});

// Log GPU process crashes (separate from individual renderer crashes).
// Routed through writeLogLine so crashes show up in the observability log file
// alongside renderer crashes. Behavior unchanged beyond the logging sink.
app.on('child-process-gone', (_event, details) => {
  if (details.type === 'GPU') {
    console.error('[Main] GPU process gone:', JSON.stringify(details));
    logEntry('error', 'gpu-process', {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      name: details.name,
      serviceName: details.serviceName,
    });
  }
});

// In dev mode, prevent Electron from stealing focus / switching macOS spaces
// when electronmon restarts the process. This must be set before the app is ready.
if (process.env.VITE_DEV_SERVER_URL && process.platform === 'darwin') {
  app.dock.hide();
}

app.whenReady().then(() => {
  // Restore dock icon now that the app is ready — keeps menu bar functional.
  // The dock was hidden pre-ready to prevent macOS from switching spaces on reload.
  if (process.env.VITE_DEV_SERVER_URL && process.platform === 'darwin') {
    app.dock.show();
  }

  // --- Observability foundation: register log:write IPC, prune old logs,
  // and emit a startup marker so we can verify the file path is wired. ---
  registerLogIpc();
  pruneOldLogs();
  logEntry('info', 'app', { msg: 'app started' });

  // --- MCP integration: install launcher + write this instance's descriptor.
  // The launcher is referenced by .mcp.json entries; descriptors at
  // ~/.pixelcity/instances/<mode>.json tell the launcher how to spawn servers.
  try {
    installMcpInstance();
  } catch (err) {
    console.warn('[main] installMcpInstance failed:', (err as Error).message);
  }

  // Set up application menu with Edit roles so copy/paste/undo work in web content (macOS)
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const },
      ],
    }] : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'forceReload' },
        ...(!app.isPackaged ? [{ role: 'toggleDevTools' as const }] : []),
        { type: 'separator' },
        {
          label: 'Actual Size',
          accelerator: 'CmdOrCtrl+0',
          registerAccelerator: false,
          click: () => { mainWindow?.webContents.setZoomLevel(0); },
        },
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+=',
          registerAccelerator: false,
          click: () => {
            if (!mainWindow) return;
            mainWindow.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() + 0.5);
          },
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          registerAccelerator: false,
          click: () => {
            if (!mainWindow) return;
            mainWindow.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() - 0.5);
          },
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin' ? [
          { type: 'separator' as const },
          { role: 'front' as const },
        ] : [
          { role: 'close' as const },
        ]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  createWindow();
  startWsServer({ getMainWindow: () => mainWindow });
  startPubSubWsServer(); // Local WS pubsub server on port 19850 (messages)

  // Start test MCP WebSocket server on port 19842 (only when ENABLE_TEST_MCP=true in .env)
  if (isTestServerEnabled()) {
    startTestServer({ getMainWindow: () => mainWindow });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  stopPubSubWsServer();
  teardownMcpInstance();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// --- Sync IPC: expose config path to renderer for config loading ---
ipcMain.on('get-config-path', (event) => {
  const appPath = app.getAppPath();
  event.returnValue = app.isPackaged
    ? path.join(appPath, '..', 'config.yml')
    : path.join(appPath, 'config.yml');
});

// --- Register all IPC handlers ---

const deps = {
  getMainWindow: () => mainWindow,
};

registerDialogs(ipcMain, deps);
registerPty(ipcMain, deps);
registerLayouts(ipcMain);
registerBoard(ipcMain);
registerConfig(ipcMain);
registerEmployees(ipcMain);
registerUsage(ipcMain);
registerTts(ipcMain);
registerDynamicPlugins(ipcMain);
registerMessages(ipcMain);
registerCanvasFile(ipcMain);
