/**
 * AgentLabels — HTML overlay showing agent status badges above characters.
 *
 * Shared between desktop and web. Positioned absolutely over the canvas.
 */

import { useState, useEffect, useRef } from 'react'
import type { OfficeState } from '@pixel-city/shared/office/engine/officeState'
import { TILE_SIZE, CharacterState } from '@pixel-city/shared/office/types'
import { StatusDisplay } from '@pixel-city/ui'

const WORKER_STATUS_COLORS: Record<string, { bg: string; border: string; dot: string }> = {
  idle:    { bg: 'rgba(10, 10, 14, 0.88)', border: 'rgba(40, 40, 40, 0.6)', dot: '#222' },
  working: { bg: 'rgba(10, 10, 14, 0.88)', border: 'rgba(92, 154, 125, 0.5)', dot: '#5c9a7d' },
  tool:    { bg: 'rgba(10, 10, 14, 0.88)', border: 'rgba(92, 154, 125, 0.5)', dot: '#5c9a7d' },
}

const DEFAULT_STYLE = WORKER_STATUS_COLORS.working

export interface AgentLabelsProps {
  officeState: OfficeState
  agentStatusMap: Map<string, string>
  agentWorkerStatusMap: Map<string, 'idle' | 'working' | 'tool'>
  containerRef: React.RefObject<HTMLDivElement | null>
  zoom: number
  panRef: React.RefObject<{ x: number; y: number }>
}

export function AgentLabels({ officeState, agentStatusMap, agentWorkerStatusMap, containerRef, zoom, panRef }: AgentLabelsProps) {
  const [, setTick] = useState(0)
  const frameCountRef = useRef(0)

  useEffect(() => {
    let rafId = 0
    const tick = () => {
      frameCountRef.current++
      if (frameCountRef.current % 3 === 0) {
        setTick(n => n + 1)
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  const el = containerRef.current
  if (!el) return null

  const rect = el.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const canvasW = Math.round(rect.width * dpr)
  const canvasH = Math.round(rect.height * dpr)
  const layout = officeState.getLayout()
  const mapW = layout.cols * TILE_SIZE * zoom
  const mapH = layout.rows * TILE_SIZE * zoom
  const deviceOffsetX = Math.floor((canvasW - mapW) / 2) + Math.round(panRef.current.x)
  const deviceOffsetY = Math.floor((canvasH - mapH) / 2) + Math.round(panRef.current.y)

  const hoveredId = officeState.hoveredAgentId
  const hoveredCh = hoveredId !== null ? officeState.characters.get(hoveredId) : null
  const showHoverTag = hoveredCh?.isPermanent && hoveredCh.name && hoveredId !== officeState.selectedAgentId

  return (
    <>
      {[...agentStatusMap.entries()].map(([id, statusText]) => {
        const ch = officeState.characters.get(id)
        if (!ch) return null

        const workerStatus = agentWorkerStatusMap.get(id)
        const style = workerStatus ? WORKER_STATUS_COLORS[workerStatus] : DEFAULT_STYLE
        const isIdle = workerStatus === 'idle'

        const sittingOffset = ch.state === CharacterState.TYPE ? 6 : 0
        const screenX = (deviceOffsetX + ch.x * zoom) / dpr
        const screenY = (deviceOffsetY + (ch.y + sittingOffset - 24) * zoom) / dpr

        return (
          <div
            key={id}
            style={{
              position: 'absolute',
              left: screenX,
              top: screenY - 22,
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              pointerEvents: 'none',
              zIndex: 45,
            }}
          >
            <span
              className={isIdle ? undefined : 'pixel-agents-pulse'}
              style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: style.dot,
                marginBottom: 2,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: '11px',
                lineHeight: '14px',
                color: isIdle ? '#555' : '#eae7e0',
                background: style.bg,
                padding: '2px 6px',
                border: `1px solid ${style.border}`,
                whiteSpace: 'nowrap',
                maxWidth: 200,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                fontFamily: 'inherit',
              }}
            >
              <StatusDisplay text={statusText} />
            </span>
          </div>
        )
      })}

      {showHoverTag && hoveredCh && (() => {
        const sittingOffset = hoveredCh.state === CharacterState.TYPE ? 6 : 0
        const screenX = (deviceOffsetX + hoveredCh.x * zoom) / dpr
        const screenY = (deviceOffsetY + (hoveredCh.y + sittingOffset - 24) * zoom) / dpr
        return (
          <div
            key={`hover-${hoveredId}`}
            style={{
              position: 'absolute',
              left: screenX,
              top: screenY - 20,
              transform: 'translateX(-50%)',
              pointerEvents: 'none',
              zIndex: 46,
            }}
          >
            <span
              style={{
                fontSize: '11px',
                lineHeight: '14px',
                color: '#f0c040',
                background: 'rgba(10, 10, 14, 0.88)',
                padding: '2px 6px',
                border: '1px solid rgba(240, 192, 64, 0.35)',
                whiteSpace: 'nowrap',
                fontFamily: 'inherit',
              }}
            >
              {hoveredCh.name}
            </span>
          </div>
        )
      })()}
    </>
  )
}
