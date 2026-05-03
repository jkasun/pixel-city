import React from 'react'

type Props = {
  name: string
  err: Error
  retry: () => void
}

/** Convert "office-canvas" -> "Office canvas". */
function prettifyName(name: string): string {
  const spaced = name.replace(/-/g, ' ')
  if (!spaced) return spaced
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function truncate(s: string, max = 200): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

/** Default fallback for <Bulkhead>. Dark, full-bleed, with a retry button. */
export function DegradedPanel({ name, err, retry }: Props) {
  const errClass = err.name || 'Error'
  const errMessage = truncate(err.message || 'unknown error')
  return (
    <div style={styles.container}>
      <div style={styles.accent} />
      <div style={styles.card}>
        <div style={styles.title}>⚠ {prettifyName(name)} crashed</div>
        <pre style={styles.detail}>{errClass + ': ' + errMessage}</pre>
        <div style={styles.actions}>
          <button style={styles.btnPrimary} onClick={retry}>Retry</button>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    background: '#1a1a1f',
    color: '#d8d8dc',
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    overflow: 'auto',
  },
  accent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    background: '#e05050',
  },
  card: {
    maxWidth: 520,
    padding: '24px 28px',
    textAlign: 'left' as const,
  },
  title: {
    margin: '0 0 12px',
    fontSize: 14,
    fontWeight: 600,
    color: '#f4f4f6',
  },
  detail: {
    margin: '0 0 16px',
    padding: '10px 14px',
    borderRadius: 6,
    background: '#0f0f13',
    border: '1px solid #2a2a31',
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: 12,
    color: '#e05050',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    maxHeight: 160,
    overflow: 'auto',
  },
  actions: {
    display: 'flex',
    gap: 10,
  },
  btnPrimary: {
    padding: '6px 16px',
    borderRadius: 6,
    border: 'none',
    background: '#5c9a7d',
    color: '#fff',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
}
