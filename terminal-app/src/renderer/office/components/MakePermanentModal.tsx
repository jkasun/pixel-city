import { useEffect, useRef, useState } from 'react'
import type { Character } from '@pixel-city/shared/office/types'
import { slugifyHandle, validateHandle } from '@pixel-city/shared/utils/agentAddress'
import { modalInputStyle, ModalField } from '../officeStyles.js'

export type MakePermanentResult = { ok: true } | { ok: false, error: string }

export interface MakePermanentModalProps {
  character: Character
  onConfirm: (name: string, handle: string, role: string, personality: string) => Promise<MakePermanentResult>
  onCancel: () => void
}

export function MakePermanentModal({ character, onConfirm, onCancel }: MakePermanentModalProps) {
  const [name, setName] = useState(character.name ?? '')
  const [handle, setHandle] = useState(() => slugifyHandle(character.name ?? ''))
  const [handleTouched, setHandleTouched] = useState(false)
  const [role, setRole] = useState(character.role ?? '')
  const [personality, setPersonality] = useState('')
  const [hiring, setHiring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  // Auto-sync handle from name until the user manually edits it.
  useEffect(() => {
    if (!handleTouched) setHandle(slugifyHandle(name))
  }, [name, handleTouched])

  const handleValidation = validateHandle(handle)
  const canConfirm = name.trim().length > 0 && handleValidation.ok && !hiring

  const handleHire = async () => {
    if (!canConfirm) return
    setError(null)
    setHiring(true)
    try {
      const result = await onConfirm(name.trim(), handle.trim(), role.trim(), personality.trim())
      if (!result.ok) setError(result.error)
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
    } finally {
      setHiring(false)
    }
  }

  const handleFieldError = handleTouched && !handleValidation.ok ? handleValidation.reason : null

  return (
    <div style={{
      position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.72)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 90,
    }}>
      <div style={{
        background: 'var(--bg-popup)',
        border: '2px solid #f0c040',
        padding: '18px 22px',
        minWidth: 340,
        boxShadow: '4px 4px 0px var(--bg-deep)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}>
        <div style={{ color: '#f0c040', fontWeight: 'bold', fontSize: '14px' }}>★ Hire as Permanent Employee</div>
        <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: -4, lineHeight: 1.6 }}>
          This employee will persist across sessions with their own folder at{' '}
          <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>.pixelcity/agents/</span>
        </div>

        <ModalField label="Name *">
          <input
            ref={nameRef}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Alex Chen"
            style={modalInputStyle}
          />
        </ModalField>

        <ModalField label="Handle *">
          <input
            value={handle}
            onChange={e => { setHandleTouched(true); setHandle(e.target.value) }}
            onBlur={() => setHandleTouched(true)}
            placeholder="e.g. alex-chen"
            style={modalInputStyle}
          />
          <div style={{ fontSize: 10, color: handleFieldError ? '#ff6a6a' : 'var(--text-dim)', marginTop: 2 }}>
            {handleFieldError ?? 'Lowercase letters, numbers, dashes. Unique across your employees.'}
          </div>
        </ModalField>

        <ModalField label="Role">
          <input
            value={role}
            onChange={e => setRole(e.target.value)}
            placeholder="e.g. Senior Engineer"
            style={modalInputStyle}
          />
        </ModalField>

        <ModalField label="Personality">
          <input
            value={personality}
            onChange={e => setPersonality(e.target.value)}
            placeholder="e.g. Methodical, detail-oriented, wanders a lot"
            style={modalInputStyle}
          />
        </ModalField>

        {error && (
          <div style={{
            fontSize: 11,
            color: '#ff6a6a',
            border: '1px solid #ff6a6a',
            background: 'rgba(255,106,106,0.08)',
            padding: '6px 8px',
            lineHeight: 1.5,
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
          <button
            onClick={handleHire}
            disabled={!canConfirm}
            style={{
              flex: 1,
              padding: '7px 0',
              fontSize: '13px',
              fontFamily: 'inherit',
              background: canConfirm ? 'rgba(240, 192, 64, 0.18)' : 'rgba(255,255,255,0.04)',
              border: `2px solid ${canConfirm ? '#f0c040' : 'rgba(255,255,255,0.1)'}`,
              color: canConfirm ? '#f0c040' : 'rgba(255,255,255,0.22)',
              cursor: canConfirm ? 'pointer' : 'default',
              borderRadius: 0,
            }}
          >
            {hiring ? 'Hiring...' : 'Hire'}
          </button>
          <button
            onClick={onCancel}
            style={{
              padding: '7px 14px',
              fontSize: '13px',
              fontFamily: 'inherit',
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              borderRadius: 0,
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
