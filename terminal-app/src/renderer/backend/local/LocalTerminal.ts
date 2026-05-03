// ── Local Terminal ──────────────────────────────────────────────────
// BackendTerminal implementation for the Electron desktop environment.
// Wraps xterm.js + Electron IPC for PTY communication.

import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { loadTerminalAddons } from '../../utils/terminalSetup.js'
import type { BackendTerminal, TerminalAttachOptions } from '../types.js'

const { ipcRenderer } = window.require('electron')

export class LocalTerminal implements BackendTerminal {
  readonly ptyId: number
  private terminal: Terminal | null = null
  private fitAddon: FitAddon | null = null
  private searchAddon: SearchAddon | null = null
  private outputCallbacks: Array<(data: string) => void> = []
  private exitCallbacks: Array<(exitCode: number) => void> = []
  private ptyOutputHandler: ((_e: unknown, data: { id: number; data: string }) => void) | null = null
  private ptyExitHandler: ((_e: unknown, data: { id: number; exitCode: number }) => void) | null = null
  private disposed = false
  /** When true, PTY output is silently discarded (background tool running). */
  suppressed = false

  constructor(ptyId: number) {
    this.ptyId = ptyId
    this.setupPtyListeners()
  }

  private setupPtyListeners(): void {
    this.ptyOutputHandler = (_e, data) => {
      if (data.id === this.ptyId) {
        // Write to xterm if attached (skip when background tool is running)
        if (!this.suppressed) {
          this.terminal?.write(data.data)
        }
        // Notify external listeners (always — used for status extraction)
        for (const cb of this.outputCallbacks) cb(data.data)
      }
    }
    this.ptyExitHandler = (_e, data) => {
      if (data.id === this.ptyId) {
        for (const cb of this.exitCallbacks) cb(data.exitCode)
      }
    }
    ipcRenderer.on('pty-output', this.ptyOutputHandler)
    ipcRenderer.on('pty-exit', this.ptyExitHandler)
  }

  attach(container: HTMLElement, options?: TerminalAttachOptions): void {
    if (this.terminal) return // Already attached

    this.terminal = new Terminal({
      theme: options?.theme,
      fontFamily: options?.fontFamily ?? "'Fira Code', 'Cascadia Code', monospace",
      fontSize: options?.fontSize ?? 13,
      lineHeight: options?.lineHeight ?? 1.2,
      cursorStyle: options?.cursorStyle ?? 'block',
      cursorBlink: options?.cursorBlink ?? true,
      scrollback: options?.scrollback ?? 10000,
      allowProposedApi: true,
    })

    this.fitAddon = new FitAddon()
    this.terminal.open(container)
    const { searchAddon } = loadTerminalAddons(this.terminal, this.fitAddon)
    this.searchAddon = searchAddon

    // Wire terminal input → PTY
    this.terminal.onData((data) => this.sendInput(data))
    this.terminal.onResize(({ cols, rows }) => this.resize(cols, rows))

    // Initial fit
    setTimeout(() => this.fit(), 10)
  }

  detach(): void {
    if (this.disposed) return
    this.disposed = true

    this.terminal?.dispose()
    this.terminal = null
    this.fitAddon = null
    this.searchAddon = null

    if (this.ptyOutputHandler) {
      ipcRenderer.removeListener('pty-output', this.ptyOutputHandler)
      this.ptyOutputHandler = null
    }
    if (this.ptyExitHandler) {
      ipcRenderer.removeListener('pty-exit', this.ptyExitHandler)
      this.ptyExitHandler = null
    }
  }

  sendInput(data: string): void {
    if (this.disposed) return
    ipcRenderer.send('pty-input', { id: this.ptyId, data })
  }

  resize(cols: number, rows: number): void {
    if (this.disposed) return
    ipcRenderer.send('pty-resize', { id: this.ptyId, cols, rows })
  }

  onOutput(cb: (data: string) => void): () => void {
    this.outputCallbacks.push(cb)
    return () => {
      const idx = this.outputCallbacks.indexOf(cb)
      if (idx !== -1) this.outputCallbacks.splice(idx, 1)
    }
  }

  onExit(cb: (exitCode: number) => void): () => void {
    this.exitCallbacks.push(cb)
    return () => {
      const idx = this.exitCallbacks.indexOf(cb)
      if (idx !== -1) this.exitCallbacks.splice(idx, 1)
    }
  }

  focus(): void {
    this.terminal?.focus()
  }

  fit(): void {
    this.fitAddon?.fit()
  }

  /** Kill the PTY process. */
  kill(): void {
    if (this.disposed) return
    ipcRenderer.send('pty-kill', { id: this.ptyId })
  }

  /** Get raw xterm instance (for legacy integration during migration). */
  getXterm(): Terminal | null {
    return this.terminal
  }

  /** Get search addon (for legacy integration during migration). */
  getSearchAddon(): SearchAddon | null {
    return this.searchAddon
  }

  /** Get fit addon (for legacy integration during migration). */
  getFitAddon(): FitAddon | null {
    return this.fitAddon
  }
}
