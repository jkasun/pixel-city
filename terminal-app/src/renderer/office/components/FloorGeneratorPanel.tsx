import { useState, useCallback } from 'react'
import type { OfficeLayout } from '@pixel-city/shared/office/types'
import { generateLayout } from '@pixel-city/shared/office/layout/layoutGenerator'
import type { RoomSize } from '@pixel-city/shared/office/layout/layoutGenerator'
import { btnBase } from '../officeStyles.js'

export interface FloorGeneratorPanelProps {
  onPreview: (layout: OfficeLayout) => void
  onApply: (name: string) => void
  onCancel: () => void
  applyLabel?: string
  panelTitle?: string
}

export function FloorGeneratorPanel({ onPreview, onApply, onCancel, applyLabel, panelTitle }: FloorGeneratorPanelProps) {
  const [name, setName] = useState('')
  const [size, setSize] = useState<RoomSize>('medium')
  const [generated, setGenerated] = useState(false)
  const [currentSeed, setCurrentSeed] = useState(0)

  const generate = useCallback(() => {
    const seed = (Math.random() * 0xffffffff) >>> 0
    setCurrentSeed(seed)
    setGenerated(true)
    onPreview(generateLayout(size, seed))
  }, [size, onPreview])

  const regenerate = useCallback(() => {
    const seed = (Math.random() * 0xffffffff) >>> 0
    setCurrentSeed(seed)
    onPreview(generateLayout(size, seed))
  }, [size, onPreview])

  // re-preview when size changes after first generation
  const handleSizeChange = useCallback((s: RoomSize) => {
    setSize(s)
    if (generated) {
      onPreview(generateLayout(s, currentSeed))
    }
  }, [generated, currentSeed, onPreview])

  const sizeLabels: RoomSize[] = ['small', 'medium', 'large']

  return (
    <div
      data-testid="office-floor-generator"
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 80,
        background: 'var(--bg-popup)',
        border: '2px solid #5a8cff',
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        boxShadow: '4px 4px 0px var(--bg-deep)',
        minWidth: 260,
      }}
    >
      <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.9)', fontWeight: 'bold' }}>
        {panelTitle ?? 'Generate Floor'}
      </div>

      {/* Name input */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>Name</label>
        <input
          data-testid="office-floor-generator-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Dev Den, War Room…"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid var(--border)',
            color: 'rgba(255,255,255,0.85)',
            padding: '4px 8px',
            fontSize: '12px',
            fontFamily: 'inherit',
            outline: 'none',
            width: '100%',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Size picker */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>Size</label>
        <div style={{ display: 'flex', gap: 4 }}>
          {sizeLabels.map((s) => (
            <button
              key={s}
              data-testid={`office-floor-size-${s}`}
              onClick={() => handleSizeChange(s)}
              style={{
                flex: 1,
                padding: '4px 0',
                fontSize: '11px',
                fontFamily: 'inherit',
                background: size === s ? 'rgba(90, 140, 255, 0.25)' : 'rgba(255,255,255,0.06)',
                color: size === s ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.55)',
                border: size === s ? '1px solid #5a8cff' : '1px solid var(--border)',
                cursor: 'pointer',
                borderRadius: 0,
                textTransform: 'capitalize',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Size hints */}
      <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginTop: -4 }}>
        {size === 'small'  && '16 × 10 tiles'}
        {size === 'medium' && '22 × 14 tiles'}
        {size === 'large'  && '30 × 19 tiles'}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
        {!generated ? (
          <button
            data-testid="office-floor-generator-generate-btn"
            onClick={generate}
            style={{
              flex: 1,
              padding: '6px 0',
              fontSize: '12px',
              fontFamily: 'inherit',
              background: 'rgba(90, 140, 255, 0.2)',
              border: '1px solid #5a8cff',
              color: 'rgba(200, 220, 255, 0.95)',
              cursor: 'pointer',
              borderRadius: 0,
            }}
          >
            Generate
          </button>
        ) : (
          <>
            <button
              data-testid="office-floor-generator-randomize-btn"
              onClick={regenerate}
              style={{
                flex: 1,
                padding: '6px 0',
                fontSize: '12px',
                fontFamily: 'inherit',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid var(--border)',
                color: 'rgba(255,255,255,0.7)',
                cursor: 'pointer',
                borderRadius: 0,
              }}
            >
              Randomize
            </button>
            <button
              data-testid="office-floor-generator-apply-btn"
              onClick={() => onApply(name)}
              style={{
                flex: 1,
                padding: '6px 0',
                fontSize: '12px',
                fontFamily: 'inherit',
                background: 'rgba(90, 200, 140, 0.2)',
                border: '1px solid #5ac88c',
                color: 'rgba(200, 255, 220, 0.95)',
                cursor: 'pointer',
                borderRadius: 0,
              }}
            >
              {applyLabel ?? 'Use This'}
            </button>
          </>
        )}
        <button
          data-testid="office-floor-generator-cancel-btn"
          onClick={onCancel}
          style={{
            padding: '6px 10px',
            fontSize: '12px',
            fontFamily: 'inherit',
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'rgba(255,255,255,0.4)',
            cursor: 'pointer',
            borderRadius: 0,
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
