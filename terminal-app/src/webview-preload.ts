const { ipcRenderer } = require('electron');

declare const window: any;

// --- Pixel City bridge (must remain) ---
window.__pixelCity = {
  notifyAddAgent: (agentId: string) => ipcRenderer.sendToHost('add-agent', { agentId }),
  notifyRemoveAgent: (agentId: string) => ipcRenderer.sendToHost('remove-agent', { agentId }),
  notifyResetAgents: () => ipcRenderer.sendToHost('reset-agents', {}),
};

// --- Stealth patches (run BEFORE page scripts) ---
// These must execute in the preload so they're in place before any page JS fingerprints the environment.

// Hide webdriver flag
Object.defineProperty(navigator, 'webdriver', { get: () => false });

// Proper PluginArray mock (real Chrome has PDF plugins)
try {
  const makePlugin = (name: string, desc: string, filename: string, mime: string) => {
    const mi = { type: mime, suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: null as any };
    const p: any = { name, description: desc, filename, length: 1, 0: mi, item: (i: number) => i === 0 ? mi : null, namedItem: (n: string) => n === mime ? mi : null };
    mi.enabledPlugin = p;
    return p;
  };
  const plugins: any = [
    makePlugin('Chrome PDF Plugin', 'Portable Document Format', 'internal-pdf-viewer', 'application/x-google-chrome-pdf'),
    makePlugin('Chrome PDF Viewer', '', 'mhjfbmdgcfjbbpaeojofohoefgiehjai', 'application/pdf'),
    makePlugin('Native Client', '', 'internal-nacl-plugin', 'application/x-nacl'),
  ];
  plugins.item = (i: number) => plugins[i] || null;
  plugins.namedItem = (name: string) => plugins.find((p: any) => p.name === name) || null;
  plugins.refresh = () => {};
  Object.defineProperty(navigator, 'plugins', { get: () => plugins });

  const mimeTypes: any = plugins.map((p: any) => p[0]);
  mimeTypes.item = (i: number) => mimeTypes[i] || null;
  mimeTypes.namedItem = (t: string) => mimeTypes.find((m: any) => m.type === t) || null;
  Object.defineProperty(navigator, 'mimeTypes', { get: () => mimeTypes });
} catch {}

// Realistic language list
Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

// Chrome runtime and extended APIs
if (!window.chrome) window.chrome = {};
if (!window.chrome.runtime) window.chrome.runtime = {};
if (!window.chrome.app) {
  window.chrome.app = {
    isInstalled: false,
    InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
    RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
  };
}
if (!window.chrome.csi) {
  window.chrome.csi = () => ({
    startE: Date.now(), onloadT: Date.now(), pageT: performance.now(), tran: 15,
  });
}
if (!window.chrome.loadTimes) {
  window.chrome.loadTimes = () => {
    const now = Date.now() / 1000;
    return {
      commitLoadTime: now, connectionInfo: 'h2', finishDocumentLoadTime: now,
      finishLoadTime: now, firstPaintAfterLoadTime: 0, firstPaintTime: now,
      navigationType: 'Other', npnNegotiatedProtocol: 'h2', requestTime: now - 0.16,
      startLoadTime: now - 0.32, wasAlternateProtocolAvailable: false,
      wasFetchedViaSpdy: true, wasNpnNegotiated: true,
    };
  };
}

// --- CRITICAL: navigator.userAgentData mock ---
// Google uses the User-Agent Client Hints API to detect the real browser.
// Without this, navigator.userAgentData.brands reveals "Electron".
try {
  const brands = [
    { brand: 'Chromium', version: '136' },
    { brand: 'Google Chrome', version: '136' },
    { brand: 'Not_A Brand', version: '99' },
  ];
  const fullVersionBrands = [
    { brand: 'Chromium', version: '136.0.7103.93' },
    { brand: 'Google Chrome', version: '136.0.7103.93' },
    { brand: 'Not_A Brand', version: '99.0.0.0' },
  ];

  const userAgentData = {
    brands,
    mobile: false,
    platform: 'macOS',
    getHighEntropyValues: (hints: string[]) => {
      const result: any = { brands: fullVersionBrands, mobile: false, platform: 'macOS' };
      if (hints.includes('architecture')) result.architecture = 'arm';
      if (hints.includes('bitness')) result.bitness = '64';
      if (hints.includes('model')) result.model = '';
      if (hints.includes('platformVersion')) result.platformVersion = '15.3.0';
      if (hints.includes('uaFullVersion')) result.uaFullVersion = '136.0.7103.93';
      if (hints.includes('fullVersionList')) result.fullVersionList = fullVersionBrands;
      if (hints.includes('wow64')) result.wow64 = false;
      return Promise.resolve(result);
    },
    toJSON: () => ({ brands, mobile: false, platform: 'macOS' }),
  };

  Object.defineProperty(navigator, 'userAgentData', {
    get: () => userAgentData,
    configurable: true,
  });
} catch {}

// Navigator connection mock (present in real Chrome)
try {
  Object.defineProperty(navigator, 'connection', {
    get: () => ({ effectiveType: '4g', rtt: 50, downlink: 10, saveData: false }),
  });
} catch {}

// Patch permissions query (notifications check is a common bot test)
try {
  const nav = navigator as any;
  if (nav.permissions && nav.permissions.query) {
    const origQuery = nav.permissions.query.bind(nav.permissions);
    nav.permissions.query = (params: any) =>
      params.name === 'notifications'
        ? Promise.resolve({ state: (window as any).Notification?.permission || 'default' })
        : origQuery(params);
  }
} catch {}

// Hide Electron/Node.js globals that leak into the page context
try {
  // Don't delete process/require since the preload itself uses them,
  // but hide them from page scripts after this preload completes
  const _process = window.process;
  const _require = window.require;
  // Use setTimeout to clean up after preload code finishes
  setTimeout(() => {
    try {
      delete window.process;
      delete window.require;
      delete window.module;
      delete window.exports;
      delete window.__dirname;
      delete window.__filename;
    } catch {}
  }, 0);
} catch {}
