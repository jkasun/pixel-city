import { useState } from 'react'
import type { Character } from '@pixel-city/shared/office/types'
import { modalInputStyle } from '../officeStyles.js'

export interface FireConfirmModalProps {
  character: Character
  onFire: () => void
  onCancel: () => void
}

export function FireConfirmModal({ character, onFire, onCancel }: FireConfirmModalProps) {
  const [step, setStep] = useState<1 | 2>(1)
  const [confirmText, setConfirmText] = useState('')
  const name = character.name ?? 'this employee'
  const nameMatches = confirmText.trim() === name

  const cancelBtnStyle: React.CSSProperties = {
    padding: '6px 14px',
    fontSize: '12px',
    fontFamily: 'inherit',
    background: 'transparent',
    border: '1px solid var(--border)',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    borderRadius: 0,
  }

  return (
    <div data-testid="fire-confirm-overlay" style={{
      position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.78)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 90,
    }}>
      <div data-testid="fire-confirm-modal" style={{
        background: 'var(--bg-popup)',
        border: '2px solid #c94444',
        padding: '18px 22px',
        minWidth: 340,
        maxWidth: 400,
        boxShadow: '4px 4px 0px var(--bg-deep)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}>
        <div style={{ color: '#c94444', fontWeight: 'bold', fontSize: '14px' }}>⚠ Fire Employee</div>

        {step === 1 && (
          <>
            <div style={{ fontSize: '12px', color: 'var(--text)', lineHeight: 1.7 }}>
              You are about to permanently fire{' '}
              <strong style={{ color: 'var(--text-bright)' }}>{name}</strong>.
              <br /><br />
              This will delete their entire memory folder, soul file, and work history.{' '}
              <span style={{ color: '#c94444' }}>This cannot be undone.</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                data-testid="fire-confirm-continue-btn"
                onClick={() => setStep(2)}
                style={{
                  flex: 1,
                  padding: '6px 0',
                  fontSize: '12px',
                  fontFamily: 'inherit',
                  background: 'rgba(201, 68, 68, 0.12)',
                  border: '2px solid rgba(201, 68, 68, 0.6)',
                  color: '#e08080',
                  cursor: 'pointer',
                  borderRadius: 0,
                }}
              >
                I understand, continue
              </button>
              <button data-testid="fire-confirm-cancel-btn" onClick={onCancel} style={cancelBtnStyle}>Cancel</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div style={{ fontSize: '12px', color: 'var(--text)', lineHeight: 1.7 }}>
              Type <strong style={{ color: 'var(--text-bright)' }}>{name}</strong> below to confirm.
            </div>
            <input
              data-testid="fire-confirm-name-input"
              autoFocus
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder={name}
              style={modalInputStyle}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                data-testid="fire-confirm-fire-btn"
                onClick={nameMatches ? onFire : undefined}
                disabled={!nameMatches}
                style={{
                  flex: 1,
                  padding: '6px 0',
                  fontSize: '12px',
                  fontFamily: 'inherit',
                  background: nameMatches ? 'rgba(201, 68, 68, 0.28)' : 'rgba(255,255,255,0.04)',
                  border: `2px solid ${nameMatches ? '#c94444' : 'rgba(255,255,255,0.1)'}`,
                  color: nameMatches ? '#e08080' : 'rgba(255,255,255,0.2)',
                  cursor: nameMatches ? 'pointer' : 'default',
                  borderRadius: 0,
                }}
              >
                Fire {name}
              </button>
              <button onClick={onCancel} style={cancelBtnStyle}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
