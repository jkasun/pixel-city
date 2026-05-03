// ── Built-in Chat Renderer ──────────────────────────────────────────
// Wraps the existing ChatView component as an IChatRenderer.
// This is the default renderer for API-based providers.

import type { IChatRenderer, ChatRendererCapabilities } from '../IChatRenderer.js'
import { BuiltinChatComponent } from './BuiltinChatComponent.js'

const BUILTIN_CHAT_CAPABILITIES: ChatRendererCapabilities = {
  terminal: false,
  toolCalls: true,
  markdown: false,   // ChatView currently renders plain text (no markdown parsing)
  codeBlocks: false,
  streaming: true,
  thinking: true,
}

export class BuiltinChatRenderer implements IChatRenderer {
  readonly id = 'builtin-chat'
  readonly displayName = 'Built-in Chat'
  readonly capabilities = BUILTIN_CHAT_CAPABILITIES
  readonly Component = BuiltinChatComponent
}
