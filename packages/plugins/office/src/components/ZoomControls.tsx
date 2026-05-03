/**
 * ZoomControls — pixel-art styled zoom +/- buttons with fade-in level indicator.
 */

import { useState, useEffect, useRef } from 'react'
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_LEVEL_FADE_DELAY_MS,
  ZOOM_LEVEL_HIDE_DELAY_MS,
  ZOOM_LEVEL_FADE_DURATION_SEC,
} from '@pixel-city/shared/constants'

export interface ZoomControlsProps {
  zoom: number
  onZoomChange: (zoom: number) => void
}

const btnBase: React.CSSProperties = {
  width: 40,
  height: 40,
  padding: 0,
  background: 'var(--bg-popup)',
  color: 'var(--text-bright)',
  border: '2px solid var(--border)',
  borderRadius: 0,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxShadow: '2px 2px 0px var(--bg-deep)',
}

function ZoomInIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="7.5" r="5" />
      <line x1="11" y1="11" x2="16" y2="16" />
      <line x1="5" y1="7.5" x2="10" y2="7.5" />
      <line x1="7.5" y1="5" x2="7.5" y2="10" />
    </svg>
  )
}

function ZoomOutIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="7.5" r="5" />
      <line x1="11" y1="11" x2="16" y2="16" />
      <line x1="5" y1="7.5" x2="10" y2="7.5" />
    </svg>
  )
}

export function ZoomControls({ zoom, onZoomChange }: ZoomControlsProps) {
  const [hovered, setHovered] = useState<'minus' | 'plus' | null>(null)
  const [showLevel, setShowLevel] = useState(false)
  const [fadeOut, setFadeOut] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevZoomRef = useRef(zoom)

  const minDisabled = zoom <= ZOOM_MIN
  const maxDisabled = zoom >= ZOOM_MAX

  useEffect(() => {
    if (zoom === prevZoomRef.current) return
    prevZoomRef.current = zoom
    if (timerRef.current) clearTimeout(timerRef.current)
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    setShowLevel(true)
    setFadeOut(false)
    fadeTimerRef.current = setTimeout(() => setFadeOut(true), ZOOM_LEVEL_FADE_DELAY_MS)
    timerRef.current = setTimeout(() => { setShowLevel(false); setFadeOut(false) }, ZOOM_LEVEL_HIDE_DELAY_MS)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    }
  }, [zoom])

  return (
    <>
      {showLevel && (
        <div style={{
          position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
          zIndex: 50, background: 'var(--bg-popup)', border: '2px solid var(--border)', borderRadius: 0,
          padding: '4px 12px', boxShadow: '2px 2px 0px var(--bg-deep)', fontSize: '14px',
          color: 'var(--text-bright)', userSelect: 'none', pointerEvents: 'none',
          opacity: fadeOut ? 0 : 1, transition: `opacity ${ZOOM_LEVEL_FADE_DURATION_SEC}s ease-out`,
          fontFamily: 'inherit',
        }}>
          {zoom}x
        </div>
      )}
      <div data-testid="office-zoom-controls" style={{
        position: 'absolute', bottom: 10, left: 10, zIndex: 50,
        display: 'flex', flexDirection: 'row', gap: 4,
      }}>
        <button
          data-testid="office-zoom-in"
          onClick={() => onZoomChange(zoom + 1)}
          disabled={maxDisabled}
          onMouseEnter={() => setHovered('plus')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...btnBase,
            background: hovered === 'plus' && !maxDisabled ? 'var(--bg-hover)' : btnBase.background,
            cursor: maxDisabled ? 'default' : 'pointer',
            opacity: maxDisabled ? 0.35 : 1,
          }}
          title="Zoom in (Ctrl+Scroll)"
        >
          <ZoomInIcon size={18} />
        </button>
        <button
          data-testid="office-zoom-out"
          onClick={() => onZoomChange(zoom - 1)}
          disabled={minDisabled}
          onMouseEnter={() => setHovered('minus')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...btnBase,
            background: hovered === 'minus' && !minDisabled ? 'var(--bg-hover)' : btnBase.background,
            cursor: minDisabled ? 'default' : 'pointer',
            opacity: minDisabled ? 0.35 : 1,
          }}
          title="Zoom out (Ctrl+Scroll)"
        >
          <ZoomOutIcon size={18} />
        </button>
      </div>
    </>
  )
}
