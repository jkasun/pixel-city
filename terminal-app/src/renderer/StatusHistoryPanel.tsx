/**
 * StatusHistoryPanel — Shows a chronological log of agent status messages
 * (the text shown above agent heads via MCP show_current_status).
 */

import React, { useMemo, useRef, useEffect, useState } from 'react'
import type { StatusHistoryEntry } from './appTypes.js'
import { StatusDisplay } from './StatusDisplay.js'

interface StatusHistoryPanelProps {
  history: StatusHistoryEntry[]
  selectedAgentId: string | null
  agentIds: string[]
  agentNames: Map<string, string>
  agentPalettes: Map<string, number>
}

const PALETTE_COLORS = [
  '#e8c89a', '#c8a878', '#a08060', '#6b4e35', '#4a3525', '#d4b896',
]

function agentColor(palette: number): string {
  return PALETTE_COLORS[palette % PALETTE_COLORS.length]
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
  return new Date(ts).toLocaleDateString()
}

const styles = `
.status-history { display: flex; flex-direction: column; height: 100%; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
.status-history-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.status-history-header h3 { margin: 0; font-size: 12px; font-weight: 600; color: var(--text-bright); letter-spacing: 0.02em; }
.status-history-filter { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.status-history-filter select { font-size: 11px; background: var(--bg-input); border: 1px solid var(--border); color: var(--text); border-radius: 4px; padding: 3px 8px; outline: none; }
.status-history-count { font-size: 10px; color: var(--text-muted); margin-left: auto; }
.status-history-list { flex: 1; overflow-y: auto; padding: 4px 0; }
.status-history-empty { padding: 40px 20px; text-align: center; color: var(--text-dim); font-size: 12px; }
.status-entry { display: flex; align-items: flex-start; gap: 10px; margin: 1px 8px; padding: 7px 10px; background: var(--bg-input); border: 1px solid var(--border); border-radius: 5px; transition: border-color 0.15s; }
.status-entry:hover { border-color: var(--accent); }
.status-entry-dot { width: 6px; height: 6px; border-radius: 50%; margin-top: 5px; flex-shrink: 0; }
.status-entry-content { flex: 1; min-width: 0; }
.status-entry-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px; }
.status-entry-agent { font-size: 10px; font-weight: 600; }
.status-entry-time { font-size: 9px; color: var(--text-dim); white-space: nowrap; }
.status-entry-text { font-size: 11px; color: var(--text-muted); }
`

export function StatusHistoryPanel({ history, selectedAgentId, agentIds, agentNames, agentPalettes }: StatusHistoryPanelProps) {
  const [filterAgent, setFilterAgent] = useState<string | 'all'>('all')
  const listRef = useRef<HTMLDivElement>(null)
  const wasAtBottomRef = useRef(true)

  const effectiveFilter = selectedAgentId && filterAgent === 'all' ? selectedAgentId : filterAgent

  const filtered = useMemo(() => {
    if (effectiveFilter === 'all') return history
    return history.filter(e => e.agentId === effectiveFilter)
  }, [history, effectiveFilter])

  // Auto-scroll to bottom when new entries arrive (if already at bottom)
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    if (wasAtBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [filtered.length])

  const handleScroll = () => {
    const el = listRef.current
    if (!el) return
    wasAtBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 20
  }

  const agentLabel = (id: string) => agentNames.get(id) ?? `Agent #${id}`

  return (
    <div className="status-history">
      <style>{styles}</style>

      <div className="status-history-header">
        <h3>Status History</h3>
      </div>

      <div className="status-history-filter">
        <select value={filterAgent} onChange={e => setFilterAgent(e.target.value)}>
          <option value="all">All agents</option>
          {agentIds.map(id => (
            <option key={id} value={id}>{agentLabel(id)}</option>
          ))}
        </select>
        <span className="status-history-count">
          {filtered.length} entr{filtered.length !== 1 ? 'ies' : 'y'}
        </span>
      </div>

      <div className="status-history-list" ref={listRef} onScroll={handleScroll}>
        {filtered.length === 0 ? (
          <div className="status-history-empty">
            No status updates yet.
          </div>
        ) : (
          filtered.map((entry, i) => {
            const palette = agentPalettes.get(entry.agentId) ?? 0
            return (
              <div className="status-entry" key={`${entry.agentId}-${entry.timestamp}-${i}`}>
                <div className="status-entry-dot" style={{ backgroundColor: agentColor(palette) }} />
                <div className="status-entry-content">
                  <div className="status-entry-top">
                    <span className="status-entry-agent" style={{ color: agentColor(palette) }}>
                      {agentLabel(entry.agentId)}
                    </span>
                    <span className="status-entry-time" title={new Date(entry.timestamp).toLocaleString()}>
                      {formatTime(entry.timestamp)} &middot; {timeAgo(entry.timestamp)}
                    </span>
                  </div>
                  <div className="status-entry-text">
                    <StatusDisplay text={entry.text} />
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
