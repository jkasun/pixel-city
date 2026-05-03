import path from 'path';
import os from 'os';
import fs from 'fs';
import { IpcMain, shell } from 'electron';
import { getLauncherPath, getMcpRoot } from '../main/mcpInstance';

// ── Office instructions file (.pixelcity/office-instructions.md) ─
// OSS local-first: a single markdown file the user can edit directly.
// Replaces the legacy `config.officeInstructions[buildingId]` map.

const OFFICE_INSTRUCTIONS_FILE = 'office-instructions.md';

function getOfficeInstructionsPath(projectDir?: string): string {
  const root = projectDir || os.homedir();
  return path.join(root, '.pixelcity', OFFICE_INSTRUCTIONS_FILE);
}

function readOfficeInstructionsFile(projectDir?: string): string {
  const p = getOfficeInstructionsPath(projectDir);
  try {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  } catch { /* ignore */ }
  return '';
}

function writeOfficeInstructionsFile(projectDir: string | undefined, content: string): string {
  const p = getOfficeInstructionsPath(projectDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

// ── City configuration & canvas preferences (~/.pixelcity/*.md) ───
// Both are global (per-machine) markdown files in the user's home
// pixelcity dir. Single source of truth — no per-project override and
// no SQLite mirror.

const CITY_CONFIGURATION_FILE = 'city-configuration.md';
const CANVAS_PREFERENCES_FILE = 'canvas-preferences.md';

function getCityConfigurationPath(): string {
  return path.join(os.homedir(), '.pixelcity', CITY_CONFIGURATION_FILE);
}

function getCanvasPreferencesPath(): string {
  return path.join(os.homedir(), '.pixelcity', CANVAS_PREFERENCES_FILE);
}

function readMarkdownFile(filePath: string): string {
  try {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8');
  } catch { /* ignore */ }
  return '';
}

function readCityConfigurationFile(): string {
  return readMarkdownFile(getCityConfigurationPath());
}

function writeCityConfigurationFile(content: string): string {
  const p = getCityConfigurationPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

function readCanvasPreferencesFile(): string {
  return readMarkdownFile(getCanvasPreferencesPath());
}

function writeCanvasPreferencesFile(content: string): string {
  const p = getCanvasPreferencesPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

function getConfigPath(projectDir?: string): string {
  if (projectDir) return path.join(projectDir, '.pixelcity', 'config.json');
  return path.join(os.homedir(), '.pixelcity', 'config.json');
}

function readConfigRaw(projectDir?: string): any {
  const p = getConfigPath(projectDir);
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { /* ignore */ }
  return { cityInstructions: '', officeInstructions: {} };
}

function readConfig(projectDir?: string): any {
  const config = readConfigRaw(projectDir);
  if (!config.officeInstructions || typeof config.officeInstructions !== 'object') {
    config.officeInstructions = {};
  }
  return config;
}

function writeConfig(projectDir: string | undefined, data: any) {
  const p = getConfigPath(projectDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

function resolveInstructionText(text: string | undefined): string | null {
  if (!text || typeof text !== 'string' || !text.trim()) return null;
  return text.trim();
}

// ── MCP config writer ─────────────────────────────────────────────
// Writes `.mcp.json` and the codex `config.toml` referencing a single
// per-machine launcher. The bytes are dev/prod invariant — both modes
// produce identical content for the same project, so concurrent runs
// never conflict on the file. The launcher dispatches at spawn time
// based on which Pixel City instance is alive (see `mcpInstance.ts`
// and `mcp-server/launcher.cjs`).

const ALL_PC_SERVER_NAMES = new Set([
  'pixel-city-office', 'pixel-city-files', 'pixel-city-quick-actions',
  'pixel-city-messages',
  'pixel-city-board', 'pixel-city-browser', 'pixel-city-plugins',
  'pixelcity-mempalace',
  // Legacy names from older writes — strip on rewrite
  'pixel-city', 'pixel-city-meetings', 'mempalace',
]);

interface RegistryEntry { name: string; file: string }

function loadRegistry(): RegistryEntry[] {
  try {
    const registryPath = path.join(getMcpRoot(), 'registry.json');
    return JSON.parse(fs.readFileSync(registryPath, 'utf8')).servers as RegistryEntry[];
  } catch (err) {
    console.error('[configHandlers] failed to load MCP registry:', err);
    return [];
  }
}

function buildPixelCityServerEntries(): Record<string, any> {
  const launcher = getLauncherPath();
  const registry = loadRegistry();

  const entries: Record<string, any> = {};
  for (const { name } of registry) {
    entries[name] = { command: launcher, args: [name] };
  }
  // Mempalace lives outside the registry but always ships
  entries['pixelcity-mempalace'] = { command: launcher, args: ['pixelcity-mempalace'] };
  return entries;
}

// Minimal TOML writer for Codex CLI's config.toml (mcp_servers tables only).
// Codex CLI is strict about quoting — always quote keys and string values.
function tomlEscape(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}
function tomlStr(s: string): string { return `"${tomlEscape(s)}"`; }

function buildCodexConfigToml(servers: Record<string, any>, projectDir: string): string {
  const lines: string[] = [
    '# Auto-generated by Pixel City — do not edit by hand.',
    '# Add custom MCP servers to <projectDir>/pixelcity.mcp.json instead.',
    '',
    // Pre-trust the project directory so Codex skips the "Do you trust this folder?"
    // prompt on every spawn. CODEX_HOME points at .pixelcity/codex per-project,
    // so this trust entry is scoped to this workspace only.
    `[projects.${tomlStr(projectDir)}]`,
    `trust_level = "trusted"`,
    '',
  ];
  for (const [name, entry] of Object.entries(servers)) {
    // Codex CLI only supports stdio MCP servers (command/args). Skip URL-based
    // or otherwise non-stdio entries that may live in pixelcity.mcp.json.
    if (!entry || typeof entry.command !== 'string') continue;
    lines.push(`[mcp_servers.${tomlStr(name)}]`);
    lines.push(`command = ${tomlStr(entry.command)}`);
    if (Array.isArray(entry.args)) {
      const args = entry.args
        .filter((a: any) => typeof a === 'string')
        .map((a: string) => tomlStr(a))
        .join(', ');
      lines.push(`args = [${args}]`);
    }
    if (entry.env && typeof entry.env === 'object') {
      const pairs: string[] = [];
      for (const [k, v] of Object.entries(entry.env)) {
        if (typeof v === 'string') pairs.push(`${tomlStr(k)} = ${tomlStr(v)}`);
      }
      if (pairs.length) lines.push(`env = { ${pairs.join(', ')} }`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function writeMcpConfigs(projectDir: string, pcServers: Record<string, any>): void {
  // Read user extensions from pixelcity.mcp.json (or scaffold one)
  const userMcpPath = path.join(projectDir, 'pixelcity.mcp.json');
  let userServers: Record<string, any> = {};
  try {
    if (fs.existsSync(userMcpPath)) {
      const userConfig = JSON.parse(fs.readFileSync(userMcpPath, 'utf8'));
      userServers = userConfig.mcpServers || {};
    } else {
      const scaffold = {
        _comment: 'Add your MCP extensions here. Pixel City merges these into .mcp.json automatically.',
        mcpServers: {},
      };
      fs.writeFileSync(userMcpPath, JSON.stringify(scaffold, null, 2) + '\n', 'utf8');
    }
  } catch { /* treat as missing */ }

  // Merge: user extensions first, then PC servers (PC wins on conflict).
  // Skip any PC server names accidentally placed in pixelcity.mcp.json.
  const merged: Record<string, any> = {};
  for (const [name, entry] of Object.entries(userServers)) {
    if (ALL_PC_SERVER_NAMES.has(name)) continue;
    merged[name] = entry;
  }
  Object.assign(merged, pcServers);

  // Write .mcp.json — fully overwritten each time. Bytes are dev/prod invariant.
  const mcpPath = path.join(projectDir, '.mcp.json');
  const mcpContent = JSON.stringify({ mcpServers: merged }, null, 2) + '\n';
  fs.writeFileSync(mcpPath, mcpContent, 'utf8');

  // Mirror to <projectDir>/.pixelcity/codex/config.toml — CodexCliProvider sets
  // CODEX_HOME to this path, so codex picks up the same MCP servers as Claude.
  // File is fully overwritten; user extensions belong in
  // pixelcity.mcp.json (already merged into `merged` above).
  const codexHome = path.join(projectDir, '.pixelcity', 'codex');
  const codexConfigPath = path.join(codexHome, 'config.toml');
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(codexConfigPath, buildCodexConfigToml(merged, projectDir), 'utf8');
}

function ensureMcpConfig(projectDir: string): void {
  const pcServers = buildPixelCityServerEntries();
  writeMcpConfigs(projectDir, pcServers);
}

// ── Building directory mappings (machine-local) ───────────────────

function getBuildingDirsPath(): string {
  return path.join(os.homedir(), '.pixelcity', 'building-dirs.json');
}

function readBuildingDirs(): Record<string, string> {
  const p = getBuildingDirsPath();
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { /* ignore */ }
  return {};
}

function writeBuildingDirs(data: Record<string, string>) {
  const p = getBuildingDirsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

export function register(ipcMain: IpcMain) {
  ipcMain.handle('config-load', (_event, { projectDir } = {} as any) => {
    return { success: true, config: readConfig(projectDir) };
  });

  ipcMain.handle('resolve-instructions', (_event, { cityInstructions, officeInstructions, canvasPreferences }: any) => {
    return {
      cityInstructions: resolveInstructionText(cityInstructions),
      officeInstructions: resolveInstructionText(officeInstructions),
      canvasPreferences: resolveInstructionText(canvasPreferences),
    };
  });

  ipcMain.handle('ensure-mcp-config', (_event, { projectDir }: any) => {
    try {
      if (!projectDir) return { success: true };
      ensureMcpConfig(projectDir);
      return { success: true };
    } catch (err: any) {
      console.error('[configHandlers] ensureMcpConfig failed for', projectDir, err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('config-save', (_event, { config, projectDir }: any) => {
    try {
      writeConfig(projectDir, config);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── Office instructions (single .md file) ─────────────────────
  ipcMain.handle('office-instructions-load', (_event, { projectDir }: any = {}) => {
    const filePath = getOfficeInstructionsPath(projectDir);
    return { success: true, content: readOfficeInstructionsFile(projectDir), path: filePath };
  });

  ipcMain.handle('office-instructions-save', (_event, { projectDir, content }: any) => {
    try {
      const filePath = writeOfficeInstructionsFile(projectDir, typeof content === 'string' ? content : '');
      return { success: true, path: filePath };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('office-instructions-open', async (_event, { projectDir }: any = {}) => {
    try {
      const filePath = getOfficeInstructionsPath(projectDir);
      // Ensure the file exists so the OS editor has something to open.
      if (!fs.existsSync(filePath)) writeOfficeInstructionsFile(projectDir, '');
      const error = await shell.openPath(filePath);
      if (error) return { success: false, error };
      return { success: true, path: filePath };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── City configuration (single .md file in ~/.pixelcity) ─────
  ipcMain.handle('city-configuration-load', () => {
    const filePath = getCityConfigurationPath();
    return { success: true, content: readCityConfigurationFile(), path: filePath };
  });

  ipcMain.handle('city-configuration-save', (_event, { content }: any) => {
    try {
      const filePath = writeCityConfigurationFile(typeof content === 'string' ? content : '');
      return { success: true, path: filePath };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── Canvas preferences (single .md file in ~/.pixelcity) ─────
  ipcMain.handle('canvas-preferences-load', () => {
    const filePath = getCanvasPreferencesPath();
    return { success: true, content: readCanvasPreferencesFile(), path: filePath };
  });

  ipcMain.handle('canvas-preferences-save', (_event, { content }: any) => {
    try {
      const filePath = writeCanvasPreferencesFile(typeof content === 'string' ? content : '');
      return { success: true, path: filePath };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Read level 1 memories for a permanent employee (for system prompt injection)
  ipcMain.handle('memory-read-level1', (_event, { projectDir, employeeId }: any) => {
    if (!projectDir || !employeeId) return { success: true, memories: [] };
    const memPath = path.join(projectDir, '.pixelcity', 'memory', employeeId, 'level-1.json');
    try {
      if (!fs.existsSync(memPath)) return { success: true, memories: [] };
      const memories = JSON.parse(fs.readFileSync(memPath, 'utf8'));
      return { success: true, memories };
    } catch {
      return { success: true, memories: [] };
    }
  });

  // Auto-load mempalace wake-up context for a permanent employee (status + diary + recent drawers)
  // Reads directly from the SQLite database (no Python dependency)
  ipcMain.handle('mempalace-read-wakeup', async (_event, { projectDir, employeeId }: any) => {
    if (!projectDir || !employeeId) return { success: true, status: null, diary: [], recent_drawers: [] };

    const palacePath = path.join(projectDir, '.pixelcity', 'mempalace');
    const dbPath = path.join(palacePath, 'drawers.sqlite3');
    if (!fs.existsSync(dbPath)) {
      return { success: true, status: null, diary: [], recent_drawers: [] };
    }

    const wingName = `wing_${employeeId.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });

      // 1. Palace status (drawer count per wing)
      const totalRow = db.prepare('SELECT COUNT(*) as cnt FROM drawers').get() as any;
      const wingRows = db.prepare('SELECT wing, COUNT(*) as cnt FROM drawers GROUP BY wing').all() as any[];
      const wings: Record<string, number> = {};
      for (const r of wingRows) wings[r.wing] = r.cnt;
      const status = { total_drawers: totalRow?.cnt ?? 0, wings };

      // 2. Recent diary entries for this employee
      const diaryRows = db.prepare(
        'SELECT content, date, topic, filed_at FROM drawers WHERE wing = ? AND room = ? ORDER BY filed_at DESC LIMIT 5'
      ).all(wingName, 'diary') as any[];
      const diary = diaryRows.map((r: any) => ({
        date: r.date || '',
        topic: r.topic || '',
        content: r.content || '',
      }));

      // 3. Recent drawers in this employee's wing (non-diary, last 10)
      const recentRows = db.prepare(
        'SELECT content, room, filed_at FROM drawers WHERE wing = ? AND room != ? ORDER BY filed_at DESC LIMIT 10'
      ).all(wingName, 'diary') as any[];
      const recent_drawers = recentRows.map((r: any) => ({
        room: r.room || '',
        filed_at: r.filed_at || '',
        content: (r.content || '').slice(0, 200),
      }));

      db.close();
      return { success: true, status, diary, recent_drawers };
    } catch (err) {
      console.warn('[mempalace-read-wakeup] Failed:', err instanceof Error ? err.message : err);
      return { success: true, status: null, diary: [], recent_drawers: [] };
    }
  });

  // ── Building directory mappings (machine-local) ──────────────────

  ipcMain.handle('building-dirs-load', () => {
    return { success: true, dirs: readBuildingDirs() };
  });

  ipcMain.handle('building-dirs-set', (_event, { buildingUid, workingDir }: any) => {
    try {
      const dirs = readBuildingDirs();
      dirs[buildingUid] = workingDir;
      writeBuildingDirs(dirs);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('building-dirs-remove', (_event, { buildingUid }: any) => {
    try {
      const dirs = readBuildingDirs();
      delete dirs[buildingUid];
      writeBuildingDirs(dirs);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('building-dir-exists', (_event, { dirPath }: any) => {
    try {
      return { exists: fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory() };
    } catch {
      return { exists: false };
    }
  });
}
