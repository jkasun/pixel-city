import React, { useState } from 'react'
import type { ThemeName } from './settings.js'
import { applyTheme } from './settings.js'

const THEMES: { id: ThemeName; label: string; colors: { bg: string; card: string; accent: string; text: string; dim: string } }[] = [
  { id: 'dark',    label: 'Dark',    colors: { bg: '#0a0a0c', card: '#0e0e11', accent: '#5c9a7d', text: '#eae7e0', dim: '#78756f' } },
  { id: 'light',   label: 'Light',   colors: { bg: '#f5f5f7', card: '#ffffff', accent: '#3a7a5f', text: '#1d1d1f', dim: '#636366' } },
  { id: 'creme',   label: 'Creme',   colors: { bg: '#FFF7D0', card: '#FFF9E0', accent: '#c08a40', text: '#3a2e1a', dim: '#7a6a4a' } },
  { id: 'nord',    label: 'Nord',    colors: { bg: '#2e3440', card: '#3b4252', accent: '#88c0d0', text: '#eceff4', dim: '#8790a0' } },
  { id: 'monokai', label: 'Monokai', colors: { bg: '#272822', card: '#2d2e27', accent: '#a6e22e', text: '#f9f8f5', dim: '#90908a' } },
]

export function ThemePicker({ onSelect }: { onSelect: (theme: ThemeName) => void }) {
  const [selected, setSelected] = useState<ThemeName | null>(null)

  const handleSelect = (t: ThemeName) => {
    setSelected(t)
    applyTheme(t)
  }

  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', background: '#0a0a0c',
      fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, color: '#eae7e0', margin: '0 0 8px', letterSpacing: '-0.02em' }}>
          Choose Your Theme
        </h1>
        <p style={{ fontSize: 13, color: '#78756f', margin: 0 }}>
          Pick a look that suits you
        </p>
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 600, marginBottom: 36 }}>
        {THEMES.map(({ id, label, colors: c }) => {
          const isSelected = selected === id
          return (
            <button
              key={id}
              onClick={() => handleSelect(id)}
              style={{
                border: 'none', padding: 0, cursor: 'pointer', background: 'transparent',
                outline: isSelected ? '2px solid #5c9a7d' : '2px solid transparent',
                borderRadius: 8, transition: 'outline-color 0.15s, transform 0.15s',
                transform: isSelected ? 'scale(1.05)' : 'scale(1)',
              }}
            >
              <div style={{
                width: 96, borderRadius: 8, overflow: 'hidden', background: c.bg,
                border: `1px solid ${isSelected ? '#5c9a7d' : 'rgba(255,255,255,0.1)'}`,
              }}>
                <div style={{ padding: '8px 7px 5px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {/* Title bar */}
                  <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#ff5f57' }} />
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#febc2e' }} />
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#28c840' }} />
                    <div style={{ flex: 1, height: 4, background: c.card, borderRadius: 2, marginLeft: 4 }} />
                  </div>
                  {/* Sidebar + editor */}
                  <div style={{ display: 'flex', gap: 3, height: 38 }}>
                    <div style={{ width: 22, background: c.card, borderRadius: 3, display: 'flex', flexDirection: 'column', gap: 3, padding: '4px 3px' }}>
                      <div style={{ height: 2.5, background: c.dim, borderRadius: 1, opacity: 0.5 }} />
                      <div style={{ height: 2.5, background: c.accent, borderRadius: 1, opacity: 0.7 }} />
                      <div style={{ height: 2.5, background: c.dim, borderRadius: 1, opacity: 0.5 }} />
                      <div style={{ height: 2.5, background: c.dim, borderRadius: 1, opacity: 0.3 }} />
                    </div>
                    <div style={{ flex: 1, background: c.card, borderRadius: 3, display: 'flex', flexDirection: 'column', gap: 3, padding: '4px 4px' }}>
                      <div style={{ height: 2.5, width: '80%', background: c.accent, borderRadius: 1, opacity: 0.6 }} />
                      <div style={{ height: 2.5, width: '60%', background: c.text, borderRadius: 1, opacity: 0.25 }} />
                      <div style={{ height: 2.5, width: '70%', background: c.text, borderRadius: 1, opacity: 0.25 }} />
                      <div style={{ height: 2.5, width: '50%', background: c.dim, borderRadius: 1, opacity: 0.4 }} />
                      <div style={{ height: 2.5, width: '65%', background: c.text, borderRadius: 1, opacity: 0.2 }} />
                    </div>
                  </div>
                  {/* Terminal */}
                  <div style={{ height: 14, background: c.card, borderRadius: 3, padding: '3px 4px', display: 'flex', alignItems: 'center', gap: 3 }}>
                    <div style={{ width: 4, height: 4, background: c.accent, borderRadius: '50%' }} />
                    <div style={{ height: 2.5, width: '55%', background: c.dim, borderRadius: 1, opacity: 0.4 }} />
                  </div>
                </div>
                {/* Label */}
                <div style={{
                  textAlign: 'center', padding: '4px 0 7px', fontSize: 11,
                  color: isSelected ? c.accent : c.dim,
                  fontWeight: isSelected ? 600 : 400, letterSpacing: '0.03em',
                }}>
                  {label}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <button
        onClick={() => selected && onSelect(selected)}
        disabled={!selected}
        style={{
          padding: '10px 36px', fontSize: 13, fontWeight: 500,
          fontFamily: 'inherit', cursor: selected ? 'pointer' : 'default',
          background: selected ? '#5c9a7d' : 'rgba(255,255,255,0.06)',
          color: selected ? '#0a0a0c' : 'rgba(255,255,255,0.25)',
          border: 'none', borderRadius: 6,
          transition: 'background 0.2s, color 0.2s, transform 0.1s',
          transform: selected ? 'scale(1)' : 'scale(1)',
          letterSpacing: '0.02em',
        }}
      >
        Continue
      </button>
    </div>
  )
}
