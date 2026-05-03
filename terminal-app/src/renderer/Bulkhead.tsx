import { useState, type ReactNode } from 'react'
import { ErrorBoundary } from './ErrorBoundary.js'
import { DegradedPanel } from './DegradedPanel.js'
import { log } from './logger.js'

type BulkheadProps = {
  /** Compartment id, e.g. "office-canvas". Used for logging + DegradedPanel title. */
  name: string
  /** Optional custom fallback. Receives the error and a retry fn that remounts the subtree. */
  fallback?: (err: Error, retry: () => void) => ReactNode
  children: ReactNode
}

/**
 * Standard isolation primitive: catches errors in its subtree, logs them,
 * and renders a degraded panel with retry. Used to wrap top-level UI panels
 * so a crash in one compartment doesn't take down the whole window.
 */
export function Bulkhead({ name, fallback, children }: BulkheadProps) {
  const [resetKey, setResetKey] = useState(0)
  const retry = () => setResetKey(k => k + 1)
  return (
    <ErrorBoundary
      key={resetKey}
      onError={(err, info) => log.error(name, err, { componentStack: info.componentStack })}
      fallback={(err) =>
        fallback ? fallback(err, retry) : <DegradedPanel name={name} err={err} retry={retry} />
      }
    >
      {children}
    </ErrorBoundary>
  )
}
