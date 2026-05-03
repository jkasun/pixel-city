/**
 * Maintains this Pixel City instance's MCP integration footprint:
 *  - copies `mcp-server/launcher.cjs` to `~/.pixelcity/mcp-launcher.cjs`
 *    (idempotent; bytes are identical between dev and prod copies)
 *  - writes `~/.pixelcity/instances/<mode>.json` describing how this
 *    instance wants its MCP servers spawned (port, server dir, mempalace)
 *  - removes its own descriptor on app quit so stale instances disappear
 *
 * The launcher reads the descriptors at spawn time and dispatches to
 * whichever instance is alive.
 */

import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'

const MODE: 'dev' | 'prod' = app.isPackaged ? 'prod' : 'dev'
const HOME = os.homedir()
const PIXELCITY_DIR = path.join(HOME, '.pixelcity')
const INSTANCES_DIR = path.join(PIXELCITY_DIR, 'instances')
const LAUNCHER_PATH = path.join(PIXELCITY_DIR, 'mcp-launcher.cjs')

export function getLauncherPath(): string {
  return LAUNCHER_PATH
}

export function getInstanceMode(): 'dev' | 'prod' {
  return MODE
}

export function getMcpRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'mcp-server')
  }
  // dev: __dirname is dist/electron/main; mcp-server is 4 levels up at repo root
  return path.resolve(__dirname, '..', '..', '..', '..', 'mcp-server')
}

function getMempalaceEntry(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'mempalace-mcp-server', 'dist', 'index.mjs')
  }
  // dev: bundled by `npm run dev:mempalace` to dist/mempalace-mcp-server/index.mjs
  return path.resolve(__dirname, '..', '..', 'mempalace-mcp-server', 'index.mjs')
}

function copyLauncher() {
  fs.mkdirSync(PIXELCITY_DIR, { recursive: true })
  const src = path.join(getMcpRoot(), 'launcher.cjs')
  if (!fs.existsSync(src)) {
    console.warn('[mcpInstance] launcher.cjs not found at', src)
    return
  }
  const desired = fs.readFileSync(src, 'utf8')
  let current: string | null = null
  try {
    if (fs.existsSync(LAUNCHER_PATH)) current = fs.readFileSync(LAUNCHER_PATH, 'utf8')
  } catch { /* treat as absent */ }
  if (current !== desired) {
    fs.writeFileSync(LAUNCHER_PATH, desired, { encoding: 'utf8', mode: 0o755 })
  } else {
    // Make sure the executable bit survived a previous bad write
    try { fs.chmodSync(LAUNCHER_PATH, 0o755) } catch { /* best-effort */ }
  }
}

export interface InstanceDescriptor {
  mode: 'dev' | 'prod'
  pid: number
  port: number
  wsUrl: string
  serverDir: string
  ext: '.js' | '.cjs'
  registryPath: string
  mempalace: {
    command: string
    entry: string
    useElectronRunAsNode: boolean
  }
}

function buildDescriptor(): InstanceDescriptor {
  const mcpRoot = getMcpRoot()
  const port = app.isPackaged ? 19841 : 19840
  return {
    mode: MODE,
    pid: process.pid,
    port,
    wsUrl: `ws://localhost:${port}`,
    serverDir: path.join(mcpRoot, 'servers'),
    ext: app.isPackaged ? '.cjs' : '.js',
    registryPath: path.join(mcpRoot, 'registry.json'),
    mempalace: {
      command: process.execPath,
      entry: getMempalaceEntry(),
      useElectronRunAsNode: true,
    },
  }
}

function descriptorPath(): string {
  return path.join(INSTANCES_DIR, `${MODE}.json`)
}

function writeDescriptor() {
  fs.mkdirSync(INSTANCES_DIR, { recursive: true })
  const descriptor = buildDescriptor()
  fs.writeFileSync(descriptorPath(), JSON.stringify(descriptor, null, 2) + '\n', 'utf8')
}

function removeDescriptor() {
  try {
    if (fs.existsSync(descriptorPath())) fs.unlinkSync(descriptorPath())
  } catch (err) {
    console.warn('[mcpInstance] failed to remove descriptor:', (err as Error).message)
  }
}

export function installMcpInstance() {
  copyLauncher()
  writeDescriptor()
}

export function teardownMcpInstance() {
  removeDescriptor()
}
