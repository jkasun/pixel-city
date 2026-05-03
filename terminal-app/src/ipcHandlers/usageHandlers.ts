import path from 'path';
import os from 'os';
import fs from 'fs';
import { IpcMain } from 'electron';
import * as pty from 'node-pty';
import { getResolvedEnv } from './shellEnv';

// ── Types (mirror renderer PlanUsageData) ───────────────────────────

interface PlanUsageBucket {
  utilization: number;
  resets_at: string;
}

interface ExtraUsage {
  is_enabled: boolean;
  used_credits: number | null;
  monthly_limit: number | null;
  utilization: number | null;
}

interface PlanUsageData {
  five_hour: PlanUsageBucket | null;
  seven_day: PlanUsageBucket | null;
  seven_day_sonnet: PlanUsageBucket | null;
  seven_day_opus: PlanUsageBucket | null;
  extra_usage: ExtraUsage | null;
}

function getClaudeDir(): string {
  return path.join(os.homedir(), '.claude');
}

// ── ANSI handling ──────────────────────────────────────────────────
// Ink scatters text across a row using cursor-positioning escapes. If
// we strip those before preserving word boundaries, neighbouring words
// concatenate ("Accessing workspace" → "Accessingworkspace"). Normalize
// cursor moves into whitespace/newlines first, then strip the rest.

function normalizeCursorMoves(s: string): string {
  return s
    .replace(/\x1b\[\d*[CD]/g, ' ')
    .replace(/\x1b\[\d*G/g, ' ')
    .replace(/\x1b\[\d*;\d*[Hf]/g, '\n')
    .replace(/\x1b\[\d*[AB]/g, '\n');
}

const ANSI_RE = /\x1b\[[\d;?]*[a-zA-Z@`]|\x1b\][\s\S]*?(?:\x07|\x1b\\)|\x1b[()][\dAB012]|\x1b[=>NOMDEHc78]/g;

function stripAnsi(s: string): string {
  return normalizeCursorMoves(s).replace(ANSI_RE, '').replace(/\x00/g, '');
}

// ── Reset-time parsing ─────────────────────────────────────────────
// Times come from the Claude Code UI in the machine's local TZ (it
// prints the zone in parens for the user). We parse them as local time.

function parseResetLine(line: string): string | null {
  const clean = line
    .replace(/\([^)]*\)\s*$/, '')
    .replace(/^\s*Resets\s+/i, '')
    .trim();
  const now = new Date();
  const year = now.getFullYear();

  let m = clean.match(/^([A-Z][a-z]{2})\s+(\d+)\s+at\s+(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (m) {
    const d = new Date(`${m[1]} ${m[2]}, ${year} ${m[3]}:${m[4]} ${m[5]}`);
    if (!isNaN(d.getTime())) {
      if (d.getTime() < now.getTime()) d.setFullYear(year + 1);
      return d.toISOString();
    }
  }

  m = clean.match(/^([A-Z][a-z]{2})\s+(\d+)$/i);
  if (m) {
    const d = new Date(`${m[1]} ${m[2]}, ${year} 00:00`);
    if (!isNaN(d.getTime())) {
      if (d.getTime() < now.getTime()) d.setFullYear(year + 1);
      return d.toISOString();
    }
  }

  m = clean.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (m) {
    let h = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const ampm = m[3].toLowerCase();
    if (ampm === 'pm' && h !== 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    const d = new Date(now);
    d.setHours(h, mm, 0, 0);
    if (d.getTime() < now.getTime()) d.setDate(d.getDate() + 1);
    return d.toISOString();
  }

  return null;
}

// ── Screen parsing ─────────────────────────────────────────────────
// Section headers are unique and stable even under Ink's redraws. We
// locate the last occurrence of each header, build non-overlapping
// windows up to the next header, then extract the percentage + reset
// time from each window. The reset is matched by *time pattern* (not
// the literal "Resets" word) because Ink sometimes partially writes
// that word across frames ("Rese\x1b[1Cs" → "Rese s" after stripping).

interface SectionBounds { key: keyof PlanUsageData; start: number; end: number }

const SECTION_HEADERS: Array<{ key: keyof PlanUsageData; re: RegExp }> = [
  { key: 'five_hour',        re: /Current session/gi },
  { key: 'seven_day',        re: /Current week\s*\(all models\)/gi },
  { key: 'seven_day_sonnet', re: /Current week\s*\(Sonnet only\)/gi },
  { key: 'seven_day_opus',   re: /Current week\s*\(Opus only\)/gi },
  { key: 'extra_usage',      re: /Extra usage/gi },
];

function locateSections(text: string): SectionBounds[] {
  const hits: Array<{ key: keyof PlanUsageData; start: number }> = [];
  for (const { key, re } of SECTION_HEADERS) {
    re.lastIndex = 0;
    let last = -1;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      last = m.index + m[0].length;
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    if (last >= 0) hits.push({ key, start: last });
  }
  hits.sort((a, b) => a.start - b.start);
  return hits.map((h, i) => ({
    key: h.key,
    start: h.start,
    end: i + 1 < hits.length ? hits[i + 1].start - 1 : Math.min(h.start + 400, text.length),
  }));
}

function extractBucket(window: string): PlanUsageBucket | null {
  const pm = window.match(/(\d+)\s*%\s*used/i);
  if (!pm) return null;
  const utilization = parseInt(pm[1], 10);

  let resets_at = '';
  let m: RegExpMatchArray | null;
  if ((m = window.match(/([A-Z][a-z]{2})\s+(\d{1,2})\s+at\s+(\d{1,2}):(\d{2})\s*(am|pm)/i))) {
    resets_at = parseResetLine(`Resets ${m[0]}`) ?? '';
  } else if ((m = window.match(/([A-Z][a-z]{2})\s+(\d{1,2})(?![\d:])/))) {
    resets_at = parseResetLine(`Resets ${m[0]}`) ?? '';
  } else if ((m = window.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i))) {
    resets_at = parseResetLine(`Resets ${m[0]}`) ?? '';
  }
  return { utilization, resets_at };
}

function parseUsageScreen(raw: string): PlanUsageData | null {
  const text = stripAnsi(raw)
    .replace(/[│┃┆┇┊┋┤├┬┴┼╭╮╯╰─━═║]/g, ' ')
    .replace(/[ \t]+/g, ' ');

  const sections = locateSections(text);
  const bySectionKey = (k: keyof PlanUsageData) => sections.find((s) => s.key === k) ?? null;

  const mkBucket = (k: keyof PlanUsageData): PlanUsageBucket | null => {
    const s = bySectionKey(k);
    if (!s) return null;
    return extractBucket(text.slice(s.start, s.end));
  };

  const five_hour = mkBucket('five_hour');
  const seven_day = mkBucket('seven_day');
  const seven_day_sonnet = mkBucket('seven_day_sonnet');
  const seven_day_opus = mkBucket('seven_day_opus');

  let extra_usage: ExtraUsage | null = null;
  const extraSection = bySectionKey('extra_usage');
  if (extraSection) {
    const win = text.slice(extraSection.start, extraSection.end);
    const pm = win.match(/(\d+)\s*%\s*used/i);
    const sm = win.match(/\$([\d.]+)\s*\/\s*\$([\d.]+)/);
    const utilization = pm ? parseInt(pm[1], 10) : null;
    const used = sm ? parseFloat(sm[1]) : null;
    const limit = sm ? parseFloat(sm[2]) : null;
    if (utilization !== null || used !== null) {
      extra_usage = { is_enabled: true, used_credits: used, monthly_limit: limit, utilization };
    }
  }

  if (!five_hour && !seven_day && !seven_day_sonnet && !seven_day_opus && !extra_usage) {
    return null;
  }

  return { five_hour, seven_day, seven_day_sonnet, seven_day_opus, extra_usage };
}

// ── PTY scraping ───────────────────────────────────────────────────

function resolveClaudeBinary(pathEnv: string): string {
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'claude'),
    path.join(os.homedir(), '.claude', 'local', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* noop */ }
  }
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, 'claude');
    try { if (fs.existsSync(p)) return p; } catch { /* noop */ }
  }
  return 'claude';
}

// Claude Code shows a "Trust this folder?" gate the first time it runs
// in a directory. We avoid triggering it by launching in a directory
// that's already been accepted — which we can detect by reading the
// target CLAUDE_CONFIG_DIR's .claude.json and finding any project with
// hasTrustDialogAccepted === true.
function findTrustedCwd(configDir: string | undefined): string | null {
  const claudeJsonPath = configDir
    ? path.join(configDir, '.claude.json')
    : path.join(os.homedir(), '.claude.json');
  try {
    const j = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8')) as { projects?: Record<string, { hasTrustDialogAccepted?: boolean }> };
    for (const [dir, meta] of Object.entries(j.projects || {})) {
      if (meta?.hasTrustDialogAccepted && fs.existsSync(dir)) return dir;
    }
  } catch { /* noop */ }
  return null;
}

const DEBUG_USAGE = process.env.PIXEL_CITY_USAGE_DEBUG === '1';
const DEBUG_LOG_PATH = path.join(os.tmpdir(), 'pixel-city-usage-debug.log');

function dumpDebug(label: string, raw: string, parsed: PlanUsageData | null) {
  if (!DEBUG_USAGE) return;
  try {
    const stripped = stripAnsi(raw);
    const body =
      `\n\n===== ${new Date().toISOString()} — ${label} =====\n` +
      `parsed: ${JSON.stringify(parsed)}\n` +
      `--- stripped (${stripped.length} bytes) ---\n${stripped}\n`;
    fs.appendFileSync(DEBUG_LOG_PATH, body);
  } catch { /* noop */ }
}

async function scrapeUsageViaPty(configDir: string | undefined): Promise<PlanUsageData | null> {
  const resolvedEnv = await getResolvedEnv();
  const env: Record<string, string> = { ...resolvedEnv };
  delete env.npm_config_prefix;
  if (configDir) env.CLAUDE_CONFIG_DIR = configDir;
  env.LANG = env.LANG || 'en_US.UTF-8';
  env.PIXEL_CITY_USAGE_SCRAPE = '1';

  const claudeBin = resolveClaudeBinary(env.PATH || process.env.PATH || '');
  const trustedCwd = findTrustedCwd(configDir) || os.homedir();

  return new Promise<PlanUsageData | null>((resolve) => {
    let proc: pty.IPty;
    try {
      proc = pty.spawn(claudeBin, [], {
        name: 'xterm-256color',
        cols: 100,
        rows: 60,
        cwd: trustedCwd,
        env: env as unknown as { [key: string]: string },
      });
    } catch (err) {
      console.warn('[usage] failed to spawn claude:', (err as Error).message);
      return resolve(null);
    }

    let buffer = '';
    let resolved = false;
    let usageSent = false;
    let scanFromOffset = 0;
    let finalizeTimer: NodeJS.Timeout | null = null;

    const finalize = (reason: string) => {
      if (resolved) return;
      resolved = true;
      if (finalizeTimer) clearTimeout(finalizeTimer);
      try { proc.kill(); } catch { /* noop */ }
      const parsed = parseUsageScreen(buffer);
      dumpDebug(`finalize:${reason}`, buffer, parsed);
      resolve(parsed);
    };

    const scheduleFinalize = (delay: number, reason: string) => {
      if (finalizeTimer) clearTimeout(finalizeTimer);
      finalizeTimer = setTimeout(() => finalize(reason), delay);
    };

    proc.onData((data: string) => {
      buffer += data;
      const fresh = stripAnsi(buffer.slice(scanFromOffset));
      const tail = fresh.slice(-1500);

      // Skip the trust-folder gate if, despite our trusted-cwd choice,
      // it still appears (e.g. in a scratch CLAUDE_CONFIG_DIR).
      if (/trust this folder|Yes, I trust/i.test(tail) && !usageSent) {
        setTimeout(() => {
          try { proc.write('1\r'); } catch { /* noop */ }
          scanFromOffset = buffer.length;
        }, 250);
        return;
      }

      // `╭` / `╰` only appear once the main Claude Code input box is
      // drawn. The bare `❯` marker also appears inside menus (including
      // the trust menu), so don't match on it.
      if (!usageSent && /╭─+|─+╮|─+╯|╰─+|shortcuts|claude\.ai\/code/i.test(tail)) {
        usageSent = true;
        setTimeout(() => {
          try { proc.write('/usage\r'); } catch { /* noop */ }
        }, 600);
        scheduleFinalize(7000, 'usage-rendered');
      }
    });

    proc.onExit(({ exitCode }) => {
      if (!resolved) {
        resolved = true;
        if (finalizeTimer) clearTimeout(finalizeTimer);
        const parsed = parseUsageScreen(buffer);
        dumpDebug(`onExit:${exitCode}`, buffer, parsed);
        resolve(parsed);
      }
    });

    // Fallback: prompt never detected → send /usage anyway.
    setTimeout(() => {
      if (!usageSent) {
        usageSent = true;
        try { proc.write('/usage\r'); } catch { /* noop */ }
        scheduleFinalize(7000, 'usage-rendered-fallback');
      }
    }, 6000);

    // Hard ceiling.
    setTimeout(() => finalize('hard-timeout'), 20_000);
  });
}

// ── Cache ──────────────────────────────────────────────────────────

interface CacheEntry {
  at: number;
  data: PlanUsageData | null;
}
const CACHE_TTL_MS = 600_000; // 10 minutes
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<PlanUsageData | null>>();

// ── Disk persistence ──────────────────────────────────────────────
// Persist usage cache to disk so it survives app restarts, keyed by
// subscription / configDir.

const DISK_CACHE_PATH = path.join(getClaudeDir(), 'pixel-city-usage-cache.json');

function loadDiskCache(): void {
  try {
    if (!fs.existsSync(DISK_CACHE_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(DISK_CACHE_PATH, 'utf8')) as Record<string, CacheEntry>;
    const now = Date.now();
    for (const [key, entry] of Object.entries(raw)) {
      if (entry?.at && now - entry.at < CACHE_TTL_MS) {
        cache.set(key, entry);
      }
    }
  } catch { /* noop */ }
}

function saveDiskCache(): void {
  try {
    const obj: Record<string, CacheEntry> = {};
    for (const [key, entry] of cache.entries()) {
      if (entry.data) obj[key] = entry;
    }
    fs.writeFileSync(DISK_CACHE_PATH, JSON.stringify(obj), 'utf8');
  } catch { /* noop */ }
}

// Restore persisted cache on module load.
loadDiskCache();

function cacheKey(configDir: string | undefined): string {
  return configDir || '__default__';
}

async function getPlanCached(configDir: string | undefined): Promise<PlanUsageData | null> {
  const key = cacheKey(configDir);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.data;

  const existing = inflight.get(key);
  if (existing) return existing;

  const p = scrapeUsageViaPty(configDir)
    .then((data) => {
      cache.set(key, { at: Date.now(), data });
      saveDiskCache();
      inflight.delete(key);
      return data;
    })
    .catch((err) => {
      inflight.delete(key);
      console.warn('[usage] scrape failed:', err?.message || err);
      return null;
    });
  inflight.set(key, p);
  return p;
}

// ── IPC registration ───────────────────────────────────────────────

export function register(ipcMain: IpcMain) {
  ipcMain.handle('claude-usage-stats', () => {
    try {
      const statsPath = path.join(getClaudeDir(), 'stats-cache.json');
      if (!fs.existsSync(statsPath)) return { success: true, stats: null };
      const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
      return { success: true, stats };
    } catch (err: any) {
      return { success: false, error: err.message, stats: null };
    }
  });

  ipcMain.handle('claude-usage-plan', async (_event, args?: { configDir?: string; force?: boolean }) => {
    try {
      const configDir = args?.configDir;
      if (args?.force) cache.delete(cacheKey(configDir));
      const data = await getPlanCached(configDir);
      if (!data) return { success: false, error: 'parse_failed' };
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}
