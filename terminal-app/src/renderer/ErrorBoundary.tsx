import React, { Component, type ErrorInfo, type ReactNode } from 'react'
import { resetPixelCitySettings } from './settings.js'

interface Props {
  children: ReactNode
  /** Optional crash hook. Called once per caught error before fallback renders. */
  onError?: (err: Error, info: { componentStack: string }) => void
  /** Optional override for the default reset/reload card. May be a node or a render-fn that receives the caught error. */
  fallback?: ReactNode | ((err: Error) => ReactNode)
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
    if (this.props.onError) {
      try {
        this.props.onError(error, { componentStack: info.componentStack ?? '' })
      } catch {
        /* a bad onError must not break the boundary */
      }
    }
  }

  handleReload = () => {
    window.location.reload()
  }

  handleDismiss = () => {
    this.setState({ hasError: false, error: null })
  }

  handleResetSettings = () => {
    const ok = window.confirm(
      'This will clear your Pixel City UI settings (active tab, layout sizes, recent projects) and reload the app. Your project data and agents are not affected. Continue?'
    )
    if (!ok) return
    resetPixelCitySettings()
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children

    if (this.props.fallback !== undefined) {
      return typeof this.props.fallback === 'function'
        ? this.props.fallback(this.state.error ?? new Error('unknown error'))
        : this.props.fallback
    }

    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.icon}>!</div>
          <h2 style={styles.title}>Something went wrong</h2>
          <p style={styles.message}>
            The app ran into an unexpected error. You can try dismissing this or reloading the window.
          </p>
          {this.state.error && (
            <pre style={styles.detail}>{this.state.error.message}</pre>
          )}
          <div style={styles.actions}>
            <button style={styles.btnSecondary} onClick={this.handleDismiss}>
              Dismiss
            </button>
            <button style={styles.btnSecondary} onClick={this.handleResetSettings}>
              Reset settings
            </button>
            <button style={styles.btnPrimary} onClick={this.handleReload}>
              Reload
            </button>
          </div>
        </div>
      </div>
    )
  }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    background: 'var(--bg)',
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  card: {
    maxWidth: 440,
    padding: '40px 36px',
    borderRadius: 12,
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    textAlign: 'center' as const,
  },
  icon: {
    width: 48,
    height: 48,
    margin: '0 auto 20px',
    borderRadius: '50%',
    background: '#3d2020',
    color: '#e05050',
    fontSize: 24,
    fontWeight: 700,
    lineHeight: '48px',
  },
  title: {
    margin: '0 0 8px',
    fontSize: 18,
    fontWeight: 600,
    color: 'var(--text-bright)',
  },
  message: {
    margin: '0 0 16px',
    fontSize: 14,
    lineHeight: 1.5,
    color: 'var(--text-muted)',
  },
  detail: {
    margin: '0 0 20px',
    padding: '10px 14px',
    borderRadius: 6,
    background: 'var(--bg-deep)',
    border: '1px solid var(--border)',
    fontSize: 12,
    color: '#e05050',
    textAlign: 'left' as const,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    maxHeight: 120,
    overflow: 'auto',
  },
  actions: {
    display: 'flex',
    gap: 10,
    justifyContent: 'center',
  },
  btnPrimary: {
    padding: '8px 20px',
    borderRadius: 6,
    border: 'none',
    background: '#5c9a7d',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  btnSecondary: {
    padding: '8px 20px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'transparent',
    color: 'var(--text-dim)',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
}
