import { useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import Split from 'split.js'
import { loadLayoutSizes, saveLayoutSizes, getTerminalTheme, loadPixelCitySettings } from '../settings.js'
import type { AgentTerminalData, ShellTerminalData } from '../appTypes.js'

interface UseAppLayoutArgs {
  activeViewRef: React.RefObject<'agent' | 'shell'>
  activeAgentIdRef: React.RefObject<string | null>
  activeShellIdRef: React.RefObject<number | null>
  agentTerminalsRef: React.RefObject<Map<string, AgentTerminalData>>
  shellTerminalsRef: React.RefObject<Map<number, ShellTerminalData>>
  activeAgentId: string | null
  activeShellId: number | null
  activeView: 'agent' | 'shell'
  currentRoute: 'city' | 'building'
  sidebarVisible: boolean
  hasProject: boolean
  activePanelTab: string
}

export function useAppLayout({
  activeViewRef, activeAgentIdRef, activeShellIdRef,
  agentTerminalsRef, shellTerminalsRef,
  activeAgentId, activeShellId, activeView,
  currentRoute,
  sidebarVisible, hasProject,
  activePanelTab,
}: UseAppLayoutArgs) {
  const officePanelRef = useRef<HTMLDivElement>(null)
  const terminalPanelRef = useRef<HTMLDivElement>(null)
  const dmSidebarRef = useRef<HTMLDivElement>(null)
  const terminalMainRef = useRef<HTMLDivElement>(null)
  const terminalAreaRef = useRef<HTMLDivElement>(null)
  const splitRef = useRef<ReturnType<typeof Split> | null>(null)
  const innerSplitRef = useRef<ReturnType<typeof Split> | null>(null)
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const debouncedFit = useCallback(() => {
    clearTimeout(resizeTimerRef.current)
    resizeTimerRef.current = setTimeout(() => {
      if (activeViewRef.current === 'agent') {
        const id = activeAgentIdRef.current
        if (id !== null) agentTerminalsRef.current.get(id)?.fitAddon?.fit()
      } else {
        const id = activeShellIdRef.current
        if (id !== null) shellTerminalsRef.current.get(id)?.fitAddon?.fit()
      }
    }, 60)
  }, [])

  // Manage Split.js when terminal panel visibility changes
  useLayoutEffect(() => {
    const panel = terminalPanelRef.current
    const office = officePanelRef.current
    if (!panel || !office) return

    const isCityView = currentRoute === 'city'
    const shouldShow = !isCityView && sidebarVisible
    if (shouldShow && !splitRef.current) {
      const saved = loadLayoutSizes()
      panel.style.display = 'flex'
      splitRef.current = Split([office, panel], {
        sizes: saved.main ?? [58, 42],
        minSize: [300, 260],
        gutterSize: 5,
        snapOffset: 0,
        onDragStart: () => { document.body.classList.add('split-dragging') },
        onDrag: debouncedFit,
        onDragEnd: (sizes) => { document.body.classList.remove('split-dragging'); saveLayoutSizes({ main: sizes as [number, number] }) },
      })
      const dmSidebar = dmSidebarRef.current
      const terminalMain = terminalMainRef.current
      if (dmSidebar && terminalMain && !innerSplitRef.current) {
        innerSplitRef.current = Split([dmSidebar, terminalMain], {
          sizes: saved.inner ?? [28, 72],
          minSize: [140, 200],
          gutterSize: 4,
          snapOffset: 0,
          onDragStart: () => { document.body.classList.add('split-dragging') },
          onDrag: debouncedFit,
          onDragEnd: (sizes) => { document.body.classList.remove('split-dragging'); saveLayoutSizes({ inner: sizes as [number, number] }) },
        })
      }
    } else if (!shouldShow && splitRef.current) {
      saveLayoutSizes({ main: splitRef.current.getSizes() as [number, number] })
      if (innerSplitRef.current) {
        saveLayoutSizes({ inner: innerSplitRef.current.getSizes() as [number, number] })
        innerSplitRef.current.destroy()
        innerSplitRef.current = null
      }
      splitRef.current.destroy()
      splitRef.current = null
      panel.style.display = 'none'
      office.style.removeProperty('width')
      office.style.removeProperty('flex')
    }
  }, [debouncedFit, currentRoute, sidebarVisible, hasProject])

  // Fit + focus the active terminal when it changes
  // Also re-apply theme — WebGL can't repaint while display:none, so terminals
  // that were hidden during a theme change need the theme re-applied on show.
  // Deps include all visibility triggers: tab switches, route changes, sidebar toggle.
  useEffect(() => {
    const xtermTheme = getTerminalTheme(loadPixelCitySettings().theme ?? 'dark')
    if (activeView === 'agent' && activeAgentId !== null) {
      const agent = agentTerminalsRef.current.get(activeAgentId)
      if (agent?.fitAddon && agent.terminal) setTimeout(() => { agent.terminal!.options.theme = xtermTheme; agent.fitAddon!.fit(); agent.terminal!.focus() }, 10)
    } else if (activeView === 'shell' && activeShellId !== null) {
      const shell = shellTerminalsRef.current.get(activeShellId)
      if (shell?.fitAddon && shell.terminal) setTimeout(() => { shell.terminal.options.theme = xtermTheme; shell.fitAddon.fit(); shell.terminal.focus() }, 10)
    }
  }, [activeAgentId, activeShellId, activeView, activePanelTab, currentRoute, sidebarVisible])

  // Window resize
  useEffect(() => {
    window.addEventListener('resize', debouncedFit)
    return () => window.removeEventListener('resize', debouncedFit)
  }, [debouncedFit])

  // Save layout sizes when the app closes
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (splitRef.current) saveLayoutSizes({ main: splitRef.current.getSizes() as [number, number] })
      if (innerSplitRef.current) saveLayoutSizes({ inner: innerSplitRef.current.getSizes() as [number, number] })
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  return {
    officePanelRef,
    terminalPanelRef,
    dmSidebarRef,
    terminalMainRef,
    terminalAreaRef,
  }
}
