// Renderer-side logger — foundation for the bulkhead/observability layer.
// Self-contained; nothing consumes it yet (later steps wire it up). Runs under
// nodeIntegration so we can require electron and read process.versions.
// Listeners + IPC fire-and-forget are guarded — bad listeners or an unready
// main process must not break logging.

// Use window.require('electron') (runtime, provided by nodeIntegration) instead
// of `import from 'electron'` — Vite would otherwise bundle the npm package's
// binary-resolver script, which calls path.join in a browser context.
const ipcRenderer: typeof import('electron').ipcRenderer | undefined = (() => {
  try { return (window as any).require('electron').ipcRenderer; } catch { return undefined; }
})();

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info';

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  cause?: unknown;
}

export interface LogEntry {
  ts: string;
  level: LogLevel;
  compartment: string;
  sessionId: string;
  elapsedMs: number;
  appVersion: string;
  electron: string;
  platform: string;
  err?: SerializedError;
  msg?: string;
  ctx?: unknown;
}

// TODO: source appVersion from package.json instead of hardcoding.
const APP_VERSION = '1.2.1';
const SESSION_ID = 'app-sess-' + Math.random().toString(36).slice(2, 10);
const STARTED_AT = Date.now();

const ELECTRON_VERSION = (() => {
  try { return process.versions.electron || 'unknown'; } catch { return 'unknown'; }
})();

const PLATFORM = (() => {
  try { return (process.platform || 'unknown') + '-' + (process.arch || 'unknown'); } catch { return 'unknown'; }
})();

const RING_CAPACITY = 500;
const ring: (LogEntry | undefined)[] = new Array(RING_CAPACITY);
let ringNext = 0;
let ringCount = 0;

const listeners = new Set<(e: LogEntry) => void>();

function serialize(err: unknown): SerializedError {
  if (err instanceof Error) {
    const out: SerializedError = { name: err.name, message: err.message };
    if (err.stack) out.stack = err.stack;
    if ((err as any).cause !== undefined) out.cause = (err as any).cause;
    return out;
  }
  if (typeof err === 'string') return { name: 'Error', message: err };
  try {
    return { name: 'Error', message: JSON.stringify(err) };
  } catch {
    return { name: 'Error', message: String(err) };
  }
}

function pushRing(entry: LogEntry) {
  ring[ringNext] = entry;
  ringNext = (ringNext + 1) % RING_CAPACITY;
  if (ringCount < RING_CAPACITY) ringCount++;
}

function snapshot(): LogEntry[] {
  const out: LogEntry[] = [];
  const start = ringCount < RING_CAPACITY ? 0 : ringNext;
  for (let i = 0; i < ringCount; i++) {
    const idx = (start + i) % RING_CAPACITY;
    const e = ring[idx];
    if (e) out.push(e);
  }
  return out;
}

function emit(level: LogLevel, compartment: string, payload: { err?: unknown; msg?: string; ctx?: unknown }) {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    compartment,
    sessionId: SESSION_ID,
    elapsedMs: Date.now() - STARTED_AT,
    appVersion: APP_VERSION,
    electron: ELECTRON_VERSION,
    platform: PLATFORM,
  };
  if (payload.err !== undefined) entry.err = serialize(payload.err);
  if (payload.msg !== undefined) entry.msg = payload.msg;
  if (payload.ctx !== undefined) entry.ctx = payload.ctx;

  pushRing(entry);

  for (const listener of listeners) {
    try { listener(entry); } catch { /* a bad listener must not break logging */ }
  }

  try {
    ipcRenderer?.invoke('log:write', entry).catch(() => { /* main not ready / handler missing */ });
  } catch { /* ipcRenderer unavailable — swallow */ }

  if (level === 'error' || level === 'fatal') {
    // eslint-disable-next-line no-console
    console.error('[' + compartment + ']', entry);
  }
}

export const log = {
  fatal: (compartment: string, err: unknown, ctx?: unknown) => emit('fatal', compartment, { err, ctx }),
  error: (compartment: string, err: unknown, ctx?: unknown) => emit('error', compartment, { err, ctx }),
  warn:  (compartment: string, msg: string, ctx?: unknown) => emit('warn',  compartment, { msg, ctx }),
  info:  (compartment: string, msg: string, ctx?: unknown) => emit('info',  compartment, { msg, ctx }),
  recent: (): LogEntry[] => snapshot(),
  subscribe: (listener: (e: LogEntry) => void): (() => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};
