const fs = window.require('fs') as typeof import('fs')
const osModule = window.require('os') as typeof import('os')
const pathModule = window.require('path') as typeof import('path')

// ── Layout persistence ────────────────────────────────────────────

const PIXELCITY_DIR = pathModule.join(osModule.homedir(), '.pixelcity')
const SETTINGS_PATH = pathModule.join(PIXELCITY_DIR, 'settings.json')

export interface LayoutSizes {
  main?: [number, number]
  inner?: [number, number]
  debug?: [number, number]
}

export interface TerminalSettings {
  fontSize: number
  fontFamily: string
  lineHeight: number
  cursorStyle: 'bar' | 'block' | 'underline'
  cursorBlink: boolean
  scrollback: number
}

export interface EditorSettings {
  fontSize: number
  fontFamily: string
  minimap: boolean
  wordWrap: 'off' | 'on' | 'wordWrapColumn'
  tabSize: number
  lineNumbers: 'on' | 'off' | 'relative'
  renderWhitespace: 'none' | 'boundary' | 'selection' | 'all'
  bracketPairColorization: boolean
}

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  fontSize: 13,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  minimap: true,
  wordWrap: 'off',
  tabSize: 2,
  lineNumbers: 'on',
  renderWhitespace: 'selection',
  bracketPairColorization: true,
}

export interface NotificationSettings {
  onTaskClosed: boolean
  onTaskTesting: boolean
  onTaskProgress: boolean
  onTaskTodo: boolean
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  onTaskClosed: true,
  onTaskTesting: true,
  onTaskProgress: true,
  onTaskTodo: false,
}

/** Map column keys to their notification setting key */
export const COLUMN_NOTIFICATION_MAP: Record<string, keyof NotificationSettings> = {
  closed: 'onTaskClosed',
  testing: 'onTaskTesting',
  progress: 'onTaskProgress',
  todo: 'onTaskTodo',
}

/** Column display labels for notification UI */
export const NOTIFICATION_COLUMNS = [
  { key: 'onTaskClosed', label: 'When task is closed' },
  { key: 'onTaskTesting', label: 'When task moves to testing' },
  { key: 'onTaskProgress', label: 'When task moves to in progress' },
  { key: 'onTaskTodo', label: 'When task moves to todo' },
] as const

export interface Settings {
  layoutSizes?: LayoutSizes
  recentProjects?: string[]
  terminalSettings?: Partial<TerminalSettings>
  editorSettings?: Partial<EditorSettings>
  notificationSettings?: Partial<NotificationSettings>
  /** Global default Claude config directory (e.g. ~/.claude). Per-project overrides take priority. */
  claudeConfigDir?: string
}

export const DEFAULT_SETTINGS: TerminalSettings = {
  fontSize: 12,
  fontFamily: "'JetBrains Mono', monospace",
  lineHeight: 1.0,
  cursorStyle: 'bar',
  cursorBlink: true,
  scrollback: 5000,
}

export const FONT_OPTIONS = [
  { label: 'JetBrains Mono', value: "'JetBrains Mono', monospace" },
  { label: 'SF Mono',        value: "'SF Mono', monospace" },
  { label: 'Menlo',          value: "Menlo, monospace" },
  { label: 'Courier New',    value: "'Courier New', monospace" },
  { label: 'System Mono',    value: 'monospace' },
]

export function loadPixelCitySettings(): Settings {
  try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) } catch { return {} }
}

export function savePixelCitySettings(patch: Settings) {
  try {
    if (!fs.existsSync(PIXELCITY_DIR)) fs.mkdirSync(PIXELCITY_DIR, { recursive: true })
    const prev = loadPixelCitySettings()
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ ...prev, ...patch }, null, 2), 'utf8')
  } catch { /* ignore write errors */ }
}

export function loadLayoutSizes(): LayoutSizes {
  return loadPixelCitySettings().layoutSizes ?? {}
}

export function saveLayoutSizes(patch: Partial<LayoutSizes>) {
  const prev = loadLayoutSizes()
  savePixelCitySettings({ layoutSizes: { ...prev, ...patch } })
}

// ── Recent projects ──────────────────────────────────────────────

export function loadRecentProjects(): string[] {
  return loadPixelCitySettings().recentProjects ?? []
}

export function saveRecentProject(cwd: string) {
  const prev = loadRecentProjects()
  const next = [cwd, ...prev.filter(p => p !== cwd)].slice(0, 5)
  savePixelCitySettings({ recentProjects: next })
}

// ── Terminal settings ────────────────────────────────────────────

export function loadSettings(): TerminalSettings {
  const saved = loadPixelCitySettings().terminalSettings
  return saved ? { ...DEFAULT_SETTINGS, ...saved } : DEFAULT_SETTINGS
}

// ── Editor settings ─────────────────────────────────────────────

export function loadEditorSettings(): EditorSettings {
  const saved = loadPixelCitySettings().editorSettings
  return saved ? { ...DEFAULT_EDITOR_SETTINGS, ...saved } : DEFAULT_EDITOR_SETTINGS
}

export function saveEditorSettings(patch: Partial<EditorSettings>) {
  const prev = loadEditorSettings()
  savePixelCitySettings({ editorSettings: { ...prev, ...patch } })
}

// ── Notification settings ───────────────────────────────────────

export function loadNotificationSettings(): NotificationSettings {
  const saved = loadPixelCitySettings().notificationSettings
  return saved ? { ...DEFAULT_NOTIFICATION_SETTINGS, ...saved } : DEFAULT_NOTIFICATION_SETTINGS
}

export function saveNotificationSettings(patch: Partial<NotificationSettings>) {
  const prev = loadNotificationSettings()
  savePixelCitySettings({ notificationSettings: { ...prev, ...patch } })
}

// ── Project hash ─────────────────────────────────────────────────

export function computeProjectHash(cwd: string): string {
  return cwd.replace(/[:/\\]/g, '-')
}

// ── Utility ──────────────────────────────────────────────────────

export function projectBasename(p: string): string {
  return p.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? p
}
