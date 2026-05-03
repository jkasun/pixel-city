/**
 * Simplified TutorialOverlay for both desktop and web.
 * Uses inline styles (no Tailwind dependency).
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import type { TutorialStep } from './useOfficeTutorial.js'

interface SpotlightRect {
  x: number
  y: number
  width: number
  height: number
}

export interface TutorialOverlayProps {
  currentStep: TutorialStep
  totalSteps: number
  step: number
  onNext: () => void
  onPrev: () => void
  onEnd: () => void
}

export function TutorialOverlay({
  currentStep,
  totalSteps,
  step,
  onNext,
  onPrev,
  onEnd,
}: TutorialOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const spotlightRectRef = useRef<SVGRectElement>(null)
  const rafRef = useRef(0)
  const [animKey, setAnimKey] = useState(0)
  const prevStepRef = useRef(step)

  useEffect(() => {
    if (step !== prevStepRef.current) {
      prevStepRef.current = step
      setAnimKey(k => k + 1)
    }
  }, [step])

  // Recalculate spotlight position via rAF
  const updateSpotlight = useCallback(() => {
    let spotlight: SpotlightRect | null = null

    if (currentStep.highlightType === 'dom' && currentStep.domSelector) {
      const el = document.querySelector(currentStep.domSelector)
      if (el && overlayRef.current) {
        const rect = el.getBoundingClientRect()
        const overlayRect = overlayRef.current.getBoundingClientRect()
        const padding = 6
        spotlight = {
          x: rect.left - overlayRect.left - padding,
          y: rect.top - overlayRect.top - padding,
          width: rect.width + padding * 2,
          height: rect.height + padding * 2,
        }
      }
    }

    const svgRect = spotlightRectRef.current
    if (svgRect) {
      if (spotlight) {
        svgRect.setAttribute('x', String(spotlight.x))
        svgRect.setAttribute('y', String(spotlight.y))
        svgRect.setAttribute('width', String(spotlight.width))
        svgRect.setAttribute('height', String(spotlight.height))
        svgRect.style.display = ''
      } else {
        svgRect.style.display = 'none'
      }
    }

    rafRef.current = requestAnimationFrame(updateSpotlight)
  }, [currentStep])

  useEffect(() => {
    rafRef.current = requestAnimationFrame(updateSpotlight)
    return () => cancelAnimationFrame(rafRef.current)
  }, [updateSpotlight])

  // Escape to skip
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && currentStep.canSkip) onEnd()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [currentStep.canSkip, onEnd])

  const isLastStep = step === totalSteps - 1

  return (
    <div
      ref={overlayRef}
      style={{ position: 'absolute', inset: 0, zIndex: 300, pointerEvents: 'auto' }}
    >
      {/* SVG spotlight mask */}
      <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} width="100%" height="100%">
        <defs>
          <mask id="tutorial-mask">
            <rect width="100%" height="100%" fill="white" />
            <rect ref={spotlightRectRef} rx="4" fill="black" style={{ display: 'none' }} />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.7)" mask="url(#tutorial-mask)" />
      </svg>

      {/* Speech bubble */}
      <div
        key={`bubble-${animKey}`}
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 301,
          pointerEvents: 'auto',
          background: 'var(--bg-popup)',
          border: '2px solid var(--border)',
          boxShadow: '4px 4px 0px var(--bg-deep)',
          padding: '14px 18px',
          minWidth: 280,
          maxWidth: 380,
          color: 'var(--text-bright)',
          fontFamily: 'inherit',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.02em', marginBottom: 6, color: '#5ac8e8' }}>
          {currentStep.title}
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-dim)' }}>
          {currentStep.message}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, gap: 10 }}>
          {/* Step dots */}
          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            {Array.from({ length: totalSteps }, (_, i) => (
              <span
                key={i}
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: i === step ? '#5ac8e8' : 'var(--border)',
                  transition: 'background 0.2s',
                }}
              />
            ))}
          </div>
          {/* Buttons */}
          <div style={{ display: 'flex', gap: 6 }}>
            {step > 0 && (
              <button onClick={onPrev} style={navBtnStyle}>Back</button>
            )}
            {currentStep.canSkip && (
              <button onClick={onEnd} style={navBtnStyle}>Skip</button>
            )}
            <button
              onClick={onNext}
              style={{
                padding: '5px 14px',
                fontSize: 11,
                fontFamily: 'inherit',
                fontWeight: 700,
                border: '2px solid #5ac8e8',
                borderRadius: 0,
                cursor: 'pointer',
                boxShadow: '2px 2px 0px var(--bg-deep)',
                background: '#5ac8e8',
                color: '#1e1e2e',
              }}
            >
              {currentStep.buttonLabel || 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const navBtnStyle: React.CSSProperties = {
  padding: '5px 14px',
  fontSize: 11,
  fontFamily: 'inherit',
  border: '2px solid var(--border)',
  borderRadius: 0,
  cursor: 'pointer',
  boxShadow: '2px 2px 0px var(--bg-deep)',
  background: 'var(--bg-input, var(--bg))',
  color: 'var(--text-muted)',
}
