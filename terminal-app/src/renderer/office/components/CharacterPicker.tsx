import { useState, useMemo } from 'react'
import { PALETTE_COUNT } from '@pixel-city/shared/constants'
import { Direction } from '@pixel-city/shared/office/types'
import { getCharacterSprites } from '@pixel-city/shared/office/sprites/spriteData'
import { btnBase } from '../officeStyles.js'

/** Render a SpriteData to a data URL at given scale */
function spriteToDataUrl(sprite: string[][], scale: number): string {
  const h = sprite.length
  const w = sprite[0]?.length ?? 0
  const canvas = document.createElement('canvas')
  canvas.width = w * scale
  canvas.height = h * scale
  const ctx = canvas.getContext('2d')!
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const color = sprite[y][x]
      if (color) {
        ctx.fillStyle = color
        ctx.fillRect(x * scale, y * scale, scale, scale)
      }
    }
  }
  return canvas.toDataURL()
}

export const MODELS = [
  { id: 'sonnet', label: 'Sonnet', color: '#5ac8e8', bg: 'rgba(90, 200, 232, 0.15)' },
  { id: 'opus', label: 'Opus', color: '#c87aff', bg: 'rgba(200, 122, 255, 0.15)' },
]

import { randomName } from '@pixel-city/shared/office/engine/nameData'

export function CharacterPicker({ onPick, onClose }: { onPick: (palette: number, model: string, customName: string, initialMessage?: string) => void; onClose: () => void }) {
  const [selectedPalette, setSelectedPalette] = useState<number | null>(null)
  const [initialMessage, setInitialMessage] = useState('')
  const [customName, setCustomName] = useState(() => randomName())

  const previews = useMemo(() => {
    const result: string[] = []
    for (let i = 0; i < PALETTE_COUNT; i++) {
      const sprites = getCharacterSprites(i, 0)
      const frame = sprites.walk[Direction.DOWN][0]
      result.push(spriteToDataUrl(frame, 3))
    }
    return result
  }, [])

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 52,
        left: 10,
        zIndex: 60,
        background: 'var(--bg-popup)',
        border: '2px solid #5ac88c',
        padding: '8px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        boxShadow: '2px 2px 0px var(--bg-deep)',
      }}
    >
      {/* Character row */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginRight: 2 }}>char</span>
        {previews.map((src, i) => (
          <button
            key={i}
            onClick={() => setSelectedPalette(i)}
            style={{
              background: selectedPalette === i ? 'rgba(90, 200, 140, 0.2)' : 'rgba(255,255,255,0.06)',
              border: selectedPalette === i ? '2px solid #5ac88c' : '2px solid rgba(255,255,255,0.1)',
              borderRadius: 0,
              cursor: 'pointer',
              padding: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title={`Character ${i + 1}`}
          >
            <img src={src} style={{ imageRendering: 'pixelated', display: 'block' }} />
          </button>
        ))}
        <button
          onClick={onClose}
          style={{ ...btnBase, fontSize: '12px', padding: '2px 6px', color: '#555', marginLeft: 4 }}
        >
          ✕
        </button>
      </div>

      {/* Custom name */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginRight: 2, flexShrink: 0 }}>name</span>
        <input
          type="text"
          value={customName}
          onChange={e => setCustomName(e.target.value)}
          placeholder="Character name"
          style={{
            ...btnBase,
            flex: 1,
            fontSize: '11px',
            padding: '4px 8px',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid var(--border)',
            color: 'rgba(255,255,255,0.8)',
            outline: 'none',
            minWidth: 0,
          }}
        />
      </div>

      {/* Initial message */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginRight: 2, flexShrink: 0 }}>msg</span>
        <input
          type="text"
          value={initialMessage}
          onChange={e => setInitialMessage(e.target.value)}
          placeholder="Initial message (optional)"
          style={{
            ...btnBase,
            flex: 1,
            fontSize: '11px',
            padding: '4px 8px',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid var(--border)',
            color: 'rgba(255,255,255,0.8)',
            outline: 'none',
            minWidth: 0,
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && selectedPalette !== null) {
              onPick(selectedPalette, MODELS[0].id, customName, initialMessage || undefined)
            }
          }}
        />
      </div>

      {/* Model row */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginRight: 2 }}>model</span>
        {MODELS.map(m => (
          <button
            key={m.id}
            onClick={() => selectedPalette !== null && onPick(selectedPalette, m.id, customName, initialMessage || undefined)}
            disabled={selectedPalette === null}
            style={{
              ...btnBase,
              fontSize: '12px',
              padding: '4px 12px',
              background: selectedPalette !== null ? m.bg : 'rgba(255,255,255,0.04)',
              border: `2px solid ${selectedPalette !== null ? m.color : 'rgba(255,255,255,0.1)'}`,
              color: selectedPalette !== null ? m.color : 'rgba(255,255,255,0.25)',
              cursor: selectedPalette !== null ? 'pointer' : 'default',
            }}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  )
}
