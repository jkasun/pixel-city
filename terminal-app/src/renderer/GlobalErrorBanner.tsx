import React, { useEffect, useState } from 'react'
import { subscribeGlobalErrors, dismissGlobalError, clearGlobalErrors, type GlobalErrorEntry } from './globalErrors.js'
import { log, type LogEntry } from './logger'

export function GlobalErrorBanner() {
  const [entries, setEntries] = useState<GlobalErrorEntry[]>([])
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [, setLoggerBanner] = useState<LogEntry | null>(null)

  useEffect(() => subscribeGlobalErrors(setEntries), [])
  useEffect(() => log.subscribe(e => { if (e.level === 'error' || e.level === 'fatal') setLoggerBanner(e) }), [])

  if (entries.length === 0) return null

  const latest = entries[entries.length - 1]
  const hidden = entries.length - 1

  return (
    <div style={styles.wrap} role="alert" aria-live="assertive">
      <div style={styles.row}>
        <span style={styles.tag}>{latest.source === 'unhandledrejection' ? 'promise' : 'error'}</span>
        <span style={styles.msg} title={latest.message}>{latest.message}</span>
        {hidden > 0 && <span style={styles.count}>+{hidden} more</span>}
        <button style={styles.btn} onClick={() => setExpandedId(expandedId === latest.id ? null : latest.id)}>
          {expandedId === latest.id ? 'hide' : 'details'}
        </button>
        <button style={styles.btn} onClick={() => dismissGlobalError(latest.id)}>dismiss</button>
        {entries.length > 1 && (
          <button style={styles.btn} onClick={clearGlobalErrors}>clear all</button>
        )}
      </div>
      {expandedId === latest.id && latest.stack && (
        <pre style={styles.stack}>{latest.stack}</pre>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 99999,
    background: '#3d2020',
    color: '#ffd4d4',
    borderBottom: '1px solid #5a2a2a',
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12,
    pointerEvents: 'auto',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
  },
  tag: {
    background: '#5a2a2a',
    color: '#ffb0b0',
    padding: '1px 6px',
    borderRadius: 3,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    flexShrink: 0,
  },
  msg: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  count: {
    color: '#ff9090',
    fontSize: 11,
    flexShrink: 0,
  },
  btn: {
    background: 'transparent',
    border: '1px solid #5a2a2a',
    color: '#ffd4d4',
    padding: '2px 8px',
    borderRadius: 3,
    fontSize: 11,
    cursor: 'pointer',
    flexShrink: 0,
  },
  stack: {
    margin: 0,
    padding: '8px 10px',
    background: '#2a1616',
    color: '#e8a0a0',
    borderTop: '1px solid #5a2a2a',
    fontSize: 11,
    maxHeight: 200,
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
}
