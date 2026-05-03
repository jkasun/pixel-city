import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { ImageAddon } from '@xterm/addon-image'
import { SearchAddon } from '@xterm/addon-search'

const { shell } = window.require('electron') as typeof import('electron')

/**
 * Load all xterm addons onto a terminal instance.
 * Must be called AFTER terminal.open(container).
 */
export function loadTerminalAddons(terminal: Terminal, fitAddon: FitAddon): { searchAddon: SearchAddon } {
  terminal.loadAddon(fitAddon)

  // Clickable URLs — opens in default browser
  terminal.loadAddon(new WebLinksAddon((_event, uri) => {
    shell.openExternal(uri)
  }))

  // Better unicode/emoji rendering
  const unicode11 = new Unicode11Addon()
  terminal.loadAddon(unicode11)
  terminal.unicode.activeVersion = '11'

  // Inline image support (sixel protocol)
  try { terminal.loadAddon(new ImageAddon()) } catch (_) {}

  // Font ligatures (JetBrains Mono supports these)
  // Loaded via window.require to avoid Vite bundling Node.js-dependent opentype.js
  try {
    const { LigaturesAddon } = window.require('@xterm/addon-ligatures') as typeof import('@xterm/addon-ligatures')
    terminal.loadAddon(new LigaturesAddon())
  } catch (_) {}

  // GPU-accelerated rendering (graceful fallback)
  try { terminal.loadAddon(new WebglAddon()) } catch (_) {}

  // Search — returned so callers can wire up Ctrl+F
  const searchAddon = new SearchAddon()
  terminal.loadAddon(searchAddon)

  // Keyboard shortcut handling
  const isMac = navigator.platform.includes('Mac')
  terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
    // Shift+Enter: send CSI u sequence instead of plain \r
    if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.type === 'keydown') {
        terminal.input('\x1b[13;2u', true)
      }
      return false
    }

    const mod = isMac ? e.metaKey : e.ctrlKey
    if (!mod) return true

    // Copy: only intercept Cmd/Ctrl+C when there's a selection,
    // otherwise let xterm send SIGINT as normal (return true)
    if (e.key === 'c') {
      if (terminal.hasSelection()) {
        if (e.type === 'keydown') {
          navigator.clipboard.writeText(terminal.getSelection())
          terminal.clearSelection()
        }
        return false
      }
      // No selection — let xterm send SIGINT
      return true
    }

    // For all other Cmd/Ctrl combos (paste, save, find, etc.),
    // don't let xterm swallow them — let the app/Electron handle them
    return false
  })

  return { searchAddon }
}
