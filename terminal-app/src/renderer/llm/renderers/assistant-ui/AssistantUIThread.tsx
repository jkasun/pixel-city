// ── Assistant UI Thread ──────────────────────────────────────────────
// Custom Thread component built with assistant-ui primitives.
// Styled to match Pixel City's dark theme without requiring shadcn/ui.

import React, { type FC } from 'react'
import {
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
} from '@assistant-ui/react'
import type { ToolCallMessagePartProps, ReasoningMessagePartProps } from '@assistant-ui/react'
import { MarkdownText } from './MarkdownText.js'

interface AssistantUIThreadProps {
  agentName: string
  modelId: string
}

export const AssistantUIThread: FC<AssistantUIThreadProps> = ({ agentName, modelId }) => {
  return (
    <div className="aui-root">
      {/* Header */}
      <div className="aui-header">
        <span className="aui-header-name">{agentName}</span>
        <span className="aui-header-model">{modelId}</span>
        <span className="aui-header-badge">assistant-ui</span>
      </div>

      {/* Thread viewport */}
      <ThreadPrimitive.Root className="aui-thread-root">
        <ThreadPrimitive.Viewport autoScroll className="aui-viewport">
          <ThreadPrimitive.Empty>
            <div className="aui-empty">
              Send a message to start chatting
            </div>
          </ThreadPrimitive.Empty>

          <ThreadPrimitive.Messages
            components={{
              UserMessage: UserMessage,
              AssistantMessage: AssistantMessage,
            }}
          />
        </ThreadPrimitive.Viewport>

        {/* Composer */}
        <ComposerPrimitive.Root className="aui-composer">
          <ComposerPrimitive.Input
            placeholder="Type a message..."
            rows={1}
            autoFocus
            className="aui-composer-input"
          />
          <ComposerPrimitive.Send className="aui-composer-send">
            Send
          </ComposerPrimitive.Send>
        </ComposerPrimitive.Root>
      </ThreadPrimitive.Root>

      <style>{`
        .aui-root {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
          background: var(--bg);
          color: var(--text);
          font-family: var(--font-ui);
        }
        .aui-header {
          padding: 8px 12px;
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: var(--text-muted);
          flex-shrink: 0;
        }
        .aui-header-name { color: var(--text); font-weight: 500; }
        .aui-header-model { font-size: 10px; opacity: 0.7; }
        .aui-header-badge {
          margin-left: auto;
          font-size: 9px;
          padding: 2px 6px;
          border-radius: 8px;
          background: rgba(92, 154, 125, 0.12);
          color: var(--accent);
          font-weight: 600;
          letter-spacing: 0.02em;
        }
        .aui-thread-root {
          display: flex;
          flex-direction: column;
          flex: 1;
          overflow: hidden;
        }
        .aui-viewport {
          flex: 1;
          overflow-y: auto;
          padding: 12px 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .aui-empty {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: var(--text-dim);
          font-size: 13px;
        }
        .aui-composer {
          padding: 8px 12px;
          border-top: 1px solid var(--border);
          display: flex;
          gap: 8px;
          align-items: flex-end;
          flex-shrink: 0;
        }
        .aui-composer-input {
          flex: 1;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 8px 12px;
          color: var(--text);
          font-size: 13px;
          font-family: var(--font-ui);
          resize: none;
          outline: none;
          min-height: 36px;
          max-height: 120px;
        }
        .aui-composer-input:focus {
          border-color: var(--accent);
        }
        .aui-composer-send {
          background: rgba(92, 154, 125, 0.25);
          border: 1px solid rgba(92, 154, 125, 0.3);
          border-radius: 8px;
          padding: 8px 16px;
          color: var(--accent);
          cursor: pointer;
          font-size: 13px;
          font-family: var(--font-ui);
          font-weight: 500;
          flex-shrink: 0;
        }
        .aui-composer-send:hover {
          background: rgba(92, 154, 125, 0.35);
        }
        .aui-composer-send:disabled {
          opacity: 0.4;
          cursor: default;
        }
        .aui-user-msg {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
        }
        .aui-user-bubble {
          max-width: 85%;
          padding: 8px 12px;
          border-radius: 12px 12px 2px 12px;
          background: rgba(92, 154, 125, 0.15);
          border: 1px solid rgba(92, 154, 125, 0.25);
          font-size: 13px;
          line-height: 1.55;
          word-break: break-word;
          white-space: pre-wrap;
        }
        .aui-assistant-msg {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 4px;
        }
        .aui-assistant-bubble {
          max-width: 85%;
          padding: 8px 12px;
          border-radius: 12px 12px 12px 2px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.08);
          font-size: 13px;
          line-height: 1.55;
          word-break: break-word;
        }
        .aui-tool-call {
          padding-left: 8px;
          margin-top: 4px;
          margin-bottom: 4px;
        }
        .aui-tool-inner {
          font-size: 11px;
          color: var(--text-dim);
          padding: 4px 8px;
          border-radius: 0 4px 4px 0;
          font-family: var(--font-mono, monospace);
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .aui-tool-running {
          background: rgba(100, 160, 255, 0.06);
          border-left: 2px solid rgba(100, 160, 255, 0.4);
        }
        .aui-tool-done {
          background: rgba(92, 154, 125, 0.08);
          border-left: 2px solid rgba(92, 154, 125, 0.3);
        }
        .aui-reasoning {
          padding-left: 8px;
          margin-bottom: 4px;
        }
        .aui-reasoning-inner {
          font-size: 11px;
          color: var(--text-dim);
          padding: 4px 8px;
          background: rgba(255, 255, 255, 0.03);
          border-left: 2px solid rgba(255, 255, 255, 0.1);
          border-radius: 0 4px 4px 0;
          max-height: 200px;
          overflow-y: auto;
          white-space: pre-wrap;
          line-height: 1.5;
        }
        .aui-markdown h1, .aui-markdown h2, .aui-markdown h3 {
          margin: 8px 0 4px;
          color: var(--text-bright);
        }
        .aui-markdown p { margin: 4px 0; }
        .aui-markdown code {
          background: rgba(255,255,255,0.08);
          padding: 1px 4px;
          border-radius: 3px;
          font-size: 12px;
          font-family: var(--font-mono, monospace);
        }
        .aui-markdown pre {
          background: rgba(0,0,0,0.3);
          padding: 8px 10px;
          border-radius: 6px;
          overflow-x: auto;
          margin: 6px 0;
        }
        .aui-markdown pre code {
          background: transparent;
          padding: 0;
        }
        .aui-markdown ul, .aui-markdown ol {
          padding-left: 18px;
          margin: 4px 0;
        }
        .aui-markdown a {
          color: var(--accent);
          text-decoration: none;
        }
        .aui-markdown blockquote {
          border-left: 2px solid var(--border);
          padding-left: 10px;
          margin: 6px 0;
          color: var(--text-muted);
        }
        .aui-root *::-webkit-scrollbar { width: 6px; }
        .aui-root *::-webkit-scrollbar-track { background: transparent; }
        .aui-root *::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
        @keyframes aui-pulse {
          0%, 80%, 100% { opacity: 0.3; }
          40% { opacity: 1; }
        }
      `}</style>
    </div>
  )
}

// ── User Message ──────────────────────────────────────────────────

const UserMessage: FC = () => {
  return (
    <div className="aui-user-msg">
      <MessagePrimitive.Root className="aui-user-bubble">
        <MessagePrimitive.Content
          components={{
            Text: ({ text }) => <span>{text}</span>,
          }}
        />
      </MessagePrimitive.Root>
    </div>
  )
}

// ── Assistant Message ─────────────────────────────────────────────

const AssistantMessage: FC = () => {
  return (
    <div className="aui-assistant-msg">
      <MessagePrimitive.Root>
        <MessagePrimitive.Content
          components={{
            Text: AssistantTextPart,
            Reasoning: ReasoningPart,
            tools: {
              Fallback: ToolCallPart,
            },
          }}
        />
      </MessagePrimitive.Root>
    </div>
  )
}

// ── Text Part with Markdown ──────────────────────────────────────

const AssistantTextPart: FC<{ text: string }> = ({ text }) => {
  return (
    <div className="aui-assistant-bubble">
      <MarkdownText text={text} />
    </div>
  )
}

// ── Reasoning Part ───────────────────────────────────────────────

const ReasoningPart: FC<ReasoningMessagePartProps> = ({ text }) => {
  return (
    <div className="aui-reasoning">
      <div className="aui-reasoning-inner">
        {text}
      </div>
    </div>
  )
}

// ── Tool Call Part ────────────────────────────────────────────────

const ToolCallPart: FC<ToolCallMessagePartProps> = ({ toolName, args, result }) => {
  const hasResult = result !== undefined
  const isRunning = !hasResult

  return (
    <div className="aui-tool-call">
      <div className={`aui-tool-inner ${isRunning ? 'aui-tool-running' : 'aui-tool-done'}`}>
        {isRunning ? (
          <span style={{ display: 'inline-flex', gap: 2, color: 'rgba(100, 160, 255, 0.7)', fontSize: 10 }}>
            <span style={{ animation: 'aui-pulse 1.4s infinite', animationDelay: '0s' }}>&#8226;</span>
            <span style={{ animation: 'aui-pulse 1.4s infinite', animationDelay: '0.2s' }}>&#8226;</span>
            <span style={{ animation: 'aui-pulse 1.4s infinite', animationDelay: '0.4s' }}>&#8226;</span>
          </span>
        ) : (
          <span style={{ color: 'rgba(92, 154, 125, 0.7)', fontSize: 10 }}>&#10003;</span>
        )}
        <span style={{ color: isRunning ? 'rgba(100, 160, 255, 0.8)' : 'rgba(92, 154, 125, 0.8)' }}>
          {toolName}
        </span>
        {typeof args === 'object' && args !== null && Object.keys(args as object).length > 0 && (
          <span style={{ opacity: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
            {JSON.stringify(args).slice(0, 80)}
          </span>
        )}
      </div>
    </div>
  )
}
