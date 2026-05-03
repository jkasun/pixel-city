// ── Chat View ───────────────────────────────────────────────────────
// Message-based UI for LLM providers that don't use a terminal (PTY).
// Renders conversation history with streaming support.
// Messages are persisted in the session's chatHistory so they survive remounts.

import React, { useState, useRef, useEffect, useCallback } from 'react'
import type { LLMSession } from './llm/LLMSession.js'
import type { LLMEvent, LLMEventCallback } from './llm/types.js'

/** Display-ready message shared by API-based sessions */
interface DisplayMessage {
  role: 'user' | 'assistant' | 'thinking' | 'tool' | 'tool_use'
  content: string
  timestamp: number
  toolName?: string
  /** Tool input params (for tool_use display) */
  toolInput?: Record<string, unknown>
}

/** Subset of API session interface needed by ChatView */
interface ApiSession extends LLMSession {
  chatHistory: DisplayMessage[]
  offEvent(callback: LLMEventCallback): void
}

import { formatToolStatusJsonl } from './toolStatus.js'
import { useFileMention } from './hooks/useFileMention.js'
import type { UseProjectFilesReturn } from './hooks/useProjectFiles.js'
import { getFileIconData } from './files/fileTypes.js'
import { FileSmallIcon, FolderSmallIcon } from './icons/index.js'

function HighlightedPath({ text, indices }: { text: string; indices: number[] }) {
  if (!indices.length) return <>{text}</>
  const set = new Set(indices)
  const parts: React.ReactNode[] = []
  let run = ''
  let inMatch = false
  for (let i = 0; i < text.length; i++) {
    const isMatch = set.has(i)
    if (isMatch !== inMatch && run) {
      parts.push(inMatch ? <span key={i} style={{ color: 'var(--accent)', fontWeight: 600 }}>{run}</span> : run)
      run = ''
    }
    run += text[i]
    inMatch = isMatch
  }
  if (run) parts.push(inMatch ? <span key={text.length} style={{ color: 'var(--accent)', fontWeight: 600 }}>{run}</span> : run)
  return <>{parts}</>
}

interface ChatViewProps {
  session: LLMSession
  agentName: string
  modelId: string
  projectCwd?: string | null
  projectFiles?: UseProjectFilesReturn
}

export function ChatView({ session, agentName, modelId, projectCwd, projectFiles }: ChatViewProps) {
  // Read persisted history from session (survives component remounts)
  const msSession = session as ApiSession
  const [messages, setMessages] = useState<DisplayMessage[]>(() => [...msSession.chatHistory])
  const [streamingText, setStreamingText] = useState('')
  const [streamingThinking, setStreamingThinking] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [inputText, setInputText] = useState('')
  const [showThinking, setShowThinking] = useState<Set<number>>(new Set())
  const [activeTools, setActiveTools] = useState<Map<string, { toolName: string; input: Record<string, unknown> }>>(new Map())
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const inputWrapperRef = useRef<HTMLDivElement>(null)
  const mentionListRef = useRef<HTMLDivElement>(null)

  // @-mention file autocomplete
  const mention = useFileMention(projectCwd ?? null, inputText, setInputText, inputRef, projectFiles)

  // Scroll selected mention item into view
  useEffect(() => {
    if (!mention.isOpen || !mentionListRef.current) return
    const items = mentionListRef.current.querySelectorAll('[data-mention-item]')
    const selected = items[mention.selectedIndex] as HTMLElement | undefined
    selected?.scrollIntoView({ block: 'nearest' })
  }, [mention.isOpen, mention.selectedIndex])

  // Auto-scroll to bottom
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => { scrollToBottom() }, [messages, streamingText, scrollToBottom])

  // Subscribe to session events with proper cleanup
  useEffect(() => {
    let currentText = ''
    let currentThinking = ''

    const handleEvent = (event: LLMEvent) => {
      switch (event.type) {
        case 'text':
          currentText += event.text
          setStreamingText(currentText)
          setIsStreaming(true)
          break
        case 'thinking':
          currentThinking += event.text
          setStreamingThinking(currentThinking)
          setIsStreaming(true)
          break
        case 'tool_use':
          setActiveTools(prev => {
            const next = new Map(prev)
            next.set(event.toolUseId, { toolName: event.toolName, input: event.input })
            return next
          })
          break
        case 'tool_result':
          setActiveTools(prev => {
            const next = new Map(prev)
            next.delete(event.toolUseId)
            return next
          })
          // Sync messages to pick up newly added tool_use and tool entries from chatHistory
          setMessages([...msSession.chatHistory])
          break
        case 'turn_end':
          // Sync from session's authoritative chatHistory
          setMessages([...msSession.chatHistory])
          setActiveTools(new Map())
          currentText = ''
          currentThinking = ''
          setStreamingText('')
          setStreamingThinking('')
          setIsStreaming(false)
          break
        case 'error':
          setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${event.message}`, timestamp: Date.now() }])
          setIsStreaming(false)
          currentText = ''
          currentThinking = ''
          setStreamingText('')
          setStreamingThinking('')
          break
      }
    }

    session.onEvent(handleEvent)
    return () => {
      // Clean up listener on unmount
      if ('offEvent' in session && typeof (session as ApiSession).offEvent === 'function') {
        (session as ApiSession).offEvent(handleEvent)
      }
    }
  }, [session, msSession])

  const handleSend = useCallback(() => {
    const text = inputText.trim()
    if (!text || isStreaming) return

    setInputText('')
    session.sendInput(text)
    // Sync from session's chatHistory (sendInput adds the user message there)
    setMessages([...msSession.chatHistory])

    // Focus back to input
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [inputText, isStreaming, session, msSession])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Let mention dropdown consume navigation keys first
    if (mention.handleKeyDown(e)) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend, mention.handleKeyDown])

  const toggleThinking = useCallback((idx: number) => {
    setShowThinking(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }, [])

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      width: '100%',
      background: 'var(--bg)',
      color: 'var(--text)',
      fontFamily: 'var(--font-ui)',
    }}>
      {/* Header */}
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 12,
        color: 'var(--text-muted)',
        flexShrink: 0,
      }}>
        <span style={{ color: 'var(--text)', fontWeight: 500 }}>{agentName}</span>
        <span style={{ fontSize: 10, opacity: 0.7 }}>{modelId}</span>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '12px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}>
        {messages.length === 0 && !isStreaming && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'var(--text-dim)',
            fontSize: 13,
          }}>
            Send a message to start chatting
          </div>
        )}

        {messages.map((msg, i) => {
          if (msg.role === 'thinking') {
            // Render thinking blocks as collapsible
            const isExpanded = showThinking.has(i)
            return (
              <div key={i} style={{ paddingLeft: 8 }}>
                <button
                  onClick={() => toggleThinking(i)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-dim)',
                    cursor: 'pointer',
                    fontSize: 11,
                    padding: '2px 0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <span style={{ fontSize: 8, transition: 'transform 0.15s', transform: isExpanded ? 'rotate(90deg)' : 'none' }}>
                    &#9654;
                  </span>
                  Thinking
                </button>
                {isExpanded && (
                  <div style={{
                    marginTop: 4,
                    padding: '8px 10px',
                    background: 'rgba(255,255,255,0.03)',
                    borderLeft: '2px solid rgba(255,255,255,0.1)',
                    fontSize: 12,
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    color: 'var(--text-dim)',
                    maxHeight: 300,
                    overflowY: 'auto',
                  }}>
                    {msg.content}
                  </div>
                )}
              </div>
            )
          }

          if (msg.role === 'tool_use') {
            // Render tool invocation as a compact status line
            const statusText = formatToolStatusJsonl(msg.toolName || 'tool', msg.toolInput ?? {})
            return (
              <div key={i} style={{ paddingLeft: 8 }}>
                <div style={{
                  fontSize: 11,
                  color: 'var(--text-dim)',
                  padding: '4px 8px',
                  background: 'rgba(100, 160, 255, 0.06)',
                  borderLeft: '2px solid rgba(100, 160, 255, 0.3)',
                  borderRadius: '0 4px 4px 0',
                  fontFamily: 'var(--font-mono, monospace)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}>
                  <span style={{ color: 'rgba(100, 160, 255, 0.7)', fontSize: 10 }}>&#9654;</span>
                  <span style={{ color: 'rgba(100, 160, 255, 0.8)' }}>{statusText}</span>
                </div>
              </div>
            )
          }

          if (msg.role === 'tool') {
            // Render tool results as compact blocks
            return (
              <div key={i} style={{ paddingLeft: 8 }}>
                <div style={{
                  fontSize: 11,
                  color: 'var(--text-dim)',
                  padding: '4px 8px',
                  background: 'rgba(92, 154, 125, 0.08)',
                  borderLeft: '2px solid rgba(92, 154, 125, 0.3)',
                  borderRadius: '0 4px 4px 0',
                  fontFamily: 'var(--font-mono, monospace)',
                }}>
                  <span style={{ color: 'rgba(92, 154, 125, 0.7)', marginRight: 6 }}>{msg.toolName || 'tool'}</span>
                  <span style={{ opacity: 0.7 }}>{msg.content.length > 200 ? msg.content.slice(0, 200) + '\u2026' : msg.content}</span>
                </div>
              </div>
            )
          }

          return (
            <div
              key={i}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              <div style={{
                maxWidth: '85%',
                padding: '8px 12px',
                borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                background: msg.role === 'user'
                  ? 'rgba(92, 154, 125, 0.15)'
                  : 'rgba(255, 255, 255, 0.05)',
                border: `1px solid ${msg.role === 'user' ? 'rgba(92, 154, 125, 0.25)' : 'rgba(255, 255, 255, 0.08)'}`,
                fontSize: 13,
                lineHeight: 1.55,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {msg.content}
              </div>
            </div>
          )
        })}

        {/* Active tool calls (real-time) */}
        {activeTools.size > 0 && Array.from(activeTools.entries()).map(([toolId, { toolName, input }]) => {
          const statusText = formatToolStatusJsonl(toolName, input)
          return (
            <div key={`active-${toolId}`} style={{ paddingLeft: 8 }}>
              <div style={{
                fontSize: 11,
                color: 'var(--text-dim)',
                padding: '4px 8px',
                background: 'rgba(100, 160, 255, 0.06)',
                borderLeft: '2px solid rgba(100, 160, 255, 0.4)',
                borderRadius: '0 4px 4px 0',
                fontFamily: 'var(--font-mono, monospace)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}>
                <span style={{
                  display: 'inline-flex', gap: 2,
                  color: 'rgba(100, 160, 255, 0.7)',
                  fontSize: 10,
                }}>
                  <span style={{ animation: 'pulse 1.4s infinite', animationDelay: '0s' }}>&#8226;</span>
                  <span style={{ animation: 'pulse 1.4s infinite', animationDelay: '0.2s' }}>&#8226;</span>
                  <span style={{ animation: 'pulse 1.4s infinite', animationDelay: '0.4s' }}>&#8226;</span>
                </span>
                <span style={{ color: 'rgba(100, 160, 255, 0.8)' }}>{statusText}</span>
              </div>
            </div>
          )
        })}

        {/* Streaming thinking indicator */}
        {isStreaming && streamingThinking && !streamingText && (
          <div style={{ paddingLeft: 8 }}>
            <div style={{
              fontSize: 11,
              color: 'var(--text-dim)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              <span className="thinking-dots" style={{ display: 'inline-flex', gap: 2 }}>
                <span style={{ animation: 'pulse 1.4s infinite', animationDelay: '0s' }}>&#8226;</span>
                <span style={{ animation: 'pulse 1.4s infinite', animationDelay: '0.2s' }}>&#8226;</span>
                <span style={{ animation: 'pulse 1.4s infinite', animationDelay: '0.4s' }}>&#8226;</span>
              </span>
              Thinking
            </div>
          </div>
        )}

        {/* Streaming text */}
        {isStreaming && streamingText && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
          }}>
            <div style={{
              maxWidth: '85%',
              padding: '8px 12px',
              borderRadius: '12px 12px 12px 2px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              fontSize: 13,
              lineHeight: 1.55,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {streamingText}
              <span style={{ opacity: 0.5, animation: 'blink 1s infinite' }}>&#9646;</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div ref={inputWrapperRef} style={{
        padding: '8px 12px',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        gap: 8,
        alignItems: 'flex-end',
        flexShrink: 0,
        position: 'relative',
      }}>
        {/* @-mention dropdown */}
        {mention.isOpen && mention.results.length > 0 && (
          <div
            ref={mentionListRef}
            style={{
              position: 'absolute',
              bottom: '100%',
              left: 12,
              right: 60,
              maxHeight: 280,
              overflowY: 'auto',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              boxShadow: '0 -8px 32px rgba(0,0,0,0.4)',
              zIndex: 100,
              padding: '4px 0',
            }}
          >
            <div style={{
              padding: '4px 10px 6px',
              fontSize: 10,
              color: 'var(--text-dim)',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}>
              Files {mention.searchPhase !== 'done' && '(loading...)'}
            </div>
            {mention.results.map((result, idx) => {
              const ext = result.fileName.split('.').pop()?.toLowerCase() ?? ''
              const iconData = result.isFolder ? null : getFileIconData(ext, result.fileName.toLowerCase())
              const isSelected = idx === mention.selectedIndex
              return (
                <div
                  key={result.filePath}
                  data-mention-item
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 10px',
                    cursor: 'pointer',
                    background: isSelected ? 'rgba(92, 154, 125, 0.12)' : 'transparent',
                    transition: 'background 60ms',
                  }}
                  onMouseEnter={() => mention.setSelectedIndex(idx)}
                  onMouseDown={e => {
                    e.preventDefault()
                    mention.selectFile(result)
                    setTimeout(() => inputRef.current?.focus(), 0)
                  }}
                >
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 16, height: 16, borderRadius: 2, flexShrink: 0,
                    fontSize: 8, fontWeight: 700,
                    color: result.isFolder ? 'var(--text-muted)' : iconData!.color,
                  }}>
                    {result.isFolder
                      ? <FolderSmallIcon />
                      : (iconData!.letter || <FileSmallIcon />)}
                  </span>
                  <span style={{
                    fontSize: 12, color: 'var(--text-bright)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {result.fileName}
                  </span>
                  <span style={{
                    fontSize: 11, color: 'var(--text-dim)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    minWidth: 0, flexShrink: 1,
                  }}>
                    <HighlightedPath text={result.relativePath} indices={result.indices} />
                  </span>
                </div>
              )
            })}
          </div>
        )}
        <textarea
          ref={inputRef}
          value={inputText}
          onChange={e => {
            setInputText(e.target.value)
            mention.handleInputChange(e.target.value, e.target.selectionStart ?? e.target.value.length)
          }}
          onKeyDown={handleKeyDown}
          placeholder={isStreaming ? 'Waiting for response...' : 'Type a message...'}
          disabled={isStreaming}
          rows={1}
          style={{
            flex: 1,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '8px 12px',
            color: 'var(--text)',
            fontSize: 13,
            fontFamily: 'var(--font-ui)',
            resize: 'none',
            outline: 'none',
            minHeight: 36,
            maxHeight: 120,
          }}
          onInput={e => {
            const el = e.currentTarget
            el.style.height = 'auto'
            el.style.height = Math.min(el.scrollHeight, 120) + 'px'
          }}
        />
        <button
          onClick={handleSend}
          disabled={isStreaming || !inputText.trim()}
          style={{
            background: isStreaming || !inputText.trim()
              ? 'rgba(92, 154, 125, 0.1)'
              : 'rgba(92, 154, 125, 0.25)',
            border: '1px solid rgba(92, 154, 125, 0.3)',
            borderRadius: 8,
            padding: '8px 16px',
            color: isStreaming || !inputText.trim() ? 'var(--text-dim)' : 'var(--accent)',
            cursor: isStreaming || !inputText.trim() ? 'default' : 'pointer',
            fontSize: 13,
            fontFamily: 'var(--font-ui)',
            fontWeight: 500,
            flexShrink: 0,
          }}
        >
          Send
        </button>
      </div>

      {/* CSS animations */}
      <style>{`
        @keyframes pulse {
          0%, 80%, 100% { opacity: 0.3; }
          40% { opacity: 1; }
        }
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
      `}</style>
    </div>
  )
}
