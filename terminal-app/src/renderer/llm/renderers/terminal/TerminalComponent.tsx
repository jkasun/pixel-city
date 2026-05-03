// ── Terminal Component (Renderer Adapter) ───────────────────────────
// Placeholder component for terminal-based providers.
// The actual xterm.js terminal is mounted directly into the DOM by
// OfficeContext.initTerminal() using a container ref — this is because
// xterm requires imperative DOM access that doesn't fit the React
// component model cleanly.
//
// This component exists so that TerminalRenderer satisfies the
// IChatRenderer interface. In the AgentPanel, terminal providers still
// use the existing ref-based mounting pattern.

import React from 'react'
import type { ChatRendererProps } from '../IChatRenderer.js'

export function TerminalComponent(_props: ChatRendererProps) {
  // Terminal rendering is handled by the parent container via ref mounting.
  // This component is a no-op — the AgentPanel detects 'terminal' renderer
  // and uses the ref-based xterm init path instead.
  return null
}
