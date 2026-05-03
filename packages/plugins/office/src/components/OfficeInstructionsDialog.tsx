/**
 * OfficeInstructionsDialog — edit the office instructions markdown file.
 * Backed by `.pixelcity/office-instructions.md` in the project directory.
 */

import { useState, useEffect } from 'react'

export interface OfficeInstructionsDialogProps {
  buildingName: string
  instructions: string
  onSave: (text: string) => void
  onClose: () => void
  /** Open `.pixelcity/office-instructions.md` in the OS default editor. */
  onOpenFile?: () => void
}

export function OfficeInstructionsDialog({ buildingName, instructions, onSave, onClose, onOpenFile }: OfficeInstructionsDialogProps) {
  const [text, setText] = useState(instructions)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      data-testid="office-instructions-dialog"
      onClick={onClose}
      style={{
        position: 'absolute', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-popup)',
          border: '2px solid var(--border)',
          boxShadow: '4px 4px 0px var(--bg-deep)',
          width: 480, maxWidth: '90%',
          fontFamily: 'var(--font-ui)',
          color: 'var(--text-bright)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', borderBottom: '1px solid var(--border-subtle, var(--border))',
          fontSize: 13, fontWeight: 700, letterSpacing: '0.02em',
        }}>
          <span>Office Instructions — {buildingName}</span>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none',
              color: 'var(--text-muted)', cursor: 'pointer',
              fontSize: 14, padding: '2px 6px', fontFamily: 'var(--font-ui)',
            }}
          >
            ✕
          </button>
        </div>
        <p style={{
          padding: '10px 14px 0', margin: 0,
          fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4,
        }}>
          These instructions are included in the system prompt of every agent spawned in this office.
          Stored in <code style={{ fontFamily: 'var(--font-mono, monospace)' }}>.pixelcity/office-instructions.md</code> — you can also edit the file directly.
        </p>
        <div style={{ padding: '8px 14px' }}>
          <textarea
            data-testid="office-instructions-textarea"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Enter instructions for agents in this office..."
            rows={8}
            autoFocus
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'var(--bg-input, var(--bg))',
              border: '1px solid var(--border)',
              color: 'var(--text-bright)',
              padding: '8px 10px',
              fontSize: 12, fontFamily: 'inherit',
              resize: 'vertical', outline: 'none',
              borderRadius: 0,
            }}
          />
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          padding: '10px 14px',
          borderTop: '1px solid var(--border-subtle, var(--border))',
        }}>
          {onOpenFile ? (
            <button
              data-testid="office-instructions-open-file-btn"
              onClick={onOpenFile}
              title="Open .pixelcity/office-instructions.md in your editor"
              style={{
                padding: '5px 12px', fontSize: 12, fontFamily: 'var(--font-ui)',
                border: '2px solid var(--border)',
                background: 'transparent', color: 'var(--text-muted)',
                cursor: 'pointer', borderRadius: 0,
              }}
            >
              Open file…
            </button>
          ) : <span />}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              data-testid="office-instructions-cancel-btn"
              onClick={onClose}
              style={{
                padding: '5px 16px', fontSize: 12, fontFamily: 'var(--font-ui)',
                border: '2px solid var(--border)',
                background: 'var(--bg-hover)', color: 'var(--text-muted)',
                cursor: 'pointer', borderRadius: 0,
              }}
            >
              Cancel
            </button>
            <button
              data-testid="office-instructions-save-btn"
              onClick={() => onSave(text)}
              style={{
                padding: '5px 16px', fontSize: 12, fontFamily: 'var(--font-ui)',
                border: '2px solid var(--accent)',
                background: 'var(--accent-dim, rgba(90,200,140,0.15))',
                color: 'var(--text-bright)',
                cursor: 'pointer', borderRadius: 0,
              }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
