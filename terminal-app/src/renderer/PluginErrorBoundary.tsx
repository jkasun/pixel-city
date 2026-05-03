import React, { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  pluginName: string
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class PluginErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[Plugin:${this.props.pluginName}]`, error, info.componentStack)
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div style={styles.container}>
        <div style={styles.icon}>!</div>
        <div style={styles.title}>{this.props.pluginName} encountered an error</div>
        {this.state.error && (
          <pre style={styles.detail}>{this.state.error.message}</pre>
        )}
        <button style={styles.btn} onClick={this.handleRetry}>
          Retry
        </button>
      </div>
    )
  }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    width: '100%',
    padding: 24,
    gap: 12,
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: '#3d2020',
    color: '#e05050',
    fontSize: 18,
    fontWeight: 700,
    lineHeight: '36px',
    textAlign: 'center' as const,
    flexShrink: 0,
  },
  title: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-bright)',
    textAlign: 'center' as const,
  },
  detail: {
    margin: 0,
    padding: '8px 12px',
    borderRadius: 6,
    background: 'var(--bg-deep)',
    border: '1px solid var(--border)',
    fontSize: 11,
    color: '#e05050',
    textAlign: 'left' as const,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    maxHeight: 100,
    maxWidth: '100%',
    overflow: 'auto',
  },
  btn: {
    padding: '6px 16px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'transparent',
    color: 'var(--text-dim)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
}
