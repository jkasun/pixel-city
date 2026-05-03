import type { ITheme } from '@xterm/xterm'

const fs = window.require('fs') as typeof import('fs')
const osModule = window.require('os') as typeof import('os')
const pathModule = window.require('path') as typeof import('path')

// ── Layout persistence ────────────────────────────────────────────

export const PIXELCITY_DIR = pathModule.join(osModule.homedir(), '.pixelcity')
export const SETTINGS_PATH = pathModule.join(PIXELCITY_DIR, 'settings.json')

export interface LayoutSizes {
  main?: [number, number]
  inner?: [number, number]
  debug?: [number, number]
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

export interface SessionState {
  // Navigation (CityContext)
  activeCityId?: string | null
  currentBuildingId?: string | null
  currentRoute?: 'city' | 'building'
  officeViewTab?: string
  sidebarVisible?: boolean
  // World state (WorldContext)
  bottomPanel?: string | null
  activeView?: 'agent' | 'shell'
  activePanelTab?: string
  shellsCollapsed?: boolean
  // File tabs (keyed by project hash)
  fileTabs?: Record<string, {
    openPaths: Array<{ path: string; name: string }>
    activeTabPath: string | null
  }>
  // Active git repo (keyed by project hash)
  activeGitRepo?: Record<string, string>
}

export type ThemeName = 'dark' | 'light' | 'creme' | 'nord' | 'monokai'

export interface Settings {
  layoutSizes?: LayoutSizes
  recentProjects?: string[]
  terminalSettings?: Partial<TerminalSettings>
  editorSettings?: Partial<EditorSettings>
  sessionState?: SessionState
  theme?: ThemeName
  /** Global default Claude config directory (e.g. ~/.claude). Per-building overrides take priority. */
  claudeConfigDir?: string
}

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

/** Wipe the persisted settings file. Used by the top-level ErrorBoundary
 * recovery flow when persisted state has stranded the user on a broken view. */
export function resetPixelCitySettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) fs.unlinkSync(SETTINGS_PATH)
  } catch { /* ignore */ }
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

export function projectBasename(p: string): string {
  return p.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? p
}

// ── Project hash ────────────────────────────────────────────────

export function computeProjectHash(cwd: string): string {
  return cwd.replace(/[:/\\]/g, '-')
}

// ── Session state persistence ────────────────────────────────────

let _sessionSaveTimer: ReturnType<typeof setTimeout> | null = null
let _pendingSessionPatch: Partial<SessionState> = {}

export function saveSessionState(patch: Partial<SessionState>) {
  Object.assign(_pendingSessionPatch, patch)
  if (_sessionSaveTimer) clearTimeout(_sessionSaveTimer)
  _sessionSaveTimer = setTimeout(() => {
    const prev = loadPixelCitySettings()
    const merged = { ...prev.sessionState, ..._pendingSessionPatch }
    savePixelCitySettings({ sessionState: merged })
    _pendingSessionPatch = {}
  }, 500)
}

export function loadSessionState(): SessionState {
  return loadPixelCitySettings().sessionState ?? {}
}

// ── Terminal theme ───────────────────────────────────────────────

export const THEME: ITheme = {
  background: '#0a0a0c',
  foreground: '#c8c5be',
  cursor: '#5c9a7d',
  cursorAccent: '#0a0a0c',
  selectionBackground: 'rgba(92, 154, 125, 0.25)',
  black: '#0a0a0c',
  red: '#c97b7b',
  green: '#5c9a7d',
  yellow: '#c4894a',
  blue: '#6b8fb5',
  magenta: '#a07bb5',
  cyan: '#6ba5a0',
  white: '#c8c5be',
  brightBlack: '#7a7874',
  brightRed: '#d9a0a0',
  brightGreen: '#7dbfa0',
  brightYellow: '#d9a87a',
  brightBlue: '#8ab0d0',
  brightMagenta: '#b99fd0',
  brightCyan: '#8ac5c0',
  brightWhite: '#eae7e0',
}

export const THEME_DARK: ITheme = {
  background: '#0a0a0c',
  foreground: '#c8c5be',
  cursor: '#5c9a7d',
  cursorAccent: '#0a0a0c',
  selectionBackground: 'rgba(92, 154, 125, 0.25)',
  black: '#0a0a0c',
  red: '#c97b7b',
  green: '#5c9a7d',
  yellow: '#c4894a',
  blue: '#6b8fb5',
  magenta: '#a07bb5',
  cyan: '#6ba5a0',
  white: '#c8c5be',
  brightBlack: '#7a7874',
  brightRed: '#d9a0a0',
  brightGreen: '#7dbfa0',
  brightYellow: '#d9a87a',
  brightBlue: '#8ab0d0',
  brightMagenta: '#b99fd0',
  brightCyan: '#8ac5c0',
  brightWhite: '#eae7e0',
}

export const THEME_LIGHT: ITheme = {
  background: '#f5f5f7',
  foreground: '#3a3a3c',
  cursor: '#4a8c6f',
  cursorAccent: '#f5f5f7',
  selectionBackground: 'rgba(74, 140, 111, 0.2)',
  black: '#3a3a3c',
  red: '#c44e4e',
  green: '#4a8c6f',
  yellow: '#b8860b',
  blue: '#4a76a8',
  magenta: '#8b5ea7',
  cyan: '#4a9a95',
  white: '#f5f5f7',
  brightBlack: '#8e8e93',
  brightRed: '#d96c6c',
  brightGreen: '#5fa888',
  brightYellow: '#d4a025',
  brightBlue: '#6b93bf',
  brightMagenta: '#a87dc0',
  brightCyan: '#6bb5b0',
  brightWhite: '#1d1d1f',
}

export const THEME_CREME: ITheme = {
  background: '#FFF7D0',
  foreground: '#5a4a30',
  cursor: '#c08a40',
  cursorAccent: '#FFF7D0',
  selectionBackground: 'rgba(192, 138, 64, 0.2)',
  black: '#5a4a30',
  red: '#a04030',
  green: '#5a7a2e',
  yellow: '#a07030',
  blue: '#3a6a8a',
  magenta: '#7a4a6a',
  cyan: '#3a7a6a',
  white: '#FFF7D0',
  brightBlack: '#7a6a4a',
  brightRed: '#b85040',
  brightGreen: '#6a8a3a',
  brightYellow: '#b89040',
  brightBlue: '#4a80a0',
  brightMagenta: '#906080',
  brightCyan: '#4a9080',
  brightWhite: '#3a2e1a',
}

export const THEME_NORD: ITheme = {
  background: '#2e3440',
  foreground: '#d8dee9',
  cursor: '#88c0d0',
  cursorAccent: '#2e3440',
  selectionBackground: 'rgba(136, 192, 208, 0.25)',
  black: '#3b4252',
  red: '#bf616a',
  green: '#a3be8c',
  yellow: '#ebcb8b',
  blue: '#81a1c1',
  magenta: '#b48ead',
  cyan: '#88c0d0',
  white: '#e5e9f0',
  brightBlack: '#4c566a',
  brightRed: '#bf616a',
  brightGreen: '#a3be8c',
  brightYellow: '#ebcb8b',
  brightBlue: '#81a1c1',
  brightMagenta: '#b48ead',
  brightCyan: '#8fbcbb',
  brightWhite: '#eceff4',
}

export const THEME_MONOKAI: ITheme = {
  background: '#272822',
  foreground: '#f8f8f2',
  cursor: '#f8f8f0',
  cursorAccent: '#272822',
  selectionBackground: 'rgba(73, 72, 62, 0.5)',
  black: '#272822',
  red: '#f92672',
  green: '#a6e22e',
  yellow: '#f4bf75',
  blue: '#66d9ef',
  magenta: '#ae81ff',
  cyan: '#a1efe4',
  white: '#f8f8f2',
  brightBlack: '#75715e',
  brightRed: '#f92672',
  brightGreen: '#a6e22e',
  brightYellow: '#f4bf75',
  brightBlue: '#66d9ef',
  brightMagenta: '#ae81ff',
  brightCyan: '#a1efe4',
  brightWhite: '#f9f8f5',
}

export function getTerminalTheme(theme: ThemeName): ITheme {
  if (theme === 'light') return THEME_LIGHT
  if (theme === 'creme') return THEME_CREME
  if (theme === 'nord') return THEME_NORD
  if (theme === 'monokai') return THEME_MONOKAI
  return THEME_DARK
}

export function applyTheme(theme: ThemeName): void {
  document.documentElement.setAttribute('data-theme', theme)
}

// ── Terminal Settings ────────────────────────────────────────────

export interface TerminalSettings {
  fontSize: number
  fontFamily: string
  lineHeight: number
  cursorStyle: 'bar' | 'block' | 'underline'
  cursorBlink: boolean
  scrollback: number
}

export const DEFAULT_SETTINGS: TerminalSettings = {
  fontSize: 13,
  fontFamily: "'JetBrains Mono', monospace",
  lineHeight: 1.4,
  cursorStyle: 'bar',
  cursorBlink: true,
  scrollback: 5000,
}

export function loadSettings(): TerminalSettings {
  const saved = loadPixelCitySettings().terminalSettings
  return saved ? { ...DEFAULT_SETTINGS, ...saved } : DEFAULT_SETTINGS
}

export function loadEditorSettings(): EditorSettings {
  const saved = loadPixelCitySettings().editorSettings
  return saved ? { ...DEFAULT_EDITOR_SETTINGS, ...saved } : DEFAULT_EDITOR_SETTINGS
}
