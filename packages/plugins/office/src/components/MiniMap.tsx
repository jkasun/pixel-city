/**
 * MiniMap — miniature office overview with viewport rect and click-to-pan.
 *
 * Shared between desktop and web. Requires OfficeState + camera state as props.
 */

import { useRef, useEffect, useCallback, useState } from 'react'
import type { OfficeState } from '@pixel-city/shared/office/engine/officeState'
import { TileType, TILE_SIZE } from '@pixel-city/shared/office/types'
import { WALL_COLOR } from '@pixel-city/shared/office/floorTiles'
import { wallColorToHex } from '@pixel-city/shared/office/wallTiles'

// ── Constants ────────────────────────────────────────────────

const MINIMAP_MAX_W = 160
const MINIMAP_MAX_H = 120
const AGENT_DOT_RADIUS = 2
const AGENT_WORKING_COLOR = '#5ac88c'
const AGENT_TOOL_COLOR = '#5ac8e8'
const AGENT_SELECTED_COLOR = '#ffd740'

function isLightColor(hex: string): boolean {
  const c = hex.replace('#', '')
  if (c.length < 6) return false
  const r = parseInt(c.slice(0, 2), 16)
  const g = parseInt(c.slice(2, 4), 16)
  const b = parseInt(c.slice(4, 6), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 > 140
}

function getMinimapColors() {
  const style = getComputedStyle(document.documentElement)
  const get = (v: string) => style.getPropertyValue(v).trim()
  const bgDeep = get('--bg-deep') || '#12121e'
  const textDim = get('--text-dim') || '#78756f'
  const isLight = isLightColor(bgDeep)
  return {
    floorColor: textDim,
    viewportRectColor: isLight ? 'rgba(0, 0, 0, 0.5)' : 'rgba(255, 255, 255, 0.7)',
    viewportRectFill: isLight ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.05)',
    agentIdleColor: isLight ? 'rgba(0, 0, 0, 0.15)' : '#2a2a3a',
    furnitureColor: isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.12)',
  }
}

function renderMiniMapFrame(
  ctx: CanvasRenderingContext2D,
  officeState: OfficeState,
  miniScale: number,
  themeColors: { floorColor: string; agentIdleColor: string; furnitureColor: string },
) {
  const dpr = window.devicePixelRatio || 1
  const w = ctx.canvas.width
  const h = ctx.canvas.height
  const s = miniScale * dpr

  ctx.clearRect(0, 0, w, h)

  const tileMap = officeState.tileMap
  const currentLayout = officeState.getLayout()
  const tileColors = currentLayout.tileColors
  const layoutCols = currentLayout.cols
  const ts = TILE_SIZE * s

  for (let r = 0; r < tileMap.length; r++) {
    const row = tileMap[r]
    for (let c = 0; c < row.length; c++) {
      const tile = row[c]
      if (tile === TileType.VOID) continue
      if (tile === TileType.WALL) {
        const colorIdx = r * layoutCols + c
        const wallColor = tileColors?.[colorIdx]
        ctx.fillStyle = wallColor ? wallColorToHex(wallColor) : WALL_COLOR
      } else {
        ctx.fillStyle = themeColors.floorColor
      }
      ctx.fillRect(c * ts, r * ts, Math.ceil(ts), Math.ceil(ts))
    }
  }

  ctx.fillStyle = themeColors.furnitureColor
  const furnitureArr = Array.isArray(currentLayout.furniture) ? currentLayout.furniture : (currentLayout.furniture ? Object.values(currentLayout.furniture) : [])
  for (const f of furnitureArr as Array<{ col: number; row: number }>) {
    ctx.fillRect(f.col * ts, f.row * ts, Math.ceil(ts), Math.ceil(ts))
  }

  for (const ch of officeState.getCharacters()) {
    const cx = ch.x * s
    const cy = ch.y * s
    const dotR = AGENT_DOT_RADIUS * dpr

    if (ch.workerStatus === 'tool') {
      ctx.fillStyle = AGENT_TOOL_COLOR
    } else if (ch.workerStatus === 'working') {
      ctx.fillStyle = AGENT_WORKING_COLOR
    } else {
      ctx.fillStyle = themeColors.agentIdleColor
    }

    if (ch.id === officeState.selectedAgentId) {
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, dotR + 2.5 * dpr, 0, Math.PI * 2)
      ctx.strokeStyle = AGENT_SELECTED_COLOR
      ctx.lineWidth = 1.5 * dpr
      ctx.shadowColor = AGENT_SELECTED_COLOR
      ctx.shadowBlur = 4 * dpr
      ctx.stroke()
      ctx.restore()
    }

    ctx.beginPath()
    ctx.arc(cx, cy, dotR, 0, Math.PI * 2)
    ctx.fill()
  }
}

function computeMiniMapSize(officeState: OfficeState) {
  const layout = officeState.getLayout()
  const mapPixelW = layout.cols * TILE_SIZE
  const mapPixelH = layout.rows * TILE_SIZE
  const miniScale = Math.min(MINIMAP_MAX_W / mapPixelW, MINIMAP_MAX_H / mapPixelH)
  const miniW = Math.ceil(mapPixelW * miniScale)
  const miniH = Math.ceil(mapPixelH * miniScale)
  return { miniScale, miniW, miniH }
}

// ── MiniMap Component ──────────────────────────────────────────

export interface MiniMapProps {
  officeState: OfficeState
  zoom: number
  panRef: React.MutableRefObject<{ x: number; y: number }>
  containerRef: React.RefObject<HTMLDivElement | null>
  onPanTo: (panX: number, panY: number) => void
}

export function MiniMap({ officeState, zoom, panRef, containerRef, onPanTo }: MiniMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const isDraggingRef = useRef(false)
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const updateSize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = el.getBoundingClientRect()
      setContainerSize({ w: Math.round(rect.width * dpr), h: Math.round(rect.height * dpr) })
    }
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(el)
    return () => observer.disconnect()
  }, [containerRef])

  const { miniScale, miniW, miniH } = computeMiniMapSize(officeState)

  const minimapClickToPan = useCallback(
    (cssX: number, cssY: number) => {
      const layout = officeState.getLayout()
      const worldX = cssX / miniScale
      const worldY = cssY / miniScale
      const mapW = layout.cols * TILE_SIZE * zoom
      const mapH = layout.rows * TILE_SIZE * zoom
      onPanTo(mapW / 2 - worldX * zoom, mapH / 2 - worldY * zoom)
    },
    [officeState, zoom, miniScale, onPanTo],
  )

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      isDraggingRef.current = true
      officeState.cameraFollowId = null
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
      minimapClickToPan(e.clientX - rect.left, e.clientY - rect.top)
    },
    [minimapClickToPan, officeState],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDraggingRef.current) return
      e.preventDefault()
      e.stopPropagation()
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
      minimapClickToPan(e.clientX - rect.left, e.clientY - rect.top)
    },
    [minimapClickToPan],
  )

  const handleMouseUp = useCallback(() => { isDraggingRef.current = false }, [])
  const handleMouseLeave = useCallback(() => { isDraggingRef.current = false }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(miniW * dpr)
    canvas.height = Math.round(miniH * dpr)
    canvas.style.width = `${miniW}px`
    canvas.style.height = `${miniH}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const canvasW = containerSize.w
    const canvasH = containerSize.h

    function draw() {
      if (!ctx) return
      const colors = getMinimapColors()
      renderMiniMapFrame(ctx, officeState, miniScale, colors)

      if (canvasW > 0 && canvasH > 0) {
        const dpr = window.devicePixelRatio || 1
        const s = miniScale * dpr
        const layout = officeState.getLayout()
        const mapW = layout.cols * TILE_SIZE * zoom
        const mapH = layout.rows * TILE_SIZE * zoom
        const offsetX = Math.floor((canvasW - mapW) / 2) + Math.round(panRef.current.x)
        const offsetY = Math.floor((canvasH - mapH) / 2) + Math.round(panRef.current.y)

        ctx.save()
        ctx.strokeStyle = colors.viewportRectColor
        ctx.fillStyle = colors.viewportRectFill
        ctx.lineWidth = 1.5 * dpr
        ctx.fillRect((-offsetX / zoom) * s, (-offsetY / zoom) * s, (canvasW / zoom) * s, (canvasH / zoom) * s)
        ctx.strokeRect((-offsetX / zoom) * s, (-offsetY / zoom) * s, (canvasW / zoom) * s, (canvasH / zoom) * s)
        ctx.restore()
      }

      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [officeState, zoom, panRef, containerSize, miniScale, miniW, miniH])

  return (
    <div
      data-testid="office-minimap"
      style={{
        position: 'absolute',
        bottom: 56,
        left: 10,
        zIndex: 49,
        background: 'var(--bg-deep)',
        border: '2px solid var(--border)',
        padding: 2,
        boxShadow: '2px 2px 0px var(--bg-deep)',
        cursor: 'crosshair',
        userSelect: 'none',
      }}
    >
      <canvas
        data-testid="office-minimap-canvas"
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        style={{ display: 'block' }}
      />
    </div>
  )
}
