import type React from 'react'

// ── Control Panel Styles ──────────────────────────────────────
export const panelStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 10,
  left: 10,
  zIndex: 50,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  background: 'var(--bg-popup)',
  border: '2px solid var(--border)',
  borderRadius: 0,
  padding: '4px 6px',
  boxShadow: '2px 2px 0px var(--bg-deep)',
}

export const btnBase: React.CSSProperties = {
  padding: '5px 10px',
  fontSize: '14px',
  color: 'var(--text)',
  background: 'var(--bg-hover)',
  border: '2px solid transparent',
  borderRadius: 0,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

export const btnAgent: React.CSSProperties = {
  ...btnBase,
  background: 'rgba(90, 200, 140, 0.15)',
  border: '2px solid #5ac88c',
  color: 'var(--text-bright)',
}

export const agentInfoStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 10,
  right: 10,
  zIndex: 50,
  background: 'var(--bg-popup)',
  border: '2px solid var(--border)',
  borderRadius: 0,
  padding: '8px 12px',
  boxShadow: '2px 2px 0px var(--bg-deep)',
  color: 'var(--text)',
  fontSize: '14px',
  fontFamily: 'inherit',
  minWidth: 180,
}

// ── Shared modal input/field styles ──────────────────────────────
export const modalInputStyle: React.CSSProperties = {
  background: 'var(--bg-input)',
  border: '1px solid var(--border)',
  color: 'var(--text-bright)',
  padding: '5px 8px',
  fontSize: '12px',
  fontFamily: 'inherit',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  borderRadius: 0,
}

export function ModalField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <label style={{ fontSize: '11px', color: 'var(--text-dim)' }}>{label}</label>
      {children}
    </div>
  )
}
