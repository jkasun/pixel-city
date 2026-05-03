#!/usr/bin/env node
/**
 * Pixel City MCP launcher.
 *
 * One launcher script invoked by every entry in `.mcp.json`. The committed
 * `.mcp.json` content is identical between dev and prod (bytes match), so two
 * Pixel City instances writing the same file never produce a conflict.
 *
 * At spawn time the launcher resolves which Pixel City instance to dispatch
 * to:
 *   1. If `PIXEL_CITY_INSTANCE` env is set, use that instance descriptor.
 *   2. Else read all `~/.pixelcity/instances/*.json` and pick the first whose
 *      port answers a TCP probe. Stale descriptors (app crashed) are skipped
 *      because their port won't answer.
 *
 * Then it execs the actual MCP server file from the chosen instance's
 * `serverDir` and forwards stdio.
 *
 * Argv: [node, launcher.cjs, <server-name>]
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const os = require('os');
const cp = require('child_process');

const serverName = process.argv[2];
if (!serverName) {
  console.error('[mcp-launcher] missing server name argument');
  process.exit(1);
}

const HOME = os.homedir();
const INSTANCES_DIR = path.join(HOME, '.pixelcity', 'instances');

function readInstances() {
  if (!fs.existsSync(INSTANCES_DIR)) return [];
  const files = fs.readdirSync(INSTANCES_DIR).filter(f => f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(INSTANCES_DIR, f), 'utf8')));
    } catch {
      // skip bad descriptor
    }
  }
  return out;
}

function probePort(port, timeoutMs) {
  return new Promise(resolve => {
    const sock = net.connect(port, '127.0.0.1');
    let done = false;
    const finish = ok => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch (_) { /* ignore */ }
      resolve(ok);
    };
    sock.once('connect', () => finish(true));
    sock.once('error', () => finish(false));
    sock.setTimeout(timeoutMs, () => finish(false));
  });
}

async function pickInstance() {
  const override = process.env.PIXEL_CITY_INSTANCE;
  if (override) {
    const target = path.join(INSTANCES_DIR, `${override}.json`);
    if (fs.existsSync(target)) {
      try { return JSON.parse(fs.readFileSync(target, 'utf8')); } catch { /* fall through */ }
    }
  }
  const instances = readInstances();
  for (const inst of instances) {
    if (await probePort(inst.port, 250)) return inst;
  }
  return null;
}

function buildSpawn(serverName, inst) {
  const env = { ...process.env };

  if (serverName === 'pixelcity-mempalace') {
    if (!inst.mempalace) {
      throw new Error('instance descriptor missing mempalace block');
    }
    const palacePath = path.join(process.cwd(), '.pixelcity', 'mempalace');
    fs.mkdirSync(palacePath, { recursive: true });
    env.MEMPALACE_PALACE_PATH = palacePath;
    env.MEMPALACE_CONFIG_DIR = palacePath;
    if (inst.mempalace.useElectronRunAsNode) env.ELECTRON_RUN_AS_NODE = '1';
    return { command: inst.mempalace.command, args: [inst.mempalace.entry], env };
  }

  const registry = JSON.parse(fs.readFileSync(inst.registryPath, 'utf8'));
  const entry = registry.servers.find(s => s.name === serverName);
  if (!entry) throw new Error(`server "${serverName}" not in registry ${inst.registryPath}`);

  const serverPath = path.join(inst.serverDir, entry.file + inst.ext);
  if (!fs.existsSync(serverPath)) throw new Error(`server file not found: ${serverPath}`);

  env.PIXEL_CITY_WS_URL = inst.wsUrl;
  if (serverName === 'pixel-city-messages') env.SERVER_MODE = 'messages';
  if (serverName === 'pixel-city-meetings') env.SERVER_MODE = 'meetings';

  // process.execPath is the node binary that's running this launcher.
  // Plain MCP servers run under it. Mempalace overrides via descriptor.
  return { command: process.execPath, args: [serverPath], env };
}

(async () => {
  let inst;
  try {
    inst = await pickInstance();
  } catch (err) {
    console.error('[mcp-launcher] failed to pick instance:', err && err.message);
    process.exit(2);
  }
  if (!inst) {
    console.error('[mcp-launcher] no live Pixel City instance found (no descriptor responding on its port)');
    process.exit(2);
  }

  let spec;
  try {
    spec = buildSpawn(serverName, inst);
  } catch (err) {
    console.error(`[mcp-launcher] ${err.message}`);
    process.exit(3);
  }

  const child = cp.spawn(spec.command, spec.args, { env: spec.env, stdio: 'inherit' });
  child.on('error', err => {
    console.error('[mcp-launcher] spawn failed:', err.message);
    process.exit(5);
  });
  child.on('exit', code => process.exit(code == null ? 0 : code));
})();
