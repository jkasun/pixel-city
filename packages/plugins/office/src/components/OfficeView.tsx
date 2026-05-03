/**
 * OfficeView — Shared pixel-art office canvas component.
 *
 * Used by both terminal-app and web-app. Loads layout via OfficeStore DI,
 * renders via the shared engine, and syncs agents to character sprites.
 */

import { useRef, useState, useEffect, useCallback } from 'react'
import { getOfficeStore } from '../office/index.js'
import type { OfficeAgent } from '../office/types.js'
import { OfficeState } from '@pixel-city/shared/office/engine/officeState'
import { startGameLoop } from '@pixel-city/shared/office/engine/gameLoop'
import { renderFrame } from '@pixel-city/shared/office/engine/renderer'
import type { SelectionRenderState } from '@pixel-city/shared/office/engine/renderer'
import { TILE_SIZE } from '@pixel-city/shared/office/types'
import type { OfficeLayout } from '@pixel-city/shared/office/types'
import { loadAllAssets } from '@pixel-city/shared/assetLoader'
import { buildDynamicCatalog } from '@pixel-city/shared/office/layout/furnitureCatalog'
import {
  setupCanvas,
  scalePanDelta,
  screenToTile as sharedScreenToTile,
} from '@pixel-city/shared/office/canvas/canvasUtils'
import {
  CAMERA_FOLLOW_LERP,
  CAMERA_FOLLOW_SNAP_THRESHOLD,
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_DEFAULT_DPR_FACTOR,
  ZOOM_SCROLL_THRESHOLD,
  PAN_MARGIN_FRACTION,
} from '@pixel-city/shared/constants'

// ── Helpers ─────────────────────────────────────────────────────

function normalizeLayout(data: any): OfficeLayout {
  if (!data || typeof data !== 'object') return data
  const len = (data.cols ?? 0) * (data.rows ?? 0)
  if (!Array.isArray(data.tiles)) data.tiles = []
  if (data.tiles.length < len) {
    const padded = new Array(len).fill(0)
    for (let i = 0; i < data.tiles.length; i++) padded[i] = data.tiles[i] ?? 0
    data.tiles = padded
  }
  return data as OfficeLayout
}

const RE_READING = /^Reading/i
const RE_SEARCHING = /^Searching|^Fetching web|^Searching the web/i

function detectTool(status: string): 'Read' | 'Grep' | 'Write' {
  if (RE_READING.test(status)) return 'Read'
  if (RE_SEARCHING.test(status)) return 'Grep'
  return 'Write'
}

// ── Component ───────────────────────────────────────────────────

export interface OfficeViewProps {
  buildingId: string
  agents: OfficeAgent[]
  onAgentSelect?: (agentId: string) => void
}

export function OfficeView({ buildingId, agents, onAgentSelect }: OfficeViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const officeRef = useRef<OfficeState | null>(null)
  const offsetRef = useRef({ x: 0, y: 0 })
  const panRef = useRef({ x: 0, y: 0 })
  const isPanningRef = useRef(false)
  const panStartRef = useRef({ mouseX: 0, mouseY: 0, panX: 0, panY: 0 })
  const zoomAccRef = useRef(0)

  const [zoom, setZoom] = useState(() => Math.round(ZOOM_DEFAULT_DPR_FACTOR * (window.devicePixelRatio || 1)))
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Load assets + layout ────────────────────────────────────

  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        const furnitureData = await loadAllAssets()
        if (furnitureData) buildDynamicCatalog(furnitureData)

        let layout: OfficeLayout | null = null
        try {
          const store = getOfficeStore()
          layout = await store.loadLayout(buildingId)
          if (layout) layout = normalizeLayout(layout)
        } catch (err) {
          console.warn('[OfficeView] Failed to load layout:', err)
        }

        if (cancelled) return

        const os = layout ? new OfficeState(layout) : new OfficeState()
        officeRef.current = os
        setReady(true)
      } catch (err: any) {
        console.error('[OfficeView] Init failed:', err)
        if (!cancelled) setError(err.message ?? 'Failed to initialize office')
      }
    }

    init()
    return () => { cancelled = true }
  }, [buildingId])

  // ── Sync agents → office characters ─────────────────────────

  useEffect(() => {
    const os = officeRef.current
    if (!os || !ready) return

    const currentIds = new Set(os.characters.keys())
    const remoteIds = new Set(agents.filter(a => a.active).map(a => a.agentId))

    for (const agent of agents) {
      if (!agent.active) continue
      if (!currentIds.has(agent.agentId)) {
        os.addAgent(agent.agentId, undefined, undefined, undefined, true, undefined, agent.model, agent.name)
      }
      if (agent.status) {
        os.setAgentStatusText(agent.agentId, agent.status)
        os.setAgentActive(agent.agentId, true)
        os.setAgentTool(agent.agentId, detectTool(agent.status))
      } else {
        os.setAgentActive(agent.agentId, false)
        os.setAgentTool(agent.agentId, null)
        os.setAgentStatusText(agent.agentId, null)
      }
    }

    for (const id of currentIds) {
      if (!remoteIds.has(id)) {
        os.removeAgent(id)
      }
    }
  }, [agents, ready])

  // ── Canvas resize ───────────────────────────────────────────

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    setupCanvas(canvas, container)
  }, [])

  // ── Pan clamping ────────────────────────────────────────────

  const clampPan = useCallback((px: number, py: number) => {
    const canvas = canvasRef.current
    const os = officeRef.current
    if (!canvas || !os) return { x: px, y: py }
    const layout = os.getLayout()
    const mapW = layout.cols * TILE_SIZE * zoom
    const mapH = layout.rows * TILE_SIZE * zoom
    const mX = canvas.width * PAN_MARGIN_FRACTION
    const mY = canvas.height * PAN_MARGIN_FRACTION
    const maxX = (mapW / 2) + canvas.width / 2 - mX
    const maxY = (mapH / 2) + canvas.height / 2 - mY
    return {
      x: Math.max(-maxX, Math.min(maxX, px)),
      y: Math.max(-maxY, Math.min(maxY, py)),
    }
  }, [zoom])

  // ── Game loop ───────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current
    const os = officeRef.current
    if (!canvas || !os || !ready) return

    resizeCanvas()
    const observer = new ResizeObserver(() => resizeCanvas())
    if (containerRef.current) observer.observe(containerRef.current)

    const stop = startGameLoop(canvas, {
      update: (dt) => os.update(dt),
      render: (ctx) => {
        const w = canvas.width
        const h = canvas.height

        if (os.cameraFollowId !== null) {
          const ch = os.characters.get(os.cameraFollowId)
          if (ch) {
            const layout = os.getLayout()
            const mapW = layout.cols * TILE_SIZE * zoom
            const mapH = layout.rows * TILE_SIZE * zoom
            const tX = mapW / 2 - ch.x * zoom
            const tY = mapH / 2 - ch.y * zoom
            const dx = tX - panRef.current.x
            const dy = tY - panRef.current.y
            if (Math.abs(dx) < CAMERA_FOLLOW_SNAP_THRESHOLD && Math.abs(dy) < CAMERA_FOLLOW_SNAP_THRESHOLD) {
              panRef.current = { x: tX, y: tY }
            } else {
              panRef.current = {
                x: panRef.current.x + dx * CAMERA_FOLLOW_LERP,
                y: panRef.current.y + dy * CAMERA_FOLLOW_LERP,
              }
            }
          }
        }

        const selectionRender: SelectionRenderState = {
          selectedAgentId: os.selectedAgentId,
          hoveredAgentId: os.hoveredAgentId,
          hoveredTile: os.hoveredTile,
          seats: os.seats,
          characters: os.characters,
        }

        const { offsetX, offsetY } = renderFrame(
          ctx, w, h,
          os.tileMap,
          os.furniture,
          os.getCharacters(),
          zoom,
          panRef.current.x,
          panRef.current.y,
          selectionRender,
          undefined,
          os.getLayout().tileColors,
          os.getLayout().cols,
          os.getLayout().rows,
        )
        offsetRef.current = { x: offsetX, y: offsetY }
      },
    })

    return () => {
      stop()
      observer.disconnect()
    }
  }, [ready, zoom, resizeCanvas])

  // ── Mouse handlers ──────────────────────────────────────────

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isPanningRef.current = true
    panStartRef.current = {
      mouseX: e.clientX, mouseY: e.clientY,
      panX: panRef.current.x, panY: panRef.current.y,
    }
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanningRef.current) {
      const dx = scalePanDelta(e.clientX - panStartRef.current.mouseX)
      const dy = scalePanDelta(e.clientY - panStartRef.current.mouseY)
      panRef.current = clampPan(panStartRef.current.panX + dx, panStartRef.current.panY + dy)
      return
    }

    const os = officeRef.current
    if (!os) return
    const canvas = canvasRef.current
    if (!canvas) return
    const layout = os.getLayout()
    const tile = sharedScreenToTile(e.clientX, e.clientY, canvas, offsetRef.current, zoom, layout.cols, layout.rows, true)
    if (tile) {
      os.hoveredTile = tile
      let found: string | null = null
      for (const [id, ch] of os.characters) {
        if (ch.tileCol === tile.col && ch.tileRow === tile.row) {
          found = id
          break
        }
      }
      os.hoveredAgentId = found
    }
  }, [zoom, clampPan])

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    const wasPanning = isPanningRef.current
    isPanningRef.current = false

    const dx = Math.abs(e.clientX - panStartRef.current.mouseX)
    const dy = Math.abs(e.clientY - panStartRef.current.mouseY)
    if (wasPanning && (dx > 4 || dy > 4)) return

    const os = officeRef.current
    if (!os) return
    const canvas = canvasRef.current
    if (!canvas) return
    const layout = os.getLayout()
    const tile = sharedScreenToTile(e.clientX, e.clientY, canvas, offsetRef.current, zoom, layout.cols, layout.rows, true)
    if (!tile) return

    for (const [id, ch] of os.characters) {
      if (ch.tileCol === tile.col && ch.tileRow === tile.row) {
        os.selectedAgentId = id
        os.cameraFollowId = id
        onAgentSelect?.(id)
        return
      }
    }
    os.selectedAgentId = null
    os.cameraFollowId = null
  }, [zoom, onAgentSelect])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    zoomAccRef.current += e.deltaY
    if (Math.abs(zoomAccRef.current) >= ZOOM_SCROLL_THRESHOLD) {
      const dir = zoomAccRef.current > 0 ? -1 : 1
      zoomAccRef.current = 0
      setZoom(z => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z + dir)))
    }
  }, [])

  // ── Render ──────────────────────────────────────────────────

  if (error) {
    return (
      <div style={{
        width: '100%', height: '100%', display: 'flex', alignItems: 'center',
        justifyContent: 'center', color: 'var(--text-dim)', fontSize: 12,
      }}>
        <span>Failed to load office: {error}</span>
      </div>
    )
  }

  if (!ready) {
    return (
      <div style={{
        width: '100%', height: '100%', display: 'flex', alignItems: 'center',
        justifyContent: 'center', color: 'var(--text-dim)', fontSize: 12,
      }}>
        <span>Loading office...</span>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', cursor: 'grab' }}
    >
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
      {/* Zoom controls */}
      <div style={{
        position: 'absolute', bottom: 12, right: 12,
        display: 'flex', gap: 4,
      }}>
        <button
          onClick={() => setZoom(z => Math.max(ZOOM_MIN, z - 1))}
          style={{
            width: 28, height: 28, borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(10,10,14,0.85)', color: 'var(--text-bright)',
            cursor: 'pointer', fontSize: 14, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }}
        >−</button>
        <span style={{
          width: 36, height: 28, borderRadius: 6,
          border: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(10,10,14,0.85)', color: 'var(--text-dim)',
          fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{zoom}×</span>
        <button
          onClick={() => setZoom(z => Math.min(ZOOM_MAX, z + 1))}
          style={{
            width: 28, height: 28, borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(10,10,14,0.85)', color: 'var(--text-bright)',
            cursor: 'pointer', fontSize: 14, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }}
        >+</button>
      </div>
    </div>
  )
}
