import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

export interface ConfirmOptions {
  title: string
  message: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const confirmBtnRef = useRef<HTMLButtonElement>(null)

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>(resolve => {
      setPending({ ...opts, resolve })
    })
  }, [])

  const close = useCallback((value: boolean) => {
    setPending(p => { p?.resolve(value); return null })
  }, [])

  useEffect(() => {
    if (!pending) return
    confirmBtnRef.current?.focus()
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false) }
      if (e.key === 'Enter') { e.preventDefault(); close(true) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [pending, close])

  const danger = pending?.danger ?? true
  const accentColor = danger ? '#c94444' : 'var(--accent)'
  const accentBg = danger ? 'rgba(201, 68, 68, 0.12)' : 'rgba(92,154,125,0.12)'
  const accentBorder = danger ? 'rgba(201, 68, 68, 0.6)' : 'var(--accent-dim)'
  const accentText = danger ? '#e08080' : 'var(--text-bright)'

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div
          data-testid="confirm-dialog-overlay"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 10000,
          }}
          onClick={() => close(false)}
        >
          <div
            data-testid="confirm-dialog"
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg-popup)',
              border: `2px solid ${accentColor}`,
              padding: '18px 22px',
              minWidth: 320,
              maxWidth: 440,
              boxShadow: '4px 4px 0px var(--bg-deep)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ color: accentColor, fontWeight: 'bold', fontSize: '13px' }}>
              {danger ? '⚠ ' : ''}{pending.title}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-bright)', lineHeight: 1.65 }}>
              {pending.message}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button
                ref={confirmBtnRef}
                data-testid="confirm-dialog-confirm-btn"
                onClick={() => close(true)}
                style={{
                  flex: 1,
                  padding: '6px 0',
                  fontSize: '12px',
                  fontFamily: 'inherit',
                  background: accentBg,
                  border: `2px solid ${accentBorder}`,
                  color: accentText,
                  cursor: 'pointer',
                  borderRadius: 0,
                }}
              >
                {pending.confirmLabel ?? 'Confirm'}
              </button>
              <button
                data-testid="confirm-dialog-cancel-btn"
                onClick={() => close(false)}
                style={{
                  padding: '6px 14px',
                  fontSize: '12px',
                  fontFamily: 'inherit',
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  borderRadius: 0,
                }}
              >
                {pending.cancelLabel ?? 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider')
  return ctx
}
