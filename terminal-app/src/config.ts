/**
 * Central configuration loader.
 *
 * Reads config.yml from the app root and provides typed access.
 * Works in both main and renderer processes.
 *
 * Usage:
 *   import { config } from './config'
 *   config.pubsub.ws.url  // 'ws://localhost:19850'
 *   config.messages.pollIntervalMs  // 30000
 */

// Use window.require in renderer (Vite externalizes Node built-ins),
// fall back to regular require/import in main process.
const _fs = (typeof window !== 'undefined' && (window as any).require)
  ? (window as any).require('fs') as typeof import('fs')
  : require('fs') as typeof import('fs')
const _path = (typeof window !== 'undefined' && (window as any).require)
  ? (window as any).require('path') as typeof import('path')
  : require('path') as typeof import('path')
import { load as yamlLoad } from 'js-yaml'

// ── Config Shape ──────────────────────────────────────────

export interface AppConfig {
  pubsub: {
    ws: {
      url: string
    }
  }
  ports: {
    mcpWs: number
    testWs: number
    pubsubWs: number
  }
  messages: {
    pollIntervalMs: number
  }
  tts: {
    url: string
    model: string
    modelVc: string
    maxCharsPerChunk: number
    defaultRate: number
    maxRetries: number
    cacheAhead: number
    maxConcurrentFetch: number
    maxCacheSize: number
  }
  mcp: {
    defaultToolTimeoutMs: number
    initTimeoutMs: number
    requestTimeoutMs: number
    screenshotTimeoutMs: number
    waitTimeoutMs: number
    connectTimeoutMs: number
    maxReconnectDelayMs: number
  }
  terminal: {
    defaultScrollback: number
    shellEnvTimeoutMs: number
    maxBufferBytes: number
  }
  jsonlWatch: {
    subagentDirPollMs: number
    subagentFilePollMs: number
    subagentIdleSafetyNetMs: number
    subagentEndTurnGraceMs: number
  }
  llm: {
    maxTokenBudget: number
    keepRecentMessages: number
  }
  browser: {
    defaultUrl: string
  }
  window: {
    width: number
    height: number
    minWidth: number
    minHeight: number
  }
}

// ── Defaults ──────────────────────────────────────────────

const DEFAULTS: AppConfig = {
  pubsub: {
    ws: { url: 'ws://localhost:19850' },
  },
  ports: { mcpWs: 19840, testWs: 19842, pubsubWs: 19850 },
  messages: { pollIntervalMs: 30000 },
  tts: {
    url: 'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    model: 'qwen3-tts-instruct-flash',
    modelVc: 'qwen3-tts-vc-2026-01-22',
    maxCharsPerChunk: 550,
    defaultRate: 1.4,
    maxRetries: 3,
    cacheAhead: 5,
    maxConcurrentFetch: 2,
    maxCacheSize: 50,
  },
  mcp: {
    defaultToolTimeoutMs: 60000,
    initTimeoutMs: 30000,
    requestTimeoutMs: 15000,
    screenshotTimeoutMs: 30000,
    waitTimeoutMs: 30000,
    connectTimeoutMs: 5000,
    maxReconnectDelayMs: 10000,
  },
  terminal: {
    defaultScrollback: 5000,
    shellEnvTimeoutMs: 10000,
    maxBufferBytes: 50 * 1024 * 1024,
  },
  jsonlWatch: {
    subagentDirPollMs: 1500,
    subagentFilePollMs: 2000,
    subagentIdleSafetyNetMs: 120000,
    subagentEndTurnGraceMs: 4000,
  },
  llm: { maxTokenBudget: 50000, keepRecentMessages: 10 },
  browser: { defaultUrl: 'https://www.google.com' },
  window: { width: 1400, height: 700, minWidth: 800, minHeight: 400 },
}

// ── Loader ────────────────────────────────────────────────

function deepMerge<T extends Record<string, any>>(target: T, source: Record<string, any>): T {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    const val = source[key]
    if (val !== null && typeof val === 'object' && !Array.isArray(val) && typeof (target as any)[key] === 'object') {
      (result as any)[key] = deepMerge((target as any)[key], val)
    } else if (val !== undefined) {
      (result as any)[key] = val
    }
  }
  return result
}

function resolveConfigPath(): string {
  // In packaged app, config.yml lives next to the asar
  // In dev, it's at the project root
  try {
    const electron = require('electron')
    const app = electron.app ?? electron.remote?.app
    if (app) {
      const appPath = app.isPackaged
        ? _path.join(app.getAppPath(), '..', 'config.yml')
        : _path.join(app.getAppPath(), 'config.yml')
      return appPath
    }
    // Renderer process: ask the main process for the resolved config path
    const ipcRenderer = electron.ipcRenderer
    if (ipcRenderer) {
      const configPath = ipcRenderer.sendSync('get-config-path') as string
      if (configPath) return configPath
    }
  } catch (_) {}
  // Fallback: try process.cwd() (works in dev when cwd is terminal-app/)
  const cwdPath = _path.join(process.cwd(), 'config.yml')
  try {
    if (_fs.existsSync(cwdPath)) return cwdPath
  } catch (_) {}
  // Last resort: relative to __dirname
  return _path.join(__dirname, '..', 'config.yml')
}

let _config: AppConfig | null = null

export function loadConfig(): AppConfig {
  if (_config) return _config

  try {
    const configPath = resolveConfigPath()
    const raw = _fs.readFileSync(configPath, 'utf8')
    const parsed = yamlLoad(raw) as Record<string, any>
    _config = deepMerge(DEFAULTS, parsed ?? {})
  } catch (err) {
    console.warn('[Config] Failed to load config.yml, using defaults:', (err as Error).message)
    _config = { ...DEFAULTS }
  }

  return _config
}

/** Shorthand — lazily loads and returns the config singleton. */
export const config: AppConfig = new Proxy({} as AppConfig, {
  get(_target, prop) {
    const cfg = loadConfig()
    return (cfg as any)[prop]
  },
})
