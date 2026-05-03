// ── Terminal Renderer ────────────────────────────────────────────────
// Wraps the xterm.js terminal as an IChatRenderer.
// This renderer is used for PTY-based providers like Claude Code.
// Note: The actual xterm initialization is handled by OfficeContext's
// initTerminal — this renderer just declares the capability and provides
// a placeholder component. The real terminal DOM is mounted separately
// because xterm requires direct DOM access (ref-based mounting).

import type { IChatRenderer, ChatRendererCapabilities } from '../IChatRenderer.js'
import { TerminalComponent } from './TerminalComponent.js'

const TERMINAL_CAPABILITIES: ChatRendererCapabilities = {
  terminal: true,
  toolCalls: false,   // Tool calls rendered as ANSI text in the terminal
  markdown: false,    // Terminal renders raw text
  codeBlocks: false,
  streaming: true,
  thinking: false,
}

export class TerminalRenderer implements IChatRenderer {
  readonly id = 'terminal'
  readonly displayName = 'Terminal (xterm)'
  readonly capabilities = TERMINAL_CAPABILITIES
  readonly Component = TerminalComponent
}
