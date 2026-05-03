import { useEffect, useRef, useState } from 'react'

export type DebugEventKind = 'tool' | 'thinking' | 'text' | 'clear' | 'system' | 'pty' | 'agent' | 'perm' | 'mcp' | 'ws-rx' | 'ws-tx'

export interface DebugEvent {
  id: number
  ts: string
  agentId: string | number
  kind: DebugEventKind
  label: string
}

const KIND_COLOR: Record<DebugEventKind, string> = {
  tool:     '#5ac88c',
  thinking: '#c87aff',
  text:     '#c8c5be',
  clear:    '#55534f',
  system:   '#5ac8e8',
  pty:      '#c4894a',
  agent:    '#ffaa44',
  perm:     '#ff6b6b',
  mcp:      '#a78bfa',
  'ws-rx':  '#22d3ee',
  'ws-tx':  '#818cf8',
}

const KIND_LABEL: Record<DebugEventKind, string> = {
  tool:     'tool',
  thinking: 'think',
  text:     'text',
  clear:    'clear',
  system:   'sys',
  pty:      'pty',
  agent:    'agent',
  perm:     'perm',
  mcp:      'MCP',
  'ws-rx':  '↓',
  'ws-tx':  '↑',
}

const WS_KINDS = new Set<DebugEventKind>(['ws-rx', 'ws-tx'])

interface DebugPanelProps {
  events: DebugEvent[]
  onClear: () => void
}

function EventList({ events, emptyText }: { events: DebugEvent[]; emptyText: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stuckToBottomRef = useRef(true)

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return
    stuckToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }

  useEffect(() => {
    const el = containerRef.current
    if (stuckToBottomRef.current && el) {
      el.scrollTop = el.scrollHeight
    }
  }, [events])

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'var(--border) transparent' }}
    >
      {events.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', padding: '8px 10px', fontSize: 10 }}>{emptyText}</div>
      ) : (
        events.map(ev => (
          <div
            key={ev.id}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 6,
              padding: '1px 10px',
              borderBottom: '1px solid rgba(255,255,255,0.015)',
              fontSize: 10,
              lineHeight: '18px',
            }}
          >
            <span style={{ color: 'var(--text-dim)', flexShrink: 0, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>
              {ev.ts}
            </span>
            {!WS_KINDS.has(ev.kind) && (
              <span style={{ color: 'var(--text-dim)', flexShrink: 0, width: 14, textAlign: 'right' }}>
                {ev.agentId || ''}
              </span>
            )}
            <span style={{
              color: KIND_COLOR[ev.kind],
              flexShrink: 0,
              width: WS_KINDS.has(ev.kind) ? 16 : 40,
              fontSize: WS_KINDS.has(ev.kind) ? 12 : 9,
              textTransform: WS_KINDS.has(ev.kind) ? 'none' : 'uppercase',
              letterSpacing: WS_KINDS.has(ev.kind) ? 0 : '0.06em',
              fontWeight: WS_KINDS.has(ev.kind) ? 700 : 400,
            }}>
              {KIND_LABEL[ev.kind]}
            </span>
            <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ev.label}
            </span>
          </div>
        ))
      )}
    </div>
  )
}

type Tab = 'events' | 'ws'

export function DebugPanel({ events, onClear }: DebugPanelProps) {
  const [tab, setTab] = useState<Tab>('events')

  const agentEvents = events.filter(ev => !WS_KINDS.has(ev.kind))
  const wsEvents    = events.filter(ev => WS_KINDS.has(ev.kind))

  const tabBtn = (id: Tab, label: string, count: number) => (
    <button
      onClick={() => setTab(id)}
      style={{
        background: 'none',
        border: 'none',
        borderBottom: tab === id ? '1px solid var(--text-dim)' : '1px solid transparent',
        color: tab === id ? 'var(--text)' : 'var(--text-dim)',
        cursor: 'pointer',
        fontSize: 9,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        padding: '3px 8px 2px',
        fontFamily: 'inherit',
        marginBottom: -1,
      }}
    >
      {label}
      {count > 0 && (
        <span style={{ marginLeft: 4, color: 'var(--text-dim)', fontSize: 8 }}>
          {count}
        </span>
      )}
    </button>
  )

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-deep)',
      fontFamily: "'JetBrains Mono', monospace",
      overflow: 'hidden',
    }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        padding: '0 6px 0 4px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', gap: 2 }}>
          {tabBtn('events', 'events', agentEvents.length)}
          {tabBtn('ws', 'websocket', wsEvents.length)}
        </div>
        <button
          onClick={onClear}
          style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 10, padding: '3px 2px', fontFamily: 'inherit' }}
        >
          clear
        </button>
      </div>

      {tab === 'events' && (
        <EventList events={agentEvents} emptyText="waiting for events…" />
      )}
      {tab === 'ws' && (
        <EventList events={wsEvents} emptyText="no WebSocket frames yet…" />
      )}
    </div>
  )
}
