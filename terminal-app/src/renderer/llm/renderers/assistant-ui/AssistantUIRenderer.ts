// ── Assistant UI Renderer ────────────────────────────────────────────
// Implements IChatRenderer using the @assistant-ui/react library.
// Provides a rich chat experience with streaming, tool call rendering,
// thinking blocks, and markdown support.

import type { IChatRenderer, ChatRendererCapabilities } from '../IChatRenderer.js'
import { AssistantUIComponent } from './AssistantUIComponent.js'

const ASSISTANT_UI_CAPABILITIES: ChatRendererCapabilities = {
  terminal: false,
  toolCalls: true,
  markdown: true,
  codeBlocks: true,
  streaming: true,
  thinking: true,
}

export class AssistantUIRenderer implements IChatRenderer {
  readonly id = 'assistant-ui'
  readonly displayName = 'Assistant UI'
  readonly capabilities = ASSISTANT_UI_CAPABILITIES
  readonly Component = AssistantUIComponent
}
