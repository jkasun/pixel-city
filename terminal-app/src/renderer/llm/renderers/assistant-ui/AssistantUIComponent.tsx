// ── Assistant UI Component (Renderer Adapter) ──────────────────────
// Bridges LLMSession events → assistant-ui ExternalStoreRuntime.
// Converts our LLMEvent stream into ThreadMessageLike objects that
// assistant-ui can render with its rich UI components.

import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  useExternalStoreRuntime,
  AssistantRuntimeProvider,
  type ThreadMessageLike,
  type AppendMessage,
  type MessageStatus,
} from '@assistant-ui/react'
import type { ChatRendererProps } from '../IChatRenderer.js'
import type { LLMEvent, LLMEventCallback } from '../../types.js'
import type { LLMSession } from '../../LLMSession.js'
import { AssistantUIThread } from './AssistantUIThread.js'

// ── Types ─────────────────────────────────────────────────────────

/** Internal message format that maps to our LLMSession chatHistory */
interface InternalMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: ContentPart[]
  createdAt: Date
  status?: MessageStatus
}

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; args: Record<string, unknown>; result?: unknown }
  | { type: 'reasoning'; text: string }

// ── Session interface (subset needed from API sessions) ───────────

interface ApiSession extends LLMSession {
  chatHistory: Array<{
    role: 'user' | 'assistant' | 'thinking' | 'tool' | 'tool_use'
    content: string
    timestamp: number
    toolName?: string
    toolInput?: Record<string, unknown>
  }>
  offEvent?(callback: LLMEventCallback): void
}

// ── Helpers ───────────────────────────────────────────────────────

let _msgCounter = 0
function generateId(): string {
  return `aui-msg-${Date.now()}-${++_msgCounter}`
}

/**
 * Convert our session's chatHistory into assistant-ui InternalMessages.
 * Groups adjacent thinking → assistant → tool_use → tool into a single
 * assistant message with mixed content parts.
 */
function convertChatHistory(
  history: ApiSession['chatHistory'],
): InternalMessage[] {
  const messages: InternalMessage[] = []
  let currentAssistant: InternalMessage | null = null
  // Track tool results by tool name for matching
  const pendingToolResults = new Map<string, unknown>()

  for (const entry of history) {
    switch (entry.role) {
      case 'user':
        // Flush any pending assistant message
        if (currentAssistant) {
          currentAssistant.status = { type: 'complete', reason: 'stop' } as const
          messages.push(currentAssistant)
          currentAssistant = null
        }
        messages.push({
          id: generateId(),
          role: 'user',
          content: [{ type: 'text', text: entry.content }],
          createdAt: new Date(entry.timestamp),
        })
        break

      case 'thinking':
        // Start or extend an assistant message with reasoning
        if (!currentAssistant) {
          currentAssistant = {
            id: generateId(),
            role: 'assistant',
            content: [],
            createdAt: new Date(entry.timestamp),
            status: { type: 'running' } as const,
          }
        }
        currentAssistant.content.push({ type: 'reasoning', text: entry.content })
        break

      case 'assistant':
        // Start or extend an assistant message with text
        if (!currentAssistant) {
          currentAssistant = {
            id: generateId(),
            role: 'assistant',
            content: [],
            createdAt: new Date(entry.timestamp),
            status: { type: 'running' } as const,
          }
        }
        if (entry.content) {
          currentAssistant.content.push({ type: 'text', text: entry.content })
        }
        break

      case 'tool_use':
        // Add tool call to current assistant message
        if (!currentAssistant) {
          currentAssistant = {
            id: generateId(),
            role: 'assistant',
            content: [],
            createdAt: new Date(entry.timestamp),
            status: { type: 'running' } as const,
          }
        }
        currentAssistant.content.push({
          type: 'tool-call',
          toolCallId: `tc-${entry.toolName}-${entry.timestamp}`,
          toolName: entry.toolName || 'unknown',
          args: entry.toolInput ?? {},
        })
        break

      case 'tool':
        // Attach result to the matching tool-call in current assistant message
        if (currentAssistant) {
          const toolCalls = currentAssistant.content.filter(
            (p): p is Extract<ContentPart, { type: 'tool-call' }> =>
              p.type === 'tool-call' && p.toolName === entry.toolName && p.result === undefined
          )
          const target = toolCalls[toolCalls.length - 1]
          if (target) {
            try {
              target.result = JSON.parse(entry.content)
            } catch {
              target.result = entry.content
            }
          }
        }
        break
    }
  }

  // Flush remaining assistant message
  if (currentAssistant) {
    currentAssistant.status = { type: 'complete', reason: 'stop' } as const
    messages.push(currentAssistant)
  }

  return messages
}

/** Content part types accepted by ThreadMessageLike */
type AuiContentPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'reasoning'; readonly text: string }
  | { readonly type: 'tool-call'; readonly toolCallId: string; readonly toolName: string; readonly args: Record<string, unknown>; readonly result?: unknown }

/** Convert InternalMessage → ThreadMessageLike for assistant-ui */
function toThreadMessage(msg: InternalMessage): ThreadMessageLike {
  const content: AuiContentPart[] = msg.content.map((part): AuiContentPart => {
    switch (part.type) {
      case 'reasoning':
        return { type: 'reasoning', text: part.text }
      case 'tool-call':
        return {
          type: 'tool-call',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          args: part.args,
          result: part.result,
        }
      case 'text':
      default:
        return { type: 'text', text: part.text }
    }
  })
  return {
    id: msg.id,
    role: msg.role,
    content: content as ThreadMessageLike['content'],
    createdAt: msg.createdAt,
    status: msg.status,
  }
}

// ── Main Component ────────────────────────────────────────────────

export function AssistantUIComponent({ session, agentName, agentId, modelId, projectCwd }: ChatRendererProps) {
  const msSession = session as ApiSession
  const [messages, setMessages] = useState<InternalMessage[]>(() =>
    convertChatHistory(msSession.chatHistory)
  )
  const [isRunning, setIsRunning] = useState(false)
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  // ── Stream LLMEvents into message state ──────────────────────────

  useEffect(() => {
    let streamingText = ''
    let streamingThinking = ''
    let streamingToolCalls = new Map<string, { toolName: string; args: Record<string, unknown> }>()
    let streamingMsgId: string | null = null

    const buildStreamingMessage = (): InternalMessage => {
      const parts: ContentPart[] = []
      if (streamingThinking) {
        parts.push({ type: 'reasoning', text: streamingThinking })
      }
      if (streamingText) {
        parts.push({ type: 'text', text: streamingText })
      }
      for (const [toolId, tc] of streamingToolCalls) {
        parts.push({
          type: 'tool-call',
          toolCallId: toolId,
          toolName: tc.toolName,
          args: tc.args,
        })
      }
      return {
        id: streamingMsgId || generateId(),
        role: 'assistant',
        content: parts.length > 0 ? parts : [{ type: 'text', text: '' }],
        createdAt: new Date(),
        status: { type: 'running' } as const,
      }
    }

    const updateStreamingMessage = () => {
      if (!streamingMsgId) {
        streamingMsgId = generateId()
      }
      const msg = buildStreamingMessage()
      setMessages(prev => {
        const existing = prev.findIndex(m => m.id === streamingMsgId)
        if (existing >= 0) {
          const next = [...prev]
          next[existing] = msg
          return next
        }
        return [...prev, msg]
      })
    }

    const handleEvent: LLMEventCallback = (event: LLMEvent) => {
      switch (event.type) {
        case 'text':
          streamingText += event.text
          setIsRunning(true)
          updateStreamingMessage()
          break

        case 'thinking':
          streamingThinking += event.text
          setIsRunning(true)
          updateStreamingMessage()
          break

        case 'tool_use':
          streamingToolCalls.set(event.toolUseId, {
            toolName: event.toolName,
            args: event.input,
          })
          setIsRunning(true)
          updateStreamingMessage()
          break

        case 'tool_result':
          // Sync from session's authoritative chatHistory to pick up results
          setMessages(convertChatHistory(msSession.chatHistory))
          break

        case 'turn_end':
          // Final sync from session history
          setMessages(convertChatHistory(msSession.chatHistory))
          setIsRunning(false)
          // Reset streaming state
          streamingText = ''
          streamingThinking = ''
          streamingToolCalls = new Map()
          streamingMsgId = null
          break

        case 'error':
          setIsRunning(false)
          // Add error as an assistant message
          setMessages(prev => [
            ...prev,
            {
              id: generateId(),
              role: 'assistant',
              content: [{ type: 'text', text: `Error: ${event.message}` }],
              createdAt: new Date(),
              status: { type: 'incomplete', reason: 'error' } as const,
            },
          ])
          streamingText = ''
          streamingThinking = ''
          streamingToolCalls = new Map()
          streamingMsgId = null
          break
      }
    }

    session.onEvent(handleEvent)
    return () => {
      if (msSession.offEvent) {
        msSession.offEvent(handleEvent)
      }
    }
  }, [session, msSession])

  // ── ExternalStoreRuntime handlers ────────────────────────────────

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const textPart = message.content.find(p => p.type === 'text')
      if (!textPart || textPart.type !== 'text') return
      session.sendInput(textPart.text)
      // sendInput adds to chatHistory — sync state
      setMessages(convertChatHistory(msSession.chatHistory))
    },
    [session, msSession],
  )

  const onCancel = useCallback(async () => {
    session.kill()
    setIsRunning(false)
  }, [session])

  const convertMessage = useCallback(
    (msg: InternalMessage): ThreadMessageLike => toThreadMessage(msg),
    [],
  )

  // ── Create runtime ──────────────────────────────────────────────

  const runtime = useExternalStoreRuntime({
    messages,
    isRunning,
    onNew,
    onCancel,
    convertMessage,
  })

  // ── Render ──────────────────────────────────────────────────────

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AssistantUIThread agentName={agentName} modelId={modelId} />
    </AssistantRuntimeProvider>
  )
}
