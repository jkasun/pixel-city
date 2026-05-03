// ── Electron Platform Bridge ────────────────────────────────────────
// Wraps Electron's ipcRenderer calls behind the PlatformBridge
// interface. This is the desktop implementation — the web-app will
// have its own implementation using WebSocket RPC.

import type {
  PlatformBridge,
  ConfigBridge,
  DialogBridge,
  SettingsBridge,
  AuthBridge,
  NotificationBridge,
  AppBridge,
  BuildingBridge,
  WorkspaceBridge,
  UsageBridge,
  PtyBridge,
  FileSystemBridge,
  FileFilter,
} from './types.js'

// Lazily resolve ipcRenderer so this module can be imported without
// immediately requiring Electron (useful for tests / SSR checks).
function ipc() {
  return window.require('electron').ipcRenderer
}

// ── Config ──────────────────────────────────────────────────────────

const config: ConfigBridge = {
  async load(projectDir) {
    return ipc().invoke('config-load', { projectDir }) as Promise<Record<string, unknown>>
  },
  async save(projectDir, cfg) {
    await ipc().invoke('config-save', { projectDir, config: cfg })
  },
  async resolveInstructions(projectDir, context) {
    return ipc().invoke('resolve-instructions', { projectDir, context }) as Promise<string>
  },
  async readMemory(employeeId) {
    return ipc().invoke('memory-read-level1', { employeeId }) as Promise<string>
  },
  async readMempalace(projectDir, employeeId) {
    return ipc().invoke('mempalace-read-wakeup', { projectDir, employeeId }) as any
  },
  async loadOfficeInstructions(projectDir) {
    const result = await ipc().invoke('office-instructions-load', { projectDir }) as any
    return { content: result?.content ?? '', path: result?.path ?? '' }
  },
  async saveOfficeInstructions(projectDir, content) {
    const result = await ipc().invoke('office-instructions-save', { projectDir, content }) as any
    if (result && !result.success) throw new Error(result.error || 'Failed to save office instructions')
    return { path: result?.path ?? '' }
  },
  async openOfficeInstructionsFile(projectDir) {
    const result = await ipc().invoke('office-instructions-open', { projectDir }) as any
    if (result && !result.success) throw new Error(result.error || 'Failed to open office instructions file')
    return { path: result?.path ?? '' }
  },
  async loadCityConfiguration() {
    const result = await ipc().invoke('city-configuration-load') as any
    return { content: result?.content ?? '', path: result?.path ?? '' }
  },
  async saveCityConfiguration(content) {
    const result = await ipc().invoke('city-configuration-save', { content }) as any
    if (result && !result.success) throw new Error(result.error || 'Failed to save city configuration')
    return { path: result?.path ?? '' }
  },
  async loadCanvasPreferences() {
    const result = await ipc().invoke('canvas-preferences-load') as any
    return { content: result?.content ?? '', path: result?.path ?? '' }
  },
  async saveCanvasPreferences(content) {
    const result = await ipc().invoke('canvas-preferences-save', { content }) as any
    if (result && !result.success) throw new Error(result.error || 'Failed to save canvas preferences')
    return { path: result?.path ?? '' }
  },
}

// ── Dialog ──────────────────────────────────────────────────────────

const dialog: DialogBridge = {
  async openFolder() {
    return ipc().invoke('open-folder-dialog') as Promise<string | null>
  },
  async openFile(opts?: { title?: string; filters?: FileFilter[] }) {
    return ipc().invoke('open-file-dialog', opts ?? {}) as Promise<string | null>
  },
}

// ── Settings ────────────────────────────────────────────────────────

const settings: SettingsBridge = {
  update(s) {
    ipc().send('settings-changed', s)
  },
  onChange(cb) {
    const handler = (_event: unknown, data: Record<string, unknown>) => cb(data)
    ipc().on('settings-changed', handler)
    return () => { ipc().removeListener('settings-changed', handler) }
  },
}

// ── Auth ─────────────────────────────────────────────────────────────

const auth: AuthBridge = {
  async startOAuth(url) {
    return ipc().invoke('start-oauth', url) as Promise<Record<string, string>>
  },
  onAuthCallback(cb) {
    const handler = (_event: unknown, data: Record<string, string>) => cb(data)
    ipc().on('auth-callback', handler)
    return () => { ipc().removeListener('auth-callback', handler) }
  },
}

// ── Notifications ───────────────────────────────────────────────────

const notification: NotificationBridge = {
  async send(title, body) {
    await ipc().invoke('send-notification', { title, body })
  },
}

// ── App ─────────────────────────────────────────────────────────────

const app: AppBridge = {
  async getVersion() {
    return ipc().invoke('get-app-version') as Promise<string>
  },
  async openExternal(url) {
    await ipc().invoke('open-external', url)
  },
  async openSettings() {
    await ipc().invoke('open-settings-window')
  },
  async focusMain() {
    await ipc().invoke('focus-main-webcontents')
  },
  async checkCommandExists(command) {
    return ipc().invoke('check-command-exists', { command }) as Promise<boolean>
  },
}

// ── Building ────────────────────────────────────────────────────────

const building: BuildingBridge = {
  async loadDirs() {
    return ipc().invoke('building-dirs-load') as Promise<Record<string, string>>
  },
  async setDir(buildingUid, workingDir) {
    await ipc().invoke('building-dirs-set', { buildingUid, workingDir })
  },
  async removeDir(buildingUid) {
    await ipc().invoke('building-dirs-remove', { buildingUid })
  },
  async dirExists(dirPath) {
    return ipc().invoke('building-dir-exists', { dirPath }) as Promise<boolean>
  },
}

// ── Workspace ───────────────────────────────────────────────────────

const workspace: WorkspaceBridge = {
  async ensureMcpConfig(projectDir) {
    const result = await ipc().invoke('ensure-mcp-config', { projectDir })
    if (result && !result.success) {
      console.error('[electron.ts] ensureMcpConfig failed:', result.error)
      throw new Error(result.error)
    }
  },
}

// ── Usage ───────────────────────────────────────────────────────────

const usage: UsageBridge = {
  async getStats() {
    return ipc().invoke('claude-usage-stats') as Promise<Record<string, unknown>>
  },
  async getPlan(opts) {
    return ipc().invoke('claude-usage-plan', opts ?? {}) as Promise<Record<string, unknown>>
  },
}

// ── PTY ─────────────────────────────────────────────────────────────

const pty: PtyBridge = {
  async create(opts) {
    return ipc().invoke('pty-create', opts) as Promise<number>
  },
  input(ptyId, data) {
    ipc().send('pty-input', { id: ptyId, data })
  },
  resize(ptyId, cols, rows) {
    ipc().send('pty-resize', { id: ptyId, cols, rows })
  },
  kill(ptyId) {
    ipc().send('pty-kill', { id: ptyId })
  },
  onOutput(ptyId, cb) {
    const handler = (_event: unknown, payload: { id: number; data: string }) => {
      if (payload.id === ptyId) cb(payload.data)
    }
    ipc().on('pty-output', handler)
    return () => { ipc().removeListener('pty-output', handler) }
  },
  onExit(ptyId, cb) {
    const handler = (_event: unknown, payload: { id: number; exitCode: number }) => {
      if (payload.id === ptyId) cb(payload.exitCode)
    }
    ipc().on('pty-exit', handler)
    return () => { ipc().removeListener('pty-exit', handler) }
  },
}

// ── File System (desktop — uses Node.js fs directly) ───────────────

const nodeFs = window.require('fs') as typeof import('fs')
const nodePath = window.require('path') as typeof import('path')
const nodeChildProcess = window.require('child_process') as typeof import('child_process')
const { shell: nodeShell, clipboard: nodeClipboard } = window.require('electron') as typeof import('electron')

const fsb: FileSystemBridge = {
  async list(dirPath, opts) {
    const entries = nodeFs.readdirSync(dirPath, { withFileTypes: true })
    const result = entries
      .filter(e => opts?.showHidden || !e.name.startsWith('.'))
      .map(entry => {
        const fullPath = nodePath.join(dirPath, entry.name)
        // statSync follows symlinks; use it so symlinked dirs classify as folders.
        let isDirectory = entry.isDirectory()
        let size = 0, modified = 0
        try {
          const stat = nodeFs.statSync(fullPath)
          isDirectory = stat.isDirectory()
          size = stat.size
          modified = stat.mtimeMs
        } catch {}
        return {
          name: entry.name,
          path: fullPath,
          isDirectory,
          isSymlink: entry.isSymbolicLink(),
          size,
          modified,
        }
      })
      .sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1
        if (!a.isDirectory && b.isDirectory) return 1
        return a.name.localeCompare(b.name)
      })
    return { path: dirPath, entries: result }
  },
  async readFile(filePath) {
    const content = nodeFs.readFileSync(filePath, 'utf-8')
    const stat = nodeFs.statSync(filePath)
    return { content, size: stat.size }
  },
  async writeFile(filePath, content) {
    nodeFs.writeFileSync(filePath, content, 'utf-8')
  },
  async create(targetPath, isDirectory) {
    if (isDirectory) {
      nodeFs.mkdirSync(targetPath, { recursive: true })
    } else {
      nodeFs.writeFileSync(targetPath, '', 'utf-8')
    }
  },
  async delete(targetPath) {
    nodeFs.rmSync(targetPath, { recursive: true, force: true })
  },
  async rename(oldPath, newPath) {
    nodeFs.renameSync(oldPath, newPath)
  },
  async stat(targetPath) {
    const stat = nodeFs.statSync(targetPath)
    return {
      name: nodePath.basename(targetPath),
      path: targetPath,
      isDirectory: stat.isDirectory(),
      isSymlink: stat.isSymbolicLink(),
      size: stat.size,
      modified: stat.mtimeMs,
    }
  },
  async gitStatus(cwd) {
    return new Promise((resolve) => {
      nodeChildProcess.execFile('git', ['status', '--porcelain', '-uall'], { cwd, timeout: 5000 }, (err, stdout) => {
        if (err) { resolve([]); return }
        const lines = stdout.trim().split('\n').filter(Boolean)
        resolve(lines.map(l => ({ status: l.substring(0, 2).trim(), path: l.substring(3) })))
      })
    })
  },
  async gitFiles(cwd) {
    return new Promise((resolve) => {
      nodeChildProcess.execFile('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd, timeout: 10000 }, (err, stdout) => {
        if (err) { resolve([]); return }
        resolve(stdout.trim().split('\n').filter(Boolean))
      })
    })
  },
  async gitBranch(cwd) {
    try {
      return nodeChildProcess.execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 3000, encoding: 'utf8' }).trim()
    } catch { return null }
  },
  watch(dirPath, cb) {
    try {
      nodeFs.mkdirSync(dirPath, { recursive: true })
      const watcher = nodeFs.watch(dirPath, { recursive: true }, (eventType, filename) => {
        if (filename) cb(eventType, filename)
      })
      return () => watcher.close()
    } catch {
      return () => {}
    }
  },
  copyToClipboard(text) {
    nodeClipboard.writeText(text)
  },
  revealInFileManager(filePath) {
    nodeShell.showItemInFolder(filePath)
  },
}

// ── Export ───────────────────────────────────────────────────────────

export const electronBridge: PlatformBridge = {
  config,
  dialog,
  settings,
  auth,
  notification,
  app,
  building,
  workspace,
  usage,
  pty,
  fs: fsb,
}
