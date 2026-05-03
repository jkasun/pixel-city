/**
 * OfficeSettingsDialog — modal to toggle which plugins are enabled for a
 * specific office. Changes are scoped per-building and affect which MCP
 * servers are exposed to agents spawned in this office.
 */

import { useState, useEffect } from 'react'

export type OfficePluginSettings = {
  board: boolean
  browser: boolean
}

export const DEFAULT_PLUGIN_SETTINGS: OfficePluginSettings = {
  board: true, browser: true,
}

export interface OfficeSettingsDialogProps {
  buildingName: string
  settings: OfficePluginSettings
  onSave: (settings: OfficePluginSettings) => void
  onClose: () => void
}

type PluginKey = keyof OfficePluginSettings

const PLUGINS: { key: PluginKey; label: string; description: string }[] = [
  { key: 'board', label: 'Board', description: 'Task board with stories, subtasks, and columns.' },
  { key: 'browser', label: 'Integrated Browser', description: 'Automated browser tools for agents in this office.' },
]

export function OfficeSettingsDialog({ buildingName, settings, onSave, onClose }: OfficeSettingsDialogProps) {
  const [draft, setDraft] = useState<OfficePluginSettings>(settings)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const toggle = (key: PluginKey) => setDraft(prev => ({ ...prev, [key]: !prev[key] }))

  return (
    <div
      data-testid="office-settings-dialog"
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
          width: 520, maxWidth: '90%',
          fontFamily: 'var(--font-ui)',
          color: 'var(--text-bright)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', borderBottom: '1px solid var(--border-subtle, var(--border))',
          fontSize: 13, fontWeight: 700, letterSpacing: '0.02em',
        }}>
          <span>Office Settings — {buildingName}</span>
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
          Enable or disable plugins for agents spawned in this office. Changes update the MCP server configuration on save — restart running agents to pick them up.
        </p>
        <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {PLUGINS.map(({ key, label, description }) => {
            const enabled = !!draft[key]
            return (
              <label
                key={key}
                data-testid={`office-plugin-toggle-${key}`}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '8px 10px',
                  border: '1px solid var(--border)',
                  background: enabled ? 'var(--accent-dim, rgba(90,200,140,0.10))' : 'var(--bg-input, var(--bg))',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={() => toggle(key)}
                  style={{ marginTop: 2 }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{description}</div>
                </div>
              </label>
            )
          })}
        </div>
        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: 8,
          padding: '10px 14px',
          borderTop: '1px solid var(--border-subtle, var(--border))',
        }}>
          <button
            data-testid="office-settings-cancel-btn"
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
            data-testid="office-settings-save-btn"
            onClick={() => onSave(draft)}
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
  )
}
