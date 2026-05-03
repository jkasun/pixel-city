import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import type { DebugEvent, DebugEventKind } from '../DebugPanel.js'
import type { TerminalSettings, EditorSettings } from '../settings.js'
import {
  loadRecentProjects, saveRecentProject,
  loadSettings, loadEditorSettings, savePixelCitySettings,
  loadSessionState, saveSessionState,
  applyTheme, getTerminalTheme,
} from '../settings.js'
import type { ThemeName } from '../settings.js'
import { initMcpBridge, registerWsFrameCallback } from '../mcpBridge.js'
import { useShellTerminals } from '../hooks/useShellTerminals.js'
import { useFeatureFlags } from '../hooks/useFeatureFlags.js'
import type { ShellTerminalData } from '../appTypes.js'
import type { IpcRendererEvent } from '../electron.d'
import { platform } from '../platform/index.js'
import { setEmployeeProjectCwd } from '../employee/currentProjectCwd.js'

interface WorldContextValue {
  // Project
  projectCwd: string | null
  setProjectCwd: React.Dispatch<React.SetStateAction<string | null>>
  projectCwdRef: React.RefObject<string | null>
  recentProjects: string[]
  handleOpenProject: (cwd: string) => void
  handleChangeFolder: () => Promise<void>

  // Settings
  settings: TerminalSettings
  setSettings: React.Dispatch<React.SetStateAction<TerminalSettings>>
  settingsRef: React.RefObject<TerminalSettings>
  editorSettings: EditorSettings
  setEditorSettings: React.Dispatch<React.SetStateAction<EditorSettings>>

  // Debug
  debugEvents: DebugEvent[]
  setDebugEvents: React.Dispatch<React.SetStateAction<DebugEvent[]>>
  debugIdRef: React.RefObject<number>
  debugCallbackRef: React.RefObject<(agentId: string | number, kind: DebugEventKind, label: string) => void>

  // Quick menu
  quickMenuOpen: boolean
  setQuickMenuOpen: React.Dispatch<React.SetStateAction<boolean>>

  // Building picker (Cmd+R)
  buildingPickerOpen: boolean
  setBuildingPickerOpen: React.Dispatch<React.SetStateAction<boolean>>

  // Shell terminals
  shellIds: number[]
  activeShellId: number | null
  setActiveShellId: React.Dispatch<React.SetStateAction<number | null>>
  shellTerminalsRef: React.RefObject<Map<number, ShellTerminalData>>
  shellNames: Record<number, string>
  shellBuildingMap: Map<number, string>
  updateShellName: (shellId: number, name: string) => void
  initShellTerminal: (id: number, container: HTMLDivElement) => void
  addShellTerminal: (buildingId?: string | null) => number
  removeShellTerminal: (id: number) => void

  // Active view (agent vs shell)
  activeView: 'agent' | 'shell'
  setActiveView: React.Dispatch<React.SetStateAction<'agent' | 'shell'>>
  activeViewRef: React.RefObject<'agent' | 'shell'>
  activeShellIdRef: React.RefObject<number | null>

  // Panel tab
  activePanelTab: string
  setActivePanelTab: React.Dispatch<React.SetStateAction<string>>

  // Shells collapsed
  shellsCollapsed: boolean
  setShellsCollapsed: React.Dispatch<React.SetStateAction<boolean>>

  // Feature flags
  isFeatureEnabled: (key: string) => boolean
}

const WorldContext = createContext<WorldContextValue | null>(null)

let _worldSession: ReturnType<typeof loadSessionState> | null = null
function getWorldSession() {
  if (!_worldSession) _worldSession = loadSessionState()
  return _worldSession
}

export function WorldContextProvider({ children }: { children: React.ReactNode }) {
  // ── Project ───────────────────────────────────────────
  const [projectCwd, setProjectCwd] = useState<string | null>(null)
  const [recentProjects, setRecentProjects] = useState<string[]>(loadRecentProjects)
  const projectCwdRef = useRef<string | null>(null)

  const handleOpenProject = useCallback((cwd: string) => {
    saveRecentProject(cwd)
    setRecentProjects(loadRecentProjects())
    projectCwdRef.current = cwd
    setEmployeeProjectCwd(cwd)
    setProjectCwd(cwd)
  }, [])

  // Keep the employee-IPC register in sync on every render so child contexts
  // reading it during their first effect see the right value regardless of
  // useEffect execution order.
  setEmployeeProjectCwd(projectCwd)

  const handleChangeFolder = useCallback(async () => {
    const folder = await platform().dialog.openFolder()
    if (folder) handleOpenProject(folder)
  }, [handleOpenProject])

  // ── Ensure MCP config exists on project open ─────────────────
  // Both dev and prod write the same content (entries reference the shared
  // launcher at ~/.pixelcity/mcp-launcher.cjs), so concurrent runs don't
  // conflict on the file. The launcher dispatches to whichever instance
  // is alive at agent spawn time.
  useEffect(() => {
    if (!projectCwd) return
    platform().workspace.ensureMcpConfig(projectCwd).catch((err) => {
      console.error('[WorldContext] ensureMcpConfig failed for projectCwd:', projectCwd, err)
    })
  }, [projectCwd])

  // ── Ensure MCP config for all building directories on startup ──
  useEffect(() => {
    if (!projectCwd) return
    const run = async () => {
      try {
        const dirsResult = await platform().building.loadDirs()
        const dirs: Record<string, string> = (dirsResult as any)?.dirs ?? dirsResult ?? {}
        for (const [, dir] of Object.entries(dirs)) {
          if (!dir) continue
          platform().workspace.ensureMcpConfig(dir).catch((err) => {
            console.error('[WorldContext] ensureMcpConfig failed for building dir:', dir, err)
          })
        }
      } catch (err) { console.error('[WorldContext] ensureMcpConfig loop failed:', err) }
    }
    run()
  }, [projectCwd])

  // ── Settings ──────────────────────────────────────────
  const [settings, setSettings] = useState<TerminalSettings>(loadSettings)
  const settingsRef = useRef<TerminalSettings>(settings)

  useEffect(() => {
    settingsRef.current = settings
    savePixelCitySettings({ terminalSettings: settings })
  }, [settings])

  useEffect(() => {
    const unsubSettings = platform().settings.onChange((data) => {
      if ((data as any).terminalSettings) setSettings((data as any).terminalSettings)
      if ((data as any).editorSettings) setEditorSettings((data as any).editorSettings)
      if ((data as any).theme) {
        applyTheme((data as any).theme as ThemeName)
        // Update all shell terminals with new theme
        const xtermTheme = getTerminalTheme((data as any).theme as ThemeName)
        for (const t of shellTerminalsRef.current.values()) {
          if (t.terminal) t.terminal.options.theme = xtermTheme
        }
        // Dispatch event for agent terminals (handled by OfficeContext)
        window.dispatchEvent(new CustomEvent('pixelcity:theme-changed', { detail: { theme: (data as any).theme } }))
      }
    })

    // Also listen for direct theme changes (from SettingsModal in same window)
    const themeHandler = (e: Event) => {
      const theme = (e as CustomEvent).detail?.theme as ThemeName
      if (!theme) return
      const xtermTheme = getTerminalTheme(theme)
      for (const t of shellTerminalsRef.current.values()) {
        if (t.terminal) t.terminal.options.theme = xtermTheme
      }
    }
    window.addEventListener('pixelcity:theme-changed', themeHandler)

    return () => {
      unsubSettings()
      window.removeEventListener('pixelcity:theme-changed', themeHandler)
    }
  }, [])

  // ── Editor Settings ────────────────────────────────────
  const [editorSettings, setEditorSettings] = useState<EditorSettings>(loadEditorSettings)

  useEffect(() => {
    savePixelCitySettings({ editorSettings })
  }, [editorSettings])

  // ── Debug ─────────────────────────────────────────────
  const [debugEvents, setDebugEvents] = useState<DebugEvent[]>([])
  const debugIdRef = useRef(0)
  const debugCallbackRef = useRef<(agentId: string | number, kind: DebugEventKind, label: string) => void>(() => {})

  debugCallbackRef.current = (agentId: string | number, kind: DebugEventKind, label: string) => {
    const now = new Date()
    const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`
    setDebugEvents(prev => {
      const next = [...prev, { id: debugIdRef.current++, ts, agentId, kind, label }]
      return next.length > 1000 ? next.slice(-1000) : next
    })
  }

  // ── Quick menu ────────────────────────────────────────
  const [quickMenuOpen, setQuickMenuOpen] = useState(false)
  const [buildingPickerOpen, setBuildingPickerOpen] = useState(false)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault()
        setQuickMenuOpen(v => !v)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
        e.preventDefault()
        setBuildingPickerOpen(v => !v)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // ── Active view ───────────────────────────────────────
  const [activeView, setActiveView] = useState<'agent' | 'shell'>(() => getWorldSession().activeView ?? 'agent')
  const activeViewRef = useRef<'agent' | 'shell'>(getWorldSession().activeView ?? 'agent')
  useEffect(() => { activeViewRef.current = activeView }, [activeView])

  // ── Panel tab ─────────────────────────────────────────
  const [activePanelTab, setActivePanelTab] = useState<string>(() => (getWorldSession().activePanelTab as any) ?? 'message')

  // ── Shells collapsed ──────────────────────────────────
  const [shellsCollapsed, setShellsCollapsed] = useState(() => getWorldSession().shellsCollapsed ?? false)

  // ── Persist session state ────────────────────────────
  useEffect(() => { saveSessionState({ activeView }) }, [activeView])
  useEffect(() => { saveSessionState({ activePanelTab }) }, [activePanelTab])
  useEffect(() => { saveSessionState({ shellsCollapsed }) }, [shellsCollapsed])

  // ── Feature flags ────────────────────────────────────
  const { isEnabled: isFeatureEnabled } = useFeatureFlags()

  // ── Shell terminals ───────────────────────────────────
  const {
    shellIds, activeShellId, setActiveShellId, shellTerminalsRef, shellNames, setShellNames,
    shellBuildingMap,
    initShellTerminal, addShellTerminal: addShellTerminalRaw, removeShellTerminal,
  } = useShellTerminals({ settingsRef, projectCwdRef })

  const updateShellName = useCallback((shellId: number, name: string) => {
    setShellNames(prev => prev[shellId] === name ? prev : { ...prev, [shellId]: name })
  }, [setShellNames])

  const activeShellIdRef = useRef<number | null>(null)
  useEffect(() => { activeShellIdRef.current = activeShellId }, [activeShellId])

  const addShellTerminal = useCallback((buildingId?: string | null) => {
    const id = addShellTerminalRaw(buildingId)
    setActiveView('shell')
    return id
  }, [addShellTerminalRaw])

  // ── Auto-create a shell terminal when project opens ──
  useEffect(() => {
    if (projectCwd && shellIds.length === 0) {
      addShellTerminalRaw()
    }
  }, [projectCwd])

  // ── MCP bridge init ───────────────────────────────────
  useEffect(() => {
    registerWsFrameCallback((direction, summary) => {
      debugCallbackRef.current(0, direction === 'rx' ? 'ws-rx' : 'ws-tx', summary)
    })
    initMcpBridge()
  }, [])

  // Apply settings to running terminals
  // Note: agent terminals are applied in OfficeContext
  useEffect(() => {
    for (const t of shellTerminalsRef.current.values()) {
      if (!t.terminal || !t.fitAddon) continue
      t.terminal.options.fontSize   = settings.fontSize
      t.terminal.options.fontFamily = settings.fontFamily
      t.terminal.options.lineHeight = settings.lineHeight
      t.terminal.options.cursorStyle = settings.cursorStyle
      t.terminal.options.cursorBlink = settings.cursorBlink
      setTimeout(() => t.fitAddon.fit(), 50)
    }
  }, [settings])

  return (
    <WorldContext.Provider value={{
      projectCwd, setProjectCwd, projectCwdRef,
      recentProjects, handleOpenProject, handleChangeFolder,
      settings, setSettings, settingsRef,
      editorSettings, setEditorSettings,
      debugEvents, setDebugEvents, debugIdRef, debugCallbackRef,
      quickMenuOpen, setQuickMenuOpen,
      buildingPickerOpen, setBuildingPickerOpen,
      shellIds, activeShellId, setActiveShellId, shellTerminalsRef, shellNames, shellBuildingMap, updateShellName,
      initShellTerminal, addShellTerminal, removeShellTerminal,
      activeView, setActiveView, activeViewRef, activeShellIdRef,
      activePanelTab, setActivePanelTab,
      shellsCollapsed, setShellsCollapsed,
      isFeatureEnabled,
    }}>
      {children}
    </WorldContext.Provider>
  )
}

export function useWorldContext() {
  const ctx = useContext(WorldContext)
  if (!ctx) throw new Error('useWorldContext must be used within WorldContextProvider')
  return ctx
}
