/**
 * MessagesView -- Agent inbox view.
 *
 * Shows messages addressed to the selected agent. Polls for updates.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { getMessageStore } from '../messaging/index.js'
import type { AgentMessage } from '../messaging/types.js'

interface MessagesViewProps {
  /** Currently selected agent ID, or null for global view */
  selectedAgentId: string | null
  /** All agent IDs currently in the office */
  agentIds: string[]
  /** Agent name lookup */
  agentNames: ReadonlyMap<string, string>
  /** Agent palette lookup */
  agentPalettes: ReadonlyMap<string, number>
}

const POLL_INTERVAL_MS = 3000

const PALETTE_COLORS = [
  '#e8c89a', '#c8a878', '#a08060', '#6b4e35', '#4a3525', '#d4b896',
]

function agentColor(palette: number): string {
  return PALETTE_COLORS[palette % PALETTE_COLORS.length]
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
  return new Date(ts).toLocaleDateString()
}

const TYPE_COLORS: Record<string, string> = {
  result: 'var(--accent)',
  status: '#5ac8e8',
  request: '#c49a6c',
  info: 'var(--text-muted)',
}

const styles = `
.messages-view { display: flex; flex-direction: column; flex: 1; min-width: 0; height: 100%; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
.messages-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.messages-header h3 { margin: 0; font-size: 12px; font-weight: 600; color: var(--text-bright); letter-spacing: 0.02em; }
.messages-count { font-size: 10px; color: var(--text-muted); padding: 8px 14px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.messages-list { flex: 1; overflow-y: auto; padding: 4px 0; }
.messages-empty { padding: 40px 20px; text-align: center; color: var(--text-dim); font-size: 12px; }

.msg-card { margin: 2px 8px; padding: 10px 12px; background: var(--bg-input); border: 1px solid var(--border); border-radius: 6px; cursor: default; transition: border-color 0.15s; }
.msg-card:hover { border-color: var(--border); }
.msg-card[data-unread="true"] { border-left: 2px solid var(--accent); }
.msg-card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.msg-card-from { font-size: 11px; font-weight: 600; }
.msg-card-time { font-size: 10px; color: var(--text-dim); }
.msg-card-subject { font-size: 11px; color: var(--text-bright); margin-bottom: 3px; }
.msg-card-body { font-size: 10.5px; color: var(--text-muted); line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
.msg-card-type { display: inline-block; font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; border-radius: 3px; padding: 1px 6px; margin-right: 6px; }
.msg-card-direction { font-size: 9px; color: var(--text-dim); letter-spacing: 0.06em; text-transform: uppercase; }
.msg-card-reply { font-size: 10px; color: var(--text-dim); margin-top: 4px; font-style: italic; }
`

export function MessagesView({ selectedAgentId, agentIds, agentNames, agentPalettes }: MessagesViewProps) {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const targetAgentId = selectedAgentId ?? (agentIds.length === 1 ? agentIds[0] : null)

  const fetchMessages = useCallback(async () => {
    if (targetAgentId === null) {
      setMessages([])
      return
    }
    const store = getMessageStore()
    const msgs = await store.query({ agentId: targetAgentId, unreadOnly: false, limit: 100 })
    setMessages(msgs)
  }, [targetAgentId])

  useEffect(() => {
    fetchMessages()
    pollRef.current = setInterval(fetchMessages, POLL_INTERVAL_MS)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchMessages])

  const agentLabel = (id: string) => agentNames.get(id) ?? `Agent #${id}`

  const handleMarkRead = async (msg: AgentMessage) => {
    if (msg.read) return
    const store = getMessageStore()
    await store.markRead(msg.to, msg.id)
    fetchMessages()
  }

  const unreadCount = messages.filter(m => !m.read).length

  return (
    <div className="messages-view" data-testid="messages-view">
      <style>{styles}</style>

      <div className="messages-header">
        <h3>
          {targetAgentId !== null
            ? `Inbox — ${agentLabel(targetAgentId)}`
            : 'Inbox'}
        </h3>
      </div>

      <div className="messages-count" data-testid="messages-count">
        {messages.length} message{messages.length !== 1 ? 's' : ''}
        {unreadCount > 0 && ` · ${unreadCount} unread`}
      </div>

      <div className="messages-list" data-testid="messages-list">
        {messages.length === 0 && (
          <div className="messages-empty" data-testid="messages-empty">
            {targetAgentId !== null
              ? `No incoming messages for ${agentLabel(targetAgentId)}`
              : 'Select an agent to view their messages.'}
          </div>
        )}

        {messages.map(msg => {
          const isExpanded = expandedId === msg.id
          const fromColor = agentColor(agentPalettes.get(msg.from) ?? 0)

          return (
            <div
              key={msg.id}
              className="msg-card"
              data-testid={`messages-card-${msg.id}`}
              data-unread={!msg.read ? 'true' : undefined}
              onClick={() => {
                setExpandedId(isExpanded ? null : msg.id)
                handleMarkRead(msg)
              }}
            >
              <div className="msg-card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="msg-card-type" style={{ color: TYPE_COLORS[msg.type] ?? 'var(--text-muted)', border: `1px solid ${TYPE_COLORS[msg.type] ?? 'var(--border)'}40` }}>
                    {msg.type}
                  </span>
                  <span className="msg-card-from" style={{ color: fromColor }}>
                    {msg.fromName ?? agentLabel(msg.from)}
                  </span>
                  <span className="msg-card-direction">→ you</span>
                </div>
                <span className="msg-card-time">{timeAgo(msg.timestamp)}</span>
              </div>

              <div className="msg-card-subject" data-testid="messages-card-subject">{msg.subject}</div>

              {isExpanded && (
                <>
                  <div className="msg-card-body">{msg.body}</div>
                  {msg.replyTo && (
                    <div className="msg-card-reply">↩ Reply to {msg.replyTo}</div>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
