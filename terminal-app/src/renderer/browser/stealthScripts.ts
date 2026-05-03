// Stealth script injected on every dom-ready to mask automation signals
export const STEALTH_SCRIPT = `(() => {
  // Hide webdriver flag
  Object.defineProperty(navigator, 'webdriver', { get: () => false });

  // Proper PluginArray mock (real Chrome has PDF plugins)
  try {
    const makePlugin = (name, desc, filename, mime) => {
      const mi = { type: mime, suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: null };
      const p = { name, description: desc, filename, length: 1, 0: mi, item: (i) => i === 0 ? mi : null, namedItem: (n) => n === mime ? mi : null };
      mi.enabledPlugin = p;
      return p;
    };
    const plugins = [
      makePlugin('Chrome PDF Plugin', 'Portable Document Format', 'internal-pdf-viewer', 'application/x-google-chrome-pdf'),
      makePlugin('Chrome PDF Viewer', '', 'mhjfbmdgcfjbbpaeojofohoefgiehjai', 'application/pdf'),
      makePlugin('Native Client', '', 'internal-nacl-plugin', 'application/x-nacl'),
    ];
    plugins.item = (i) => plugins[i] || null;
    plugins.namedItem = (name) => plugins.find(p => p.name === name) || null;
    plugins.refresh = () => {};
    Object.defineProperty(navigator, 'plugins', { get: () => plugins });
    // Also mock mimeTypes
    const mimeTypes = plugins.map(p => p[0]);
    mimeTypes.item = (i) => mimeTypes[i] || null;
    mimeTypes.namedItem = (t) => mimeTypes.find(m => m.type === t) || null;
    Object.defineProperty(navigator, 'mimeTypes', { get: () => mimeTypes });
  } catch {}

  // Realistic language list
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en'],
  });

  // Chrome runtime object and extended chrome APIs
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

  // CRITICAL: navigator.userAgentData mock — Google uses Client Hints API to detect Electron
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
    const uad = {
      brands,
      mobile: false,
      platform: 'macOS',
      getHighEntropyValues: (hints) => {
        const r = { brands: fullVersionBrands, mobile: false, platform: 'macOS' };
        if (hints.includes('architecture')) r.architecture = 'arm';
        if (hints.includes('bitness')) r.bitness = '64';
        if (hints.includes('model')) r.model = '';
        if (hints.includes('platformVersion')) r.platformVersion = '15.3.0';
        if (hints.includes('uaFullVersion')) r.uaFullVersion = '136.0.7103.93';
        if (hints.includes('fullVersionList')) r.fullVersionList = fullVersionBrands;
        if (hints.includes('wow64')) r.wow64 = false;
        return Promise.resolve(r);
      },
      toJSON: () => ({ brands, mobile: false, platform: 'macOS' }),
    };
    Object.defineProperty(navigator, 'userAgentData', { get: () => uad, configurable: true });
  } catch {}

  // Navigator connection mock (present in real Chrome)
  if (!navigator.connection) {
    try {
      Object.defineProperty(navigator, 'connection', {
        get: () => ({ effectiveType: '4g', rtt: 50, downlink: 10, saveData: false }),
      });
    } catch {}
  }

  // Patch permissions query (notifications check is a common bot test)
  try {
    const origQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (params) =>
      params.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : origQuery(params);
  } catch {}
})()`

export const STEALTH_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'

// Selector engine injected on dom-ready — provides __pcQuery and __pcQueryAll
export const SELECTOR_ENGINE_SCRIPT = `(() => {
  function isVisible(el) {
    if (!el) return false;
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || s.opacity === '0') return false;
    if (el.disabled) return false;
    return true;
  }

  const INTERACTIVE_SELECTOR = 'a, button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="radio"], [role="menuitem"], [onclick], [tabindex], label, summary';

  function queryCss(spec) {
    try {
      const all = document.querySelectorAll(spec);
      for (const el of all) { if (isVisible(el)) return el; }
      // If no visible match, return first match anyway (may be in viewport but tricky visibility)
      return all[0] || null;
    } catch { return null; }
  }

  function queryXpath(expr) {
    try {
      const result = document.evaluate(expr, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = 0; i < result.snapshotLength; i++) {
        const el = result.snapshotItem(i);
        if (isVisible(el)) return el;
      }
      return result.snapshotLength > 0 ? result.snapshotItem(0) : null;
    } catch { return null; }
  }

  function queryText(text, exact) {
    const candidates = document.querySelectorAll(INTERACTIVE_SELECTOR);
    for (const el of candidates) {
      if (!isVisible(el)) continue;
      const t = (el.textContent || '').trim();
      if (exact ? t === text : t.includes(text)) return el;
    }
    // Also check aria-label, placeholder, value
    for (const el of candidates) {
      if (!isVisible(el)) continue;
      const label = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.value || '';
      if (exact ? label.trim() === text : label.includes(text)) return el;
    }
    return null;
  }

  function queryRole(role) {
    // Explicit role attribute
    const explicit = document.querySelectorAll('[role="' + role + '"]');
    for (const el of explicit) { if (isVisible(el)) return el; }
    // Implicit role mapping
    const implicitMap = {
      button: 'button, input[type="button"], input[type="submit"], input[type="reset"]',
      link: 'a[href]',
      textbox: 'input:not([type]), input[type="text"], input[type="email"], input[type="password"], input[type="search"], input[type="tel"], input[type="url"], textarea',
      checkbox: 'input[type="checkbox"]',
      radio: 'input[type="radio"]',
      combobox: 'select',
      img: 'img[alt]',
      heading: 'h1, h2, h3, h4, h5, h6',
    };
    if (implicitMap[role]) {
      const els = document.querySelectorAll(implicitMap[role]);
      for (const el of els) { if (isVisible(el)) return el; }
    }
    return null;
  }

  window.__pcQuery = function(spec) {
    if (!spec) return null;
    if (spec.startsWith('xpath:')) return queryXpath(spec.slice(6));
    if (spec.startsWith('text*:')) return queryText(spec.slice(6), false);
    if (spec.startsWith('text:')) return queryText(spec.slice(5), true);
    if (spec.startsWith('role:')) return queryRole(spec.slice(5));
    return queryCss(spec);
  };

  window.__pcQueryAll = function(spec, limit) {
    limit = limit || 50;
    const results = [];
    let candidates;
    if (!spec) {
      candidates = document.querySelectorAll(INTERACTIVE_SELECTOR);
    } else if (spec.startsWith('xpath:')) {
      const xr = document.evaluate(spec.slice(6), document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      candidates = [];
      for (let i = 0; i < xr.snapshotLength; i++) candidates.push(xr.snapshotItem(i));
    } else if (spec.startsWith('text*:') || spec.startsWith('text:')) {
      const exact = spec.startsWith('text:');
      const text = exact ? spec.slice(5) : spec.slice(6);
      candidates = [];
      for (const el of document.querySelectorAll(INTERACTIVE_SELECTOR)) {
        const t = (el.textContent || '').trim();
        const label = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.value || '';
        if (exact ? (t === text || label.trim() === text) : (t.includes(text) || label.includes(text))) candidates.push(el);
      }
    } else if (spec.startsWith('role:')) {
      candidates = document.querySelectorAll('[role="' + spec.slice(5) + '"]');
    } else {
      try { candidates = document.querySelectorAll(spec); } catch { candidates = []; }
    }
    for (const el of candidates) {
      if (!isVisible(el)) continue;
      const rect = el.getBoundingClientRect();
      const attrs = {};
      for (const a of ['id', 'name', 'type', 'href', 'placeholder', 'aria-label', 'role', 'value', 'class']) {
        const v = el.getAttribute(a);
        if (v) attrs[a] = v.length > 200 ? v.slice(0, 200) : v;
      }
      // Auto-generate best selector (try multiple strategies)
      let sel = null;
      const tag = el.tagName.toLowerCase();
      if (el.id) sel = '#' + CSS.escape(el.id);
      else if (el.name) sel = tag + '[name="' + el.name + '"]';
      else if (el.getAttribute('aria-label')) sel = tag + '[aria-label="' + el.getAttribute('aria-label') + '"]';
      else if (el.getAttribute('role')) sel = tag + '[role="' + el.getAttribute('role') + '"]';
      else if (el.type && tag === 'input') sel = 'input[type="' + el.type + '"]';
      else if (el.getAttribute('href') && tag === 'a') sel = 'a[href="' + el.getAttribute('href') + '"]';
      else if (el.className && typeof el.className === 'string' && el.className.trim()) {
        const cls = el.className.trim().split(/\s+/).slice(0, 2).map(c => '.' + CSS.escape(c)).join('');
        sel = tag + cls;
      } else {
        // Fallback: use text-based selector for interactive elements
        const txt = (el.textContent || '').trim();
        if (txt && txt.length <= 60) sel = 'text:' + txt;
      }
      results.push({
        index: results.length,
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().slice(0, 120),
        attributes: attrs,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        selector: sel,
      });
      if (results.length >= limit) break;
    }
    return results;
  };
})()`
