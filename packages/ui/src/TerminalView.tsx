/**
 * TerminalView — shared xterm.js terminal using ISessionAdapter for I/O.
 *
 * Works on both desktop (Electron IPC) and web (WebSocket) — the adapter
 * handles the transport.
 */

import React, { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useSession } from './SessionContext.js'

import '@xterm/xterm/css/xterm.css'

export interface TerminalViewProps {
  ptyId: number
  autoFocus?: boolean
  fontSize?: number
  fontFamily?: string
}

const DEFAULT_THEME = {
  background: '#0a0a0c',
  foreground: '#c8c5be',
  cursor: '#c8c5be',
  selectionBackground: '#3d7a60',
  black: '#0a0a0c',
  red: '#ef4444',
  green: '#5ac88c',
  yellow: '#c49a6c',
  blue: '#6b8fb5',
  magenta: '#a07bb5',
  cyan: '#6ba5a0',
  white: '#c8c5be',
}

export function TerminalView({
  ptyId,
  autoFocus = true,
  fontSize = 13,
  fontFamily = "'Fira Code', 'Cascadia Code', monospace",
}: TerminalViewProps) {
  const session = useSession()
  const containerRef = useRef<HTMLDivElement>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  // Use a ref for session so the terminal effect doesn't re-run when the
  // adapter object changes (it changes on every agent status update because
  // the agents array is a dependency of useMemo in Workspace).
  const sessionRef = useRef(session)
  sessionRef.current = session

  useEffect(() => {
    if (!containerRef.current) return

    const terminal = new Terminal({
      fontFamily,
      fontSize,
      lineHeight: 1.2,
      cursorStyle: 'block',
      cursorBlink: true,
      scrollback: 10000,
      allowProposedApi: true,
      theme: DEFAULT_THEME,
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(containerRef.current)

    // Wire input → adapter (read from ref so we always use the latest adapter)
    const inputDisposable = terminal.onData((data) => {
      sessionRef.current.sendInput(ptyId, data)
    })

    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      sessionRef.current.resizePty(ptyId, cols, rows)
    })

    // Replay buffered scrollback (restores terminal after page reload)
    if (sessionRef.current.replayOutput) {
      sessionRef.current.replayOutput(ptyId).then((data) => {
        if (data) terminal.write(data)
      }).catch(() => {})
    }

    // Subscribe to PTY output/exit via adapter
    const unsubOutput = sessionRef.current.onOutput(ptyId, (data) => {
      terminal.write(data)
    })

    const unsubExit = sessionRef.current.onExit(ptyId, (exitCode) => {
      terminal.write(
        `\r\n\x1b[38;2;122;120;116m[process exited with code ${exitCode}]\x1b[0m\r\n`,
      )
    })

    // Auto-fit on resize — ResizeObserver fires on initial observe AND
    // whenever the container dimensions change (panel resize, window resize).
    // This replaces the old setTimeout-based initial fit which raced with layout.
    const observer = new ResizeObserver((entries) => {
      // Only fit when the container has non-zero dimensions
      const entry = entries[0]
      if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0) {
        try { fitAddon.fit() } catch {}
      }
    })
    observer.observe(containerRef.current)

    // Focus after first paint
    if (autoFocus) {
      requestAnimationFrame(() => terminal.focus())
    }

    cleanupRef.current = () => {
      inputDisposable.dispose()
      resizeDisposable.dispose()
      unsubOutput()
      unsubExit()
      observer.disconnect()
      terminal.dispose()
    }

    return () => {
      cleanupRef.current?.()
      cleanupRef.current = null
    }
  }, [ptyId, fontSize, fontFamily, autoFocus])

  return (
    <div
      ref={containerRef}
      data-testid="terminal-view"
      style={{ width: '100%', height: '100%', background: '#0a0a0c' }}
    />
  )
}
