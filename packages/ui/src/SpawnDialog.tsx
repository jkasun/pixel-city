/**
 * SpawnDialog — shared agent spawn modal.
 * Works with any ISessionAdapter.
 */

import React, { useState } from 'react'
import { useSession } from './SessionContext.js'
import type { AgentInfo } from '@pixel-city/core/session'

export interface SpawnDialogProps {
  onSpawned: (agent: AgentInfo) => void
  onCancel: () => void
}

export function SpawnDialog({ onSpawned, onCancel }: SpawnDialogProps) {
  const session = useSession()
  const [name, setName] = useState('')
  const [model, setModel] = useState('sonnet')
  const [cwd, setCwd] = useState('')
  const [initialMessage, setInitialMessage] = useState('')
  const [spawning, setSpawning] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || spawning) return
    setSpawning(true)
    try {
      const agent = await session.spawnAgent({
        name: name.trim(),
        model,
        cwd: cwd.trim() || undefined,
        initialMessage: initialMessage.trim() || undefined,
      })
      onSpawned(agent)
    } catch (err: any) {
      console.error('Spawn failed:', err)
      setSpawning(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    padding: '8px 10px', fontSize: 12,
    border: '1px solid var(--border)', background: 'var(--bg-input)',
    color: 'var(--text-bright)', borderRadius: 6, outline: 'none',
    width: '100%', boxSizing: 'border-box',
  }

  return (
    <div data-testid="spawn-dialog" style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }} onClick={onCancel}>
      <form
        onSubmit={handleSubmit}
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 10, padding: 24, minWidth: 380,
          display: 'flex', flexDirection: 'column', gap: 12,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text-bright)' }}>
          Spawn Agent
        </h3>

        <input data-testid="spawn-dialog-name" value={name} onChange={e => setName(e.target.value)} placeholder="Agent name" autoFocus style={inputStyle} />

        <div style={{ display: 'flex', gap: 6 }}>
          {['opus', 'sonnet', 'haiku'].map(m => (
            <button key={m} type="button" onClick={() => setModel(m)} style={{
              flex: 1, fontSize: 10, padding: '6px 0', borderRadius: 4, cursor: 'pointer',
              border: model === m ? '1px solid var(--accent)' : '1px solid var(--border)',
              background: model === m ? 'var(--accent)' : 'var(--bg-input)',
              color: model === m ? '#fff' : 'var(--text-muted)', fontWeight: 600, textTransform: 'capitalize',
            }}>
              {m}
            </button>
          ))}
        </div>

        <input value={cwd} onChange={e => setCwd(e.target.value)} placeholder="Working directory (optional)"
          style={{ ...inputStyle, fontSize: 11, fontFamily: 'monospace' }} />

        <textarea value={initialMessage} onChange={e => setInitialMessage(e.target.value)}
          placeholder="Initial message (optional)" rows={2}
          style={{ ...inputStyle, fontSize: 11, resize: 'vertical', fontFamily: 'inherit' }} />

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" data-testid="spawn-dialog-cancel" onClick={onCancel} style={{
            fontSize: 11, padding: '6px 14px', border: '1px solid var(--border)',
            background: 'var(--bg-input)', color: 'var(--text-muted)', cursor: 'pointer', borderRadius: 5,
          }}>Cancel</button>
          <button type="submit" data-testid="spawn-dialog-confirm" disabled={!name.trim() || spawning} style={{
            fontSize: 11, padding: '6px 14px', border: 'none',
            background: 'var(--accent)', color: '#fff',
            cursor: spawning ? 'wait' : 'pointer', borderRadius: 5,
            fontWeight: 600, opacity: name.trim() && !spawning ? 1 : 0.5,
          }}>{spawning ? 'Spawning...' : 'Spawn'}</button>
        </div>
      </form>
    </div>
  )
}
