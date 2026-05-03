// ── Chat Renderer Interface ─────────────────────────────────────────
// Every chat UI framework (xterm, built-in ChatView, assistant-ui, etc.)
// implements this interface. The AgentPanel uses the renderer registry
// to look up which UI to display for a given provider.

import type React from 'react'
import type { LLMSession } from '../llm/LLMSession.js'

/** Unique identifier for a renderer (e.g. 'terminal', 'builtin-chat', 'assistant-ui') */
export type RendererId = string

/** What a renderer can display — helps providers pick the best renderer */
export interface ChatRendererCapabilities {
  /** Can render raw terminal / PTY output (xterm) */
  terminal: boolean
  /** Can display tool call invocations and results */
  toolCalls: boolean
  /** Can render markdown content */
  markdown: boolean
  /** Can display syntax-highlighted code blocks */
  codeBlocks: boolean
  /** Can handle streaming token-by-token output */
  streaming: boolean
  /** Can display thinking/reasoning blocks */
  thinking: boolean
}

/** Props passed to every renderer component */
export interface ChatRendererProps {
  /** Active LLM session */
  session: LLMSession
  /** Agent display name */
  agentName: string
  /** Agent identifier */
  agentId: string
  /** Model identifier (e.g. 'claude-sonnet-4-6', 'qwen3.5-flash') */
  modelId: string
  /** Project working directory */
  projectCwd: string
  /** Project file tree (for @-mentions etc.) — app-specific type, passed as generic */
  projectFiles?: unknown

  // ── Terminal-specific (only for terminal renderers) ──────────
  /** DOM element to mount the terminal into */
  containerRef?: React.RefObject<HTMLDivElement | null>
  /** Callback when terminal is initialized (for xterm integration) */
  onTerminalReady?: (terminal: unknown) => void
}

export interface IChatRenderer {
  /** Unique renderer identifier (e.g. 'terminal', 'builtin-chat', 'assistant-ui') */
  readonly id: RendererId

  /** Human-readable name for settings UI */
  readonly displayName: string

  /** What this renderer can display */
  readonly capabilities: ChatRendererCapabilities

  /** React component that renders the chat UI */
  readonly Component: React.ComponentType<ChatRendererProps>
}
