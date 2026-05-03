// ── Built-in Chat Component (Renderer Adapter) ───────────────��─────
// Thin adapter that bridges ChatRendererProps → ChatView props.

import React from 'react'
import type { ChatRendererProps } from '../IChatRenderer.js'
import { ChatView } from '../../../ChatView.js'

export function BuiltinChatComponent({ session, agentName, modelId, projectCwd, projectFiles }: ChatRendererProps) {
  return (
    <ChatView
      session={session}
      agentName={agentName}
      modelId={modelId}
      projectCwd={projectCwd}
      projectFiles={projectFiles as any}
    />
  )
}
