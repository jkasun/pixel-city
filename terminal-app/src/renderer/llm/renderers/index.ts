// ── Chat Renderers ──────────────────────────────────────────────────
// Public API for the chat renderer adapter. Import from here.

// Core types
export type { RendererId, ChatRendererCapabilities, ChatRendererProps, IChatRenderer } from './IChatRenderer.js'

// Registry (singleton)
export { rendererRegistry } from './rendererRegistry.js'

// Built-in renderers
export { TerminalRenderer } from './terminal/TerminalRenderer.js'
export { BuiltinChatRenderer } from './builtin-chat/BuiltinChatRenderer.js'
export { AssistantUIRenderer } from './assistant-ui/AssistantUIRenderer.js'

// ── Auto-register built-in renderers ────────────────────────────────
import { rendererRegistry as _registry } from './rendererRegistry.js'
import { TerminalRenderer as _TerminalRenderer } from './terminal/TerminalRenderer.js'
import { BuiltinChatRenderer as _BuiltinChatRenderer } from './builtin-chat/BuiltinChatRenderer.js'
import { AssistantUIRenderer as _AssistantUIRenderer } from './assistant-ui/AssistantUIRenderer.js'

_registry.register(new _TerminalRenderer())
_registry.register(new _BuiltinChatRenderer())
_registry.register(new _AssistantUIRenderer())
