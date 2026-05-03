// Main-process file sink for the bulkhead/observability layer. Writes JSONL
// daily-rotated log files into the Electron logs dir. Renderer logger sends
// entries here over `log:write` IPC. Errors are swallowed — logging must never
// crash main.

import { app, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';

const FILE_PREFIX = 'pixel-city-';
const FILE_SUFFIX = '.jsonl';
const ROTATION_SIZE = 10 * 1024 * 1024; // 10 MB
const RETENTION_DAYS = 7;

let initialised = false;
let logDir = '';

function ensureInit(): string {
  if (initialised) return logDir;
  logDir = app.getPath('logs');
  try { fs.mkdirSync(logDir, { recursive: true }); } catch { /* best-effort */ }
  initialised = true;
  return logDir;
}

function utcDateStamp(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

export function getLogDir(): string {
  return ensureInit();
}

export function getCurrentLogFile(): string {
  return path.join(ensureInit(), FILE_PREFIX + utcDateStamp() + FILE_SUFFIX);
}

function rotateIfNeeded(file: string): void {
  try {
    const stat = fs.statSync(file);
    if (stat.size <= ROTATION_SIZE) return;
    const stamp = utcDateStamp();
    for (let n = 2; n < 1000; n++) {
      const rotated = path.join(ensureInit(), FILE_PREFIX + stamp + '.' + n + FILE_SUFFIX);
      if (!fs.existsSync(rotated)) {
        fs.renameSync(file, rotated);
        return;
      }
    }
  } catch { /* file missing or stat failed — nothing to rotate */ }
}

export function writeLogLine(entry: object): void {
  const file = getCurrentLogFile();
  rotateIfNeeded(file);
  const line = JSON.stringify(entry) + '\n';
  fs.appendFile(file, line, () => { /* swallow async errors */ });
}

export function pruneOldLogs(): void {
  let entries: string[] = [];
  try { entries = fs.readdirSync(ensureInit()); } catch { return; }
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const re = /^pixel-city-(\d{4})-(\d{2})-(\d{2})(?:\.\d+)?\.jsonl$/;
  for (const name of entries) {
    const m = re.exec(name);
    if (!m) continue;
    const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (Number.isNaN(t) || t >= cutoff) continue;
    try { fs.unlinkSync(path.join(logDir, name)); } catch { /* ignore */ }
  }
}

function getLogFileForDate(d: Date): string {
  return path.join(ensureInit(), FILE_PREFIX + utcDateStamp(d) + FILE_SUFFIX);
}

const BUNDLE_TAIL_BYTES = 5 * 1024 * 1024; // 5 MB

function readLogTail(file: string): string {
  try {
    const stat = fs.statSync(file);
    const fd = fs.openSync(file, 'r');
    try {
      if (stat.size <= BUNDLE_TAIL_BYTES) {
        const buf = Buffer.alloc(stat.size);
        fs.readSync(fd, buf, 0, stat.size, 0);
        return buf.toString('utf8');
      }
      const buf = Buffer.alloc(BUNDLE_TAIL_BYTES);
      const start = stat.size - BUNDLE_TAIL_BYTES;
      fs.readSync(fd, buf, 0, BUNDLE_TAIL_BYTES, start);
      const text = buf.toString('utf8');
      const nl = text.indexOf('\n');
      return '[truncated to last 5 MB]\n' + (nl >= 0 ? text.slice(nl + 1) : text);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

export async function exportBundle(sessionId?: string): Promise<string> {
  const parts: string[] = [];
  parts.push('=== System ===\n');
  let appVersion = 'unknown';
  try { appVersion = app.getVersion(); } catch { /* ignore */ }
  const versions = process.versions || ({} as NodeJS.ProcessVersions);
  let uptime = 0;
  try { uptime = process.uptime(); } catch { /* ignore */ }
  parts.push('appVersion: ' + appVersion + '\n');
  parts.push('electron: ' + (versions.electron || 'unknown') + '\n');
  parts.push('chrome: ' + (versions.chrome || 'unknown') + '\n');
  parts.push('node: ' + (versions.node || 'unknown') + '\n');
  parts.push('platform: ' + os.platform() + '\n');
  parts.push('arch: ' + os.arch() + '\n');
  parts.push('timestamp: ' + new Date().toISOString() + '\n');
  parts.push('sessionId: ' + (sessionId || 'unknown') + '\n');
  parts.push('uptime: ' + uptime.toFixed(2) + 's\n');
  parts.push('\n');

  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const todayFile = getLogFileForDate(today);
  const yesterdayFile = getLogFileForDate(yesterday);

  parts.push("=== Today's log (" + path.basename(todayFile) + ') ===\n');
  if (fs.existsSync(todayFile)) {
    parts.push(readLogTail(todayFile));
  } else {
    parts.push('(no log file for today)\n');
  }
  parts.push('\n');

  parts.push("=== Yesterday's log (" + path.basename(yesterdayFile) + ') ===\n');
  if (fs.existsSync(yesterdayFile)) {
    parts.push(readLogTail(yesterdayFile));
  } else {
    parts.push('(no log file for yesterday)\n');
  }

  return parts.join('');
}

export function registerLogIpc(): void {
  ipcMain.handle('log:write', (_event, entry: unknown) => {
    try {
      if (entry && typeof entry === 'object') writeLogLine(entry as object);
    } catch { /* never crash main from a bad payload */ }
  });
  ipcMain.handle('log:get-dir', () => {
    try { return getLogDir(); } catch { return ''; }
  });
  ipcMain.handle('log:export-bundle', async (_event, sessionId?: string) => {
    try { return await exportBundle(sessionId); }
    catch (e) { return 'Failed to build diagnostic bundle: ' + (e instanceof Error ? e.message : String(e)); }
  });
}
