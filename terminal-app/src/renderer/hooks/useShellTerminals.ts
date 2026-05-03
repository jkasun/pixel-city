import { useCallback, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { ShellTerminalData } from '../appTypes.js'
import { THEME, getTerminalTheme, loadPixelCitySettings } from '../settings.js'
import type { TerminalSettings } from '../settings.js'
import { loadTerminalAddons } from '../utils/terminalSetup.js'
import { platform } from '../platform/index.js'

interface ShellTerminalDeps {
  settingsRef: React.RefObject<TerminalSettings>
  projectCwdRef: React.RefObject<string | null>
}

export function useShellTerminals(deps: ShellTerminalDeps) {
  const { settingsRef, projectCwdRef } = deps
  const [shellIds, setShellIds] = useState<number[]>([])
  const [activeShellId, setActiveShellId] = useState<number | null>(null)
  const [shellNames, setShellNames] = useState<Record<number, string>>({})
  const [shellBuildingMap, setShellBuildingMap] = useState<Map<number, string>>(new Map())
  const shellTerminalsRef = useRef<Map<number, ShellTerminalData>>(new Map())
  const shellIdCounter = useRef(0)

  const initShellTerminal = useCallback(async (shellId: number, container: HTMLDivElement) => {
    const placeholder = shellTerminalsRef.current.get(shellId)
    if (placeholder && placeholder.ptyId >= 0) return
    const shellName = placeholder?.name ?? `Terminal ${shellId + 1}`
    const s = settingsRef.current

    const terminal = new Terminal({
      theme: getTerminalTheme(loadPixelCitySettings().theme ?? 'dark'),
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      cursorStyle: s.cursorStyle,
      cursorBlink: s.cursorBlink,
      scrollback: s.scrollback,
      allowProposedApi: true,
    })
    const fitAddon = new FitAddon()
    terminal.open(container)
    const { searchAddon } = loadTerminalAddons(terminal, fitAddon)

    const ptyId: number = await platform().pty.create({
      cols: terminal.cols,
      rows: terminal.rows,
      cwd: projectCwdRef.current ?? undefined,
    })

    terminal.onData((data) => platform().pty.input(ptyId, data))
    terminal.onResize(({ cols, rows }) => platform().pty.resize(ptyId, cols, rows))

    shellTerminalsRef.current.set(shellId, { terminal, fitAddon, searchAddon, ptyId, name: shellName })

    // Track running command in tab title (like VS Code)
    terminal.onTitleChange((title) => {
      const entry = shellTerminalsRef.current.get(shellId)
      if (entry) entry.name = title
      setShellNames(prev => ({ ...prev, [shellId]: title }))
    })

    setTimeout(() => fitAddon.fit(), 10)
  }, [])

  const addShellTerminal = useCallback((buildingId?: string | null) => {
    const id = shellIdCounter.current++
    const name = `Terminal ${id + 1}`
    shellTerminalsRef.current.set(id, { terminal: null!, fitAddon: null!, searchAddon: null!, ptyId: -1, name })
    if (buildingId) {
      setShellBuildingMap(prev => { const next = new Map(prev); next.set(id, buildingId); return next })
    }
    setShellIds(prev => [...prev, id])
    setActiveShellId(id)
    return id
  }, [])

  const removeShellTerminal = useCallback((shellId: number) => {
    const shell = shellTerminalsRef.current.get(shellId)
    if (shell && shell.ptyId >= 0) {
      platform().pty.kill(shell.ptyId)
      shell.terminal.dispose()
    }
    shellTerminalsRef.current.delete(shellId)
    setShellBuildingMap(prev => { if (!prev.has(shellId)) return prev; const next = new Map(prev); next.delete(shellId); return next })
    setShellIds(prev => {
      const next = prev.filter(id => id !== shellId)
      setActiveShellId(curr => {
        if (curr === shellId) return next.length > 0 ? next[next.length - 1] : null
        return curr
      })
      return next
    })
  }, [])

  return {
    shellIds,
    activeShellId,
    setActiveShellId,
    shellTerminalsRef,
    shellNames,
    setShellNames,
    shellBuildingMap,
    initShellTerminal,
    addShellTerminal,
    removeShellTerminal,
  }
}
