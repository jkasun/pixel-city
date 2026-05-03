import { useRef, useEffect, useCallback, useState } from 'react'
import { CityEditTool, CityTileType, TILE_SIZE } from '@pixel-city/shared/city/editor/cityLayoutTypes'
import type { CityTileType as CityTileTypeVal, CityLayout, CityBuildingCatalog, PlacedBuilding } from '@pixel-city/shared/city/editor/cityLayoutTypes'
import type { CityVehicleSimulation } from '@pixel-city/shared/city/cityVehicleSimulation'
import { CityClouds } from '@pixel-city/shared/city/cityClouds'
import type { CityEditorState } from './cityEditorState.js'
import { paintTerrain, placeBuilding, removeBuilding, moveBuilding, canPlaceBuilding, getBuildingAtTile, expandLayout } from '@pixel-city/shared/city/editor/cityEditorActions'
import { createTerrainSprite, getTerrainColor, isAnimatedTerrain, getTerrainAnimFrame } from '@pixel-city/shared/city/editor/cityTerrainTiles'
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_SCROLL_THRESHOLD,
  PAN_MARGIN_FRACTION,
  GRID_LINE_COLOR,
  GHOST_BORDER_STROKE,
  GHOST_BORDER_HOVER_FILL,
  GHOST_BORDER_HOVER_STROKE,
  VOID_TILE_DASH_PATTERN,
} from '@pixel-city/shared/constants'
import { FolderSmallIcon } from '../../icons/index.js'
import type { BuildingAgentSummary, TransientStatusTag } from '../hooks/useBuildingAgentSummaries.js'

let buildingUidCounter = Date.now()
function nextBuildingUid(): string {
  return `cb-${buildingUidCounter++}`
}

function getExpandDirection(col: number, row: number, cols: number, rows: number): 'left' | 'right' | 'up' | 'down' | null {
  if (col < 0) return 'left'
  if (col >= cols) return 'right'
  if (row < 0) return 'up'
  if (row >= rows) return 'down'
  return null
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

export interface CanvasTransform {
  baseX: number
  baseY: number
  zoom: number
  dpr: number
  canvasWidth: number
  canvasHeight: number
}

interface CityEditorCanvasProps {
  layout: CityLayout
  catalog: CityBuildingCatalog
  buildingImages: Record<string, HTMLImageElement>
  buildingDirs?: Record<string, string>
  vehicleImages: Record<string, Record<string, HTMLImageElement>>
  vehicleSim: CityVehicleSimulation
  editorState: CityEditorState
  onLayoutChange: (newLayout: CityLayout) => void
  onPushUndo: () => void
  onEnterBuilding?: (buildingUid: string) => void
  onRequestPlaceBuilding?: (defId: string, col: number, row: number) => void
  onRenameBuilding?: (buildingUid: string, newTitle: string) => void
  onReassignFolder?: (buildingUid: string) => void
  onUnassignFolder?: (buildingUid: string) => void
  onRemoveBuilding?: (buildingUid: string) => void
  onChangeBuildingDef?: (buildingUid: string, newDefId: string) => void
  zoom: number
  onZoomChange: (zoom: number) => void
  showGrid: boolean
  initialScroll?: { x: number; y: number }
  onScrollChange?: (scroll: { x: number; y: number }) => void
  canvasTransformRef?: React.MutableRefObject<CanvasTransform | null>
  canvasContainerRef?: React.MutableRefObject<HTMLDivElement | null>
  buildingAgentSummaries?: Map<string, BuildingAgentSummary>
  transientStatusTagsRef?: React.RefObject<TransientStatusTag[]>
}

export function CityEditorCanvas({
  layout,
  catalog,
  buildingImages,
  buildingDirs,
  vehicleImages,
  vehicleSim,
  editorState,
  onLayoutChange,
  onPushUndo,
  onEnterBuilding,
  onRequestPlaceBuilding,
  onRenameBuilding,
  onReassignFolder,
  onUnassignFolder,
  onRemoveBuilding,
  onChangeBuildingDef,
  zoom,
  onZoomChange,
  showGrid,
  initialScroll,
  onScrollChange,
  canvasTransformRef,
  canvasContainerRef,
  buildingAgentSummaries,
  transientStatusTagsRef,
}: CityEditorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const internalContainerRef = useRef<HTMLDivElement>(null)
  const cloudsRef = useRef(new CityClouds())
  const containerRef = canvasContainerRef || internalContainerRef
  const offsetRef = useRef(initialScroll ?? { x: 0, y: 0 })
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onScrollChangeRef = useRef(onScrollChange)
  onScrollChangeRef.current = onScrollChange
  const notifyScrollChange = useCallback(() => {
    if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current)
    scrollSaveTimerRef.current = setTimeout(() => {
      onScrollChangeRef.current?.(offsetRef.current)
    }, 300)
  }, [])
  const isPanningRef = useRef(false)
  const panStartRef = useRef({ mouseX: 0, mouseY: 0, panX: 0, panY: 0 })
  const zoomAccumulatorRef = useRef(0)
  const didDragRef = useRef(false)
  const ghostBorderHoverRef = useRef({ col: -999, row: -999 })
  const hoveredBuildingUidRef = useRef<string | null>(null)
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const buildingDirsRef = useRef(buildingDirs || {})
  buildingDirsRef.current = buildingDirs || {}
  const buildingAgentSummariesRef = useRef(buildingAgentSummaries)
  buildingAgentSummariesRef.current = buildingAgentSummaries

  // Canvas context menu state
  const [canvasCtxMenu, setCanvasCtxMenu] = useState<{ x: number; y: number; buildingUid: string; hasFolder: boolean } | null>(null)
  const [canvasRenaming, setCanvasRenaming] = useState<{ buildingUid: string; value: string } | null>(null)
  const [changeBuildingPicker, setChangeBuildingPicker] = useState<{ buildingUid: string; currentDefId: string } | null>(null)
  const [changeBuildingSearch, setChangeBuildingSearch] = useState('')
  const changeBuildingSearchRef = useRef<HTMLInputElement>(null)
  const canvasRenameInputRef = useRef<HTMLInputElement>(null)

  // Close canvas context menu on outside click or escape
  useEffect(() => {
    if (!canvasCtxMenu) return
    const handleClick = () => setCanvasCtxMenu(null)
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCanvasCtxMenu(null) }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [canvasCtxMenu])

  // Focus rename input only when rename mode is first activated
  const prevRenamingUid = useRef<string | null>(null)
  useEffect(() => {
    const uid = canvasRenaming?.buildingUid ?? null
    if (uid && uid !== prevRenamingUid.current && canvasRenameInputRef.current) {
      canvasRenameInputRef.current.focus()
      canvasRenameInputRef.current.select()
    }
    prevRenamingUid.current = uid
  }, [canvasRenaming])

  // ── Resize ────────────────────────────────────────────────────

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(rect.width * dpr)
    canvas.height = Math.round(rect.height * dpr)
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`
  }, [])

  // ── Coordinate conversion ─────────────────────────────────────

  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current
      if (!canvas) return null
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const deviceX = (clientX - rect.left) * dpr
      const deviceY = (clientY - rect.top) * dpr
      const l = layoutRef.current
      const mapW = l.cols * TILE_SIZE * zoom
      const mapH = l.rows * TILE_SIZE * zoom
      // Match the centering transform used in render: baseX = (w - mapW)/2 + offset.x
      const baseX = (canvas.width - mapW) / 2 + offsetRef.current.x
      const baseY = (canvas.height - mapH) / 2 + offsetRef.current.y
      const worldX = (deviceX - baseX) / zoom
      const worldY = (deviceY - baseY) / zoom
      return { worldX, worldY }
    },
    [zoom],
  )

  const screenToTile = useCallback(
    (clientX: number, clientY: number): { col: number; row: number } | null => {
      const pos = screenToWorld(clientX, clientY)
      if (!pos) return null
      const col = Math.floor(pos.worldX / TILE_SIZE)
      const row = Math.floor(pos.worldY / TILE_SIZE)
      const l = layoutRef.current
      if (col < 0 || col >= l.cols || row < 0 || row >= l.rows) return null
      return { col, row }
    },
    [screenToWorld],
  )

  /** Like screenToTile but allows 1 tile out-of-bounds (for ghost border expansion) */
  const screenToTileUnclamped = useCallback(
    (clientX: number, clientY: number): { col: number; row: number } | null => {
      const pos = screenToWorld(clientX, clientY)
      if (!pos) return null
      const col = Math.floor(pos.worldX / TILE_SIZE)
      const row = Math.floor(pos.worldY / TILE_SIZE)
      return { col, row }
    },
    [screenToWorld],
  )

  // ── Canvas context menu handlers ─────────────────────────────

  const handleCanvasContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const tile = screenToTile(e.clientX, e.clientY)
    if (!tile) return
    const l = layoutRef.current
    const building = getBuildingAtTile(l, catalog, tile.col, tile.row)
    if (!building) return
    const dirs = buildingDirsRef.current
    const x = Math.min(e.clientX, window.innerWidth - 180)
    const y = Math.min(e.clientY, window.innerHeight - 200)
    setCanvasCtxMenu({ x, y, buildingUid: building.uid, hasFolder: !!dirs[building.uid] })
  }, [screenToTile, catalog])

  const handleCanvasStartRename = useCallback((buildingUid: string) => {
    const l = layoutRef.current
    const b = l.buildings.find(b => b.uid === buildingUid)
    const def = b ? catalog.buildings.find(d => d.id === b.buildingDefId) : undefined
    const currentName = b?.title || def?.name || 'Building'
    setCanvasRenaming({ buildingUid, value: currentName })
    setCanvasCtxMenu(null)
  }, [catalog])

  const handleCanvasCommitRename = useCallback(() => {
    if (canvasRenaming && canvasRenaming.value.trim() && onRenameBuilding) {
      onRenameBuilding(canvasRenaming.buildingUid, canvasRenaming.value.trim())
    }
    setCanvasRenaming(null)
  }, [canvasRenaming, onRenameBuilding])

  const handleCanvasCancelRename = useCallback(() => {
    setCanvasRenaming(null)
  }, [])

  // ── Clamp pan ─────────────────────────────────────────────────

  const clampPan = useCallback(
    (px: number, py: number) => {
      const canvas = canvasRef.current
      if (!canvas) return { x: px, y: py }
      const l = layoutRef.current
      const mapW = l.cols * TILE_SIZE * zoom
      const mapH = l.rows * TILE_SIZE * zoom
      const marginX = canvas.width * PAN_MARGIN_FRACTION
      const marginY = canvas.height * PAN_MARGIN_FRACTION
      const maxPanX = mapW / 2 + canvas.width / 2 - marginX
      const maxPanY = mapH / 2 + canvas.height / 2 - marginY
      return {
        x: Math.max(-maxPanX, Math.min(maxPanX, px)),
        y: Math.max(-maxPanY, Math.min(maxPanY, py)),
      }
    },
    [zoom],
  )

  // ── Editor actions ────────────────────────────────────────────

  const pushUndoAndApply = useCallback(
    (newLayout: CityLayout) => {
      onPushUndo()
      onLayoutChange(newLayout)
    },
    [onPushUndo, onLayoutChange],
  )

  // ── Render loop ───────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    resizeCanvas()
    const observer = new ResizeObserver(() => resizeCanvas())
    if (containerRef.current) observer.observe(containerRef.current)

    let animId: number
    let lastTime = performance.now()

    function render() {
      const ctx = canvas!.getContext('2d')
      if (!ctx) return
      const w = canvas!.width
      const h = canvas!.height
      const l = layoutRef.current

      // Simulation ticks
      const now = performance.now()
      const dt = Math.min((now - lastTime) / 1000, 0.1)
      lastTime = now
      const vehicleDefs = (catalog.vehicles || [])
      if (vehicleDefs.length > 0) {
        vehicleSim.update(dt, l, catalog, vehicleDefs)
      }

      // Init clouds if map size changed
      const clouds = cloudsRef.current
      if (clouds.clouds.length === 0 || l.cols !== clouds.lastInitCols || l.rows !== clouds.lastInitRows) {
        clouds.init(l.cols, l.rows)
      }
      clouds.update(dt)

      ctx.clearRect(0, 0, w, h)

      // Background
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0e0e1a'
      ctx.fillRect(0, 0, w, h)

      ctx.save()
      // Center the map
      const mapW = l.cols * TILE_SIZE * zoom
      const mapH = l.rows * TILE_SIZE * zoom
      const baseX = (w - mapW) / 2 + offsetRef.current.x
      const baseY = (h - mapH) / 2 + offsetRef.current.y
      if (canvasTransformRef) {
        const dpr = window.devicePixelRatio || 1
        canvasTransformRef.current = { baseX, baseY, zoom, dpr, canvasWidth: w, canvasHeight: h }
      }
      ctx.translate(baseX, baseY)
      ctx.scale(zoom, zoom)
      ctx.imageSmoothingEnabled = false

      // Draw terrain
      const animFrame = getTerrainAnimFrame(now)
      for (let r = 0; r < l.rows; r++) {
        for (let c = 0; c < l.cols; c++) {
          const tileType = l.tiles[r * l.cols + c] as CityTileTypeVal
          const sprite = isAnimatedTerrain(tileType)
            ? createTerrainSprite(tileType, animFrame)
            : createTerrainSprite(tileType)
          ctx.drawImage(sprite, c * TILE_SIZE, r * TILE_SIZE)
        }
      }

      // Draw grid lines
      if (showGrid) {
        ctx.strokeStyle = GRID_LINE_COLOR
        ctx.lineWidth = 1 / zoom
        for (let c = 0; c <= l.cols; c++) {
          ctx.beginPath()
          ctx.moveTo(c * TILE_SIZE, 0)
          ctx.lineTo(c * TILE_SIZE, l.rows * TILE_SIZE)
          ctx.stroke()
        }
        for (let r = 0; r <= l.rows; r++) {
          ctx.beginPath()
          ctx.moveTo(0, r * TILE_SIZE)
          ctx.lineTo(l.cols * TILE_SIZE, r * TILE_SIZE)
          ctx.stroke()
        }
      }

      // Draw ghost border (expansion tiles around grid)
      {
        const gh = ghostBorderHoverRef.current
        ctx.save()
        ctx.setLineDash([VOID_TILE_DASH_PATTERN[0] / zoom, VOID_TILE_DASH_PATTERN[1] / zoom])
        ctx.lineWidth = 1 / zoom
        // Top and bottom rows
        for (let c = -1; c <= l.cols; c++) {
          for (const r of [-1, l.rows]) {
            const isHovered = c === gh.col && r === gh.row
            if (isHovered) {
              ctx.fillStyle = GHOST_BORDER_HOVER_FILL
              ctx.fillRect(c * TILE_SIZE, r * TILE_SIZE, TILE_SIZE, TILE_SIZE)
            }
            ctx.strokeStyle = isHovered ? GHOST_BORDER_HOVER_STROKE : GHOST_BORDER_STROKE
            ctx.strokeRect(c * TILE_SIZE + 0.5 / zoom, r * TILE_SIZE + 0.5 / zoom, TILE_SIZE - 1 / zoom, TILE_SIZE - 1 / zoom)
          }
        }
        // Left and right columns (excluding corners)
        for (let r = 0; r < l.rows; r++) {
          for (const c of [-1, l.cols]) {
            const isHovered = c === gh.col && r === gh.row
            if (isHovered) {
              ctx.fillStyle = GHOST_BORDER_HOVER_FILL
              ctx.fillRect(c * TILE_SIZE, r * TILE_SIZE, TILE_SIZE, TILE_SIZE)
            }
            ctx.strokeStyle = isHovered ? GHOST_BORDER_HOVER_STROKE : GHOST_BORDER_STROKE
            ctx.strokeRect(c * TILE_SIZE + 0.5 / zoom, r * TILE_SIZE + 0.5 / zoom, TILE_SIZE - 1 / zoom, TILE_SIZE - 1 / zoom)
          }
        }
        ctx.setLineDash([])
        ctx.restore()
      }

      // Draw buildings (sorted by row for z-order)
      const sortedBuildings = [...l.buildings].sort((a, b) => a.row - b.row)
      const dirs = buildingDirsRef.current
      for (const b of sortedBuildings) {
        const def = catalog.buildings.find((d) => d.id === b.buildingDefId)
        if (!def) continue
        const img = buildingImages[def.id]
        if (!img) continue
        const drawW = def.footprintW * TILE_SIZE
        const drawH = def.footprintH * TILE_SIZE
        const isUnassigned = !dirs[b.uid]
        if (isUnassigned) {
          ctx.save()
          ctx.filter = 'grayscale(1)'
          ctx.globalAlpha = 0.5
          ctx.drawImage(img, b.col * TILE_SIZE, b.row * TILE_SIZE, drawW, drawH)
          ctx.restore()
        } else {
          ctx.drawImage(img, b.col * TILE_SIZE, b.row * TILE_SIZE, drawW, drawH)
        }
      }

      // Draw building title labels (only for assigned buildings)
      for (const b of sortedBuildings) {
        if (!b.title) continue
        if (!dirs[b.uid]) continue // hide label for unassigned buildings
        const def = catalog.buildings.find((d) => d.id === b.buildingDefId)
        if (!def) continue
        const cx = (b.col + def.footprintW / 2) * TILE_SIZE
        const by = b.row * TILE_SIZE - 4
        const fontSize = 4
        ctx.save()
        ctx.font = `${fontSize}px monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        const metrics = ctx.measureText(b.title)
        const pad = 2
        ctx.fillStyle = 'rgba(0,0,0,0.55)'
        ctx.fillRect(cx - metrics.width / 2 - pad, by - fontSize - pad, metrics.width + pad * 2, fontSize + pad * 2)
        ctx.fillStyle = 'rgba(234,231,224,0.85)'
        ctx.fillText(b.title, cx, by)
        ctx.restore()
      }

      // Draw agent summary badges (below building)
      const summaries = buildingAgentSummariesRef.current
      if (summaries) {
        for (const b of sortedBuildings) {
          const summary = summaries.get(b.uid)
          if (!summary || summary.total === 0) continue
          const def = catalog.buildings.find((d) => d.id === b.buildingDefId)
          if (!def) continue

          const cx = (b.col + def.footprintW / 2) * TILE_SIZE
          const by = (b.row + def.footprintH) * TILE_SIZE + 3
          const fontSize = 3
          const text = `${summary.working}/${summary.total}`

          ctx.save()
          ctx.font = `bold ${fontSize}px monospace`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'
          const metrics = ctx.measureText(text)
          const pad = 1.5
          const pillW = metrics.width + pad * 2 + 4
          const pillH = fontSize + pad * 2
          const pillX = cx - pillW / 2
          const pillY = by
          const radius = 2

          ctx.fillStyle = summary.working > 0
            ? 'rgba(34, 197, 94, 0.75)'
            : 'rgba(100, 100, 120, 0.65)'
          roundRect(ctx, pillX, pillY, pillW, pillH, radius)
          ctx.fill()

          // Person dot icon
          ctx.fillStyle = 'rgba(255,255,255,0.9)'
          ctx.beginPath()
          ctx.arc(pillX + pad + 1.5, pillY + pillH / 2, 1, 0, Math.PI * 2)
          ctx.fill()

          // Count text
          ctx.fillStyle = '#fff'
          ctx.fillText(text, cx + 1.5, pillY + pad)
          ctx.restore()
        }
      }

      // Draw transient status tags
      const tags = transientStatusTagsRef?.current
      if (tags && tags.length > 0) {
        const now = performance.now()
        // Group by building
        const tagsByBuilding = new Map<string, TransientStatusTag[]>()
        for (const tag of tags) {
          const age = now - tag.startTime
          if (age > 3000) continue
          const arr = tagsByBuilding.get(tag.buildingUid) || []
          arr.push(tag)
          tagsByBuilding.set(tag.buildingUid, arr)
        }

        for (const [uid, buildingTags] of tagsByBuilding) {
          const b = l.buildings.find((b) => b.uid === uid)
          if (!b) continue
          const def = catalog.buildings.find((d) => d.id === b.buildingDefId)
          if (!def) continue

          const cx = (b.col + def.footprintW / 2) * TILE_SIZE
          const baseTy = b.row * TILE_SIZE - 11
          const fontSize = 3

          for (let i = 0; i < buildingTags.length; i++) {
            const tag = buildingTags[i]
            const age = now - tag.startTime
            const alpha = age < 2500 ? 1.0 : 1.0 - (age - 2500) / 500
            const ty = baseTy - i * (fontSize + 4)
            const displayText = `${tag.agentName}: ${tag.statusText}`

            ctx.save()
            ctx.globalAlpha = alpha
            ctx.font = `${fontSize}px monospace`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'bottom'
            const metrics = ctx.measureText(displayText)
            const pad = 1.5

            ctx.fillStyle = 'rgba(30, 30, 50, 0.8)'
            roundRect(ctx, cx - metrics.width / 2 - pad, ty - fontSize - pad, metrics.width + pad * 2, fontSize + pad * 2, 1.5)
            ctx.fill()

            ctx.fillStyle = 'rgba(147, 197, 253, 0.95)'
            ctx.fillText(displayText, cx, ty)
            ctx.restore()
          }
        }
      }

      // Draw hover highlight on building
      if (hoveredBuildingUidRef.current) {
        const hovered = l.buildings.find((b) => b.uid === hoveredBuildingUidRef.current)
        if (hovered) {
          const def = catalog.buildings.find((d) => d.id === hovered.buildingDefId)
          if (def) {
            const hx = hovered.col * TILE_SIZE
            const hy = hovered.row * TILE_SIZE
            const hw = def.footprintW * TILE_SIZE
            const hh = def.footprintH * TILE_SIZE
            ctx.save()
            ctx.fillStyle = 'rgba(90, 140, 255, 0.12)'
            ctx.fillRect(hx, hy, hw, hh)
            ctx.strokeStyle = 'rgba(90, 140, 255, 0.6)'
            ctx.lineWidth = 1.5 / zoom
            ctx.strokeRect(hx, hy, hw, hh)
            ctx.restore()
          }
        }
      }

      // Draw vehicles (lane offset is baked into v.x/v.y by simulation)
      for (const v of vehicleSim.vehicles) {
        const vDef = (catalog.vehicles || []).find((d) => d.id === v.defId)
        const isHorizontal = v.direction === 'left' || v.direction === 'right'
        const drawW = vDef ? (isHorizontal ? vDef.tileLrW : vDef.tileUdW) * TILE_SIZE : TILE_SIZE
        const drawH = vDef ? (isHorizontal ? vDef.tileLrH : vDef.tileUdH) * TILE_SIZE : TILE_SIZE
        const vx = v.x, vy = v.y
        const dirImgs = vehicleImages[v.defId]
        const shouldMirror = vDef?.mirrorLR && v.direction === 'right'
        const img = dirImgs?.[shouldMirror ? 'left' : v.direction]
        if (img) {
          if (shouldMirror) {
            ctx.save()
            ctx.translate(vx, vy)
            ctx.scale(-1, 1)
            ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH)
            ctx.restore()
          } else {
            ctx.drawImage(img, vx - drawW / 2, vy - drawH / 2, drawW, drawH)
          }
        } else {
          // Fallback: colored rectangle
          ctx.fillStyle = '#e84040'
          ctx.fillRect(vx - drawW / 2, vy - drawH / 2, drawW, drawH)
          // Direction indicator
          ctx.fillStyle = '#fff'
          ctx.beginPath()
          if (v.direction === 'up') { ctx.moveTo(vx, vy - 3); ctx.lineTo(vx - 2, vy + 2); ctx.lineTo(vx + 2, vy + 2) }
          else if (v.direction === 'down') { ctx.moveTo(vx, vy + 3); ctx.lineTo(vx - 2, vy - 2); ctx.lineTo(vx + 2, vy - 2) }
          else if (v.direction === 'left') { ctx.moveTo(vx - 3, vy); ctx.lineTo(vx + 2, vy - 2); ctx.lineTo(vx + 2, vy + 2) }
          else { ctx.moveTo(vx + 3, vy); ctx.lineTo(vx - 2, vy - 2); ctx.lineTo(vx - 2, vy + 2) }
          ctx.fill()
        }
      }

      // Clouds overlay
      clouds.render(ctx)

      // Ghost preview
      const es = editorState
      if (es.activeTool === CityEditTool.BUILDING_PLACE && es.ghostCol >= 0 && es.selectedBuildingDefId) {
        const def = catalog.buildings.find((d) => d.id === es.selectedBuildingDefId)
        if (def) {
          const img = buildingImages[def.id]
          const drawW = def.footprintW * TILE_SIZE
          const drawH = def.footprintH * TILE_SIZE
          ctx.globalAlpha = 0.5
          if (img) {
            ctx.drawImage(img, es.ghostCol * TILE_SIZE, es.ghostRow * TILE_SIZE, drawW, drawH)
          }
          // Tint overlay
          ctx.fillStyle = es.ghostValid ? 'rgba(0, 255, 0, 0.15)' : 'rgba(255, 0, 0, 0.15)'
          ctx.fillRect(es.ghostCol * TILE_SIZE, es.ghostRow * TILE_SIZE, drawW, drawH)
          ctx.globalAlpha = 1.0
        }
      }

      // Drag-move ghost
      if (es.dragUid && es.isDragMoving && es.ghostCol >= 0) {
        const draggedBuilding = l.buildings.find((b) => b.uid === es.dragUid)
        if (draggedBuilding) {
          const def = catalog.buildings.find((d) => d.id === draggedBuilding.buildingDefId)
          if (def) {
            const img = buildingImages[def.id]
            const drawW = def.footprintW * TILE_SIZE
            const drawH = def.footprintH * TILE_SIZE
            ctx.globalAlpha = 0.5
            if (img) {
              ctx.drawImage(img, es.ghostCol * TILE_SIZE, es.ghostRow * TILE_SIZE, drawW, drawH)
            }
            ctx.fillStyle = es.ghostValid ? 'rgba(0, 255, 0, 0.15)' : 'rgba(255, 0, 0, 0.15)'
            ctx.fillRect(es.ghostCol * TILE_SIZE, es.ghostRow * TILE_SIZE, drawW, drawH)
            ctx.globalAlpha = 1.0
          }
        }
      }

      // Selection highlight
      if (es.selectedBuildingUid) {
        const selected = l.buildings.find((b) => b.uid === es.selectedBuildingUid)
        if (selected) {
          const def = catalog.buildings.find((d) => d.id === selected.buildingDefId)
          if (def) {
            ctx.strokeStyle = '#5a8cff'
            ctx.lineWidth = 2 / zoom
            ctx.setLineDash([4 / zoom, 3 / zoom])
            ctx.strokeRect(
              selected.col * TILE_SIZE,
              selected.row * TILE_SIZE,
              def.footprintW * TILE_SIZE,
              def.footprintH * TILE_SIZE,
            )
            ctx.setLineDash([])
          }
        }
      }

      ctx.restore()

      animId = requestAnimationFrame(render)
    }

    animId = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(animId)
      observer.disconnect()
    }
  }, [zoom, showGrid, catalog, buildingImages, vehicleImages, vehicleSim, editorState, resizeCanvas])

  // ── Mouse handlers ────────────────────────────────────────────

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Middle button → pan
      if (e.button === 1) {
        isPanningRef.current = true
        panStartRef.current = {
          mouseX: e.clientX,
          mouseY: e.clientY,
          panX: offsetRef.current.x,
          panY: offsetRef.current.y,
        }
        e.preventDefault()
        return
      }

      if (e.button !== 0) return
      didDragRef.current = false

      const es = editorState
      const l = layoutRef.current
      const tile = screenToTile(e.clientX, e.clientY)
      const tileU = screenToTileUnclamped(e.clientX, e.clientY)

      // Ghost border click → expand layout
      if (!tile && tileU) {
        const dir = getExpandDirection(tileU.col, tileU.row, l.cols, l.rows)
        if (dir) {
          const result = expandLayout(l, dir)
          if (result) {
            pushUndoAndApply(result.layout)
          }
          return
        }
      }

      if (es.activeTool === CityEditTool.TERRAIN_PAINT && tile) {
        onPushUndo()
        const newLayout = paintTerrain(l, tile.col, tile.row, es.selectedTileType)
        onLayoutChange(newLayout)
        es.isDragging = true
      } else if (es.activeTool === CityEditTool.ERASE && tile) {
        onPushUndo()
        const building = getBuildingAtTile(l, catalog, tile.col, tile.row)
        if (building) {
          onLayoutChange(removeBuilding(l, building.uid))
        } else {
          const newLayout = paintTerrain(l, tile.col, tile.row, CityTileType.VOID)
          onLayoutChange(newLayout)
          es.isDragging = true
        }
      } else if (es.activeTool === CityEditTool.SELECT && tile) {
        const building = getBuildingAtTile(l, catalog, tile.col, tile.row)
        if (building) {
          es.selectedBuildingUid = building.uid
          es.startDrag(building.uid, tile.col, tile.row, tile.col - building.col, tile.row - building.row)
        } else {
          es.clearSelection()
          es.clearDrag()
        }
      } else if (es.activeTool === CityEditTool.BUILDING_PLACE && tile && es.selectedBuildingDefId) {
        if (canPlaceBuilding(l, catalog, es.selectedBuildingDefId, tile.col, tile.row)) {
          if (onRequestPlaceBuilding) {
            onRequestPlaceBuilding(es.selectedBuildingDefId, tile.col, tile.row)
          } else {
            pushUndoAndApply(placeBuilding(l, nextBuildingUid(), es.selectedBuildingDefId, tile.col, tile.row))
          }
        }
      }
    },
    [editorState, catalog, screenToTile, screenToTileUnclamped, onLayoutChange, onPushUndo, pushUndoAndApply, onRequestPlaceBuilding],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      // Pan
      if (isPanningRef.current) {
        const dpr = window.devicePixelRatio || 1
        const dx = (e.clientX - panStartRef.current.mouseX) * dpr
        const dy = (e.clientY - panStartRef.current.mouseY) * dpr
        const clamped = clampPan(panStartRef.current.panX + dx, panStartRef.current.panY + dy)
        offsetRef.current = clamped
        notifyScrollChange()
        return
      }

      const es = editorState
      const l = layoutRef.current
      const tile = screenToTile(e.clientX, e.clientY)
      const tileU = screenToTileUnclamped(e.clientX, e.clientY)

      // Update ghost border hover
      if (tileU) {
        const dir = getExpandDirection(tileU.col, tileU.row, l.cols, l.rows)
        if (dir) {
          ghostBorderHoverRef.current = { col: tileU.col, row: tileU.row }
        } else {
          ghostBorderHoverRef.current = { col: -999, row: -999 }
        }
      }

      // Terrain paint drag
      if (es.isDragging && tile) {
        if (es.activeTool === CityEditTool.TERRAIN_PAINT) {
          const newLayout = paintTerrain(l, tile.col, tile.row, es.selectedTileType)
          if (newLayout !== l) onLayoutChange(newLayout)
        } else if (es.activeTool === CityEditTool.ERASE) {
          const newLayout = paintTerrain(l, tile.col, tile.row, CityTileType.VOID)
          if (newLayout !== l) onLayoutChange(newLayout)
        }
      }

      // Track hovered building for highlight + cursor
      if (tile && es.activeTool === CityEditTool.SELECT) {
        const hBuilding = getBuildingAtTile(l, catalog, tile.col, tile.row)
        hoveredBuildingUidRef.current = hBuilding ? hBuilding.uid : null
        const container = containerRef.current
        if (container) {
          container.style.cursor = hBuilding ? 'pointer' : 'crosshair'
        }
      } else {
        hoveredBuildingUidRef.current = null
      }

      // Building placement ghost
      if (es.activeTool === CityEditTool.BUILDING_PLACE && tile && es.selectedBuildingDefId) {
        es.ghostCol = tile.col
        es.ghostRow = tile.row
        es.ghostValid = canPlaceBuilding(l, catalog, es.selectedBuildingDefId, tile.col, tile.row)
      }

      // Drag-move building
      if (es.dragUid && tile) {
        didDragRef.current = true
        es.isDragMoving = true
        const newCol = tile.col - es.dragOffsetCol
        const newRow = tile.row - es.dragOffsetRow
        es.ghostCol = newCol
        es.ghostRow = newRow
        const draggedBuilding = l.buildings.find((b) => b.uid === es.dragUid)
        if (draggedBuilding) {
          es.ghostValid = canPlaceBuilding(l, catalog, draggedBuilding.buildingDefId, newCol, newRow, es.dragUid)
        }
      }
    },
    [editorState, catalog, screenToTile, screenToTileUnclamped, clampPan, onLayoutChange],
  )

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1) {
        isPanningRef.current = false
        return
      }

      const es = editorState
      es.isDragging = false

      // Finish drag-move
      if (es.dragUid && es.isDragMoving && es.ghostValid) {
        const l = layoutRef.current
        const newCol = es.ghostCol
        const newRow = es.ghostRow
        pushUndoAndApply(moveBuilding(l, es.dragUid, newCol, newRow))
      }

      // Single-click enter: if SELECT tool, clicked a building, and didn't drag
      if (es.activeTool === CityEditTool.SELECT && es.dragUid && !didDragRef.current && onEnterBuilding) {
        onEnterBuilding(es.dragUid)
      }

      es.clearDrag()
      es.clearGhost()
    },
    [editorState, pushUndoAndApply, onEnterBuilding],
  )

  // (double-click removed — single click enters buildings via handleMouseUp)

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        zoomAccumulatorRef.current += e.deltaY
        if (Math.abs(zoomAccumulatorRef.current) >= ZOOM_SCROLL_THRESHOLD) {
          const direction = zoomAccumulatorRef.current > 0 ? -1 : 1
          const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom + direction))
          onZoomChange(newZoom)
          zoomAccumulatorRef.current = 0
        }
      } else {
        // Scroll to pan
        const dpr = window.devicePixelRatio || 1
        const clamped = clampPan(
          offsetRef.current.x - e.deltaX * dpr,
          offsetRef.current.y - e.deltaY * dpr,
        )
        offsetRef.current = clamped
        notifyScrollChange()
      }
    },
    [zoom, onZoomChange, clampPan],
  )

  // ── Keyboard handlers ─────────────────────────────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const es = editorState
      const isMeta = e.metaKey || e.ctrlKey

      // Undo
      if (isMeta && !e.shiftKey && e.key === 'z') {
        e.preventDefault()
        const prev = es.popUndo()
        if (prev) {
          es.pushRedo(layoutRef.current)
          onLayoutChange(prev)
        }
        return
      }

      // Redo
      if (isMeta && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        const next = es.popRedo()
        if (next) {
          es.pushUndo(layoutRef.current)
          onLayoutChange(next)
        }
        return
      }

      // Delete selected building
      if ((e.key === 'Delete' || e.key === 'Backspace') && es.selectedBuildingUid) {
        e.preventDefault()
        pushUndoAndApply(removeBuilding(layoutRef.current, es.selectedBuildingUid))
        es.clearSelection()
        return
      }

      // Escape
      if (e.key === 'Escape') {
        es.clearSelection()
        es.clearGhost()
        es.clearDrag()
        if (es.activeTool === CityEditTool.BUILDING_PLACE) {
          es.activeTool = CityEditTool.SELECT
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [editorState, onLayoutChange, pushUndoAndApply])

  return (
    <div
      ref={containerRef}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', cursor: isPanningRef.current ? 'grabbing' : 'crosshair', zIndex: 1 }}
    >
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        onMouseLeave={() => { hoveredBuildingUidRef.current = null }}
        onContextMenu={handleCanvasContextMenu}
        style={{ display: 'block' }}
      />

      {/* Canvas building context menu */}
      {canvasCtxMenu && (
        <div
          className="fixed z-[9999] min-w-[160px] bg-bg-popup border border-border rounded-[6px] py-[4px] shadow-[0_4px_16px_rgba(0,0,0,0.5)] font-ui text-[11px] select-none"
          style={{ left: canvasCtxMenu.x, top: canvasCtxMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button className="flex items-center gap-[8px] px-[12px] py-[5px] w-full bg-transparent border-none text-text font-[inherit] text-[11px] cursor-pointer text-left transition-[background] duration-[80ms] hover:bg-[rgba(92,154,125,0.15)]" onClick={() => handleCanvasStartRename(canvasCtxMenu.buildingUid)}>
            <span className="w-[16px] text-center text-[12px] shrink-0 flex items-center justify-center">&#9998;</span>
            Rename
          </button>
          <button className="flex items-center gap-[8px] px-[12px] py-[5px] w-full bg-transparent border-none text-text font-[inherit] text-[11px] cursor-pointer text-left transition-[background] duration-[80ms] hover:bg-[rgba(92,154,125,0.15)]" onClick={() => {
            const b = layoutRef.current.buildings.find(b => b.uid === canvasCtxMenu.buildingUid)
            if (b) {
              setChangeBuildingPicker({ buildingUid: b.uid, currentDefId: b.buildingDefId })
              setChangeBuildingSearch('')
            }
            setCanvasCtxMenu(null)
          }}>
            <span className="w-[16px] text-center text-[12px] shrink-0 flex items-center justify-center">&#x1F3D7;</span>
            Change Building
          </button>
          <div className="h-[1px] bg-border mx-[8px] my-[4px]" />
          {canvasCtxMenu.hasFolder ? (
            <>
              <button className="flex items-center gap-[8px] px-[12px] py-[5px] w-full bg-transparent border-none text-text font-[inherit] text-[11px] cursor-pointer text-left transition-[background] duration-[80ms] hover:bg-[rgba(92,154,125,0.15)]" onClick={() => { onReassignFolder?.(canvasCtxMenu.buildingUid); setCanvasCtxMenu(null) }}>
                <span className="w-[16px] text-center text-[12px] shrink-0 flex items-center justify-center">
                  <FolderSmallIcon />
                </span>
                Reassign Folder
              </button>
              <button className="flex items-center gap-[8px] px-[12px] py-[5px] w-full bg-transparent border-none text-[#c97b7b] font-[inherit] text-[11px] cursor-pointer text-left transition-[background] duration-[80ms] hover:bg-[rgba(201,123,123,0.12)]" onClick={() => { onUnassignFolder?.(canvasCtxMenu.buildingUid); setCanvasCtxMenu(null) }}>
                <span className="w-[16px] text-center text-[12px] shrink-0 flex items-center justify-center">&#10005;</span>
                Unassign Folder
              </button>
            </>
          ) : (
            <>
              <button className="flex items-center gap-[8px] px-[12px] py-[5px] w-full bg-transparent border-none text-text font-[inherit] text-[11px] cursor-pointer text-left transition-[background] duration-[80ms] hover:bg-[rgba(92,154,125,0.15)]" onClick={() => { onReassignFolder?.(canvasCtxMenu.buildingUid); setCanvasCtxMenu(null) }}>
                <span className="w-[16px] text-center text-[12px] shrink-0 flex items-center justify-center">
                  <FolderSmallIcon />
                </span>
                Assign Folder
              </button>
            </>
          )}
          <div className="h-[1px] bg-border mx-[8px] my-[4px]" />
          <button className="flex items-center gap-[8px] px-[12px] py-[5px] w-full bg-transparent border-none text-[#c97b7b] font-[inherit] text-[11px] cursor-pointer text-left transition-[background] duration-[80ms] hover:bg-[rgba(201,123,123,0.12)]" onClick={() => { onRemoveBuilding?.(canvasCtxMenu.buildingUid); setCanvasCtxMenu(null) }}>
            <span className="w-[16px] text-center text-[12px] shrink-0 flex items-center justify-center">&#128465;</span>
            Remove Building
          </button>
        </div>
      )}

      {/* Canvas inline rename dialog */}
      {canvasRenaming && (
        <div className="absolute inset-0 z-[200] bg-black/60 flex items-center justify-center" onClick={handleCanvasCancelRename}>
          <div className="bg-bg-popup border-2 border-border shadow-[4px_4px_0px_var(--bg-deep)] w-[480px] max-w-[90%] max-w-[340px] font-ui text-text-bright" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-white/8 text-[13px] font-bold tracking-[0.02em]">
              <span>Rename Building</span>
              <button className="bg-transparent border-none text-white/40 cursor-pointer text-sm px-1.5 py-0.5 font-ui hover:text-white/80" onClick={handleCanvasCancelRename}>&#10005;</button>
            </div>
            <input
              ref={canvasRenameInputRef}
              className="w-full bg-bg-input border border-[rgba(92,154,125,0.5)] rounded-[3px] text-text font-ui text-[13px] px-[8px] py-[6px] outline-none leading-[1.3] mt-2 mx-3.5 focus:border-[rgba(92,154,125,0.8)]"
              style={{ width: 'calc(100% - 28px)' }}
              value={canvasRenaming.value}
              onChange={(e) => setCanvasRenaming({ ...canvasRenaming, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); handleCanvasCommitRename() }
                else if (e.key === 'Escape') { e.preventDefault(); handleCanvasCancelRename() }
              }}
            />
            <div className="flex justify-end gap-2 px-3.5 py-2.5 border-t border-white/8 mt-3">
              <button className="py-[5px] px-4 text-xs font-ui border-2 cursor-pointer bg-white/6 text-text-muted border-white/12 hover:bg-white/10 hover:text-white/80" onClick={handleCanvasCancelRename}>Cancel</button>
              <button
                className="py-[5px] px-4 text-xs font-ui border-2 cursor-pointer bg-[rgba(90,200,140,0.15)] text-[rgba(200,255,220,0.95)] border-[#5ac88c] hover:bg-[rgba(90,200,140,0.25)] disabled:opacity-50"
                disabled={!canvasRenaming.value.trim()}
                onClick={handleCanvasCommitRename}
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Change building picker dialog */}
      {changeBuildingPicker && (
        <div className="absolute inset-0 z-[200] bg-black/60 flex items-center justify-center" onClick={() => setChangeBuildingPicker(null)}>
          <div className="bg-bg-popup border-2 border-border shadow-[4px_4px_0px_var(--bg-deep)] w-[420px] max-w-[90%] max-h-[70vh] font-ui text-text-bright flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-white/8 text-[13px] font-bold tracking-[0.02em]">
              <span>Change Building</span>
              <button className="bg-transparent border-none text-white/40 cursor-pointer text-sm px-1.5 py-0.5 font-ui hover:text-white/80" onClick={() => setChangeBuildingPicker(null)}>&#10005;</button>
            </div>
            <div className="px-3.5 py-2">
              <input
                ref={changeBuildingSearchRef}
                className="w-full bg-bg-input border border-[rgba(92,154,125,0.5)] rounded-[3px] text-text font-ui text-[12px] px-[8px] py-[5px] outline-none leading-[1.3] focus:border-[rgba(92,154,125,0.8)]"
                placeholder="Search buildings..."
                value={changeBuildingSearch}
                onChange={(e) => setChangeBuildingSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setChangeBuildingPicker(null) }}
                autoFocus
              />
            </div>
            <div className="flex-1 overflow-auto px-1.5 pb-2" style={{ maxHeight: 'calc(70vh - 90px)' }}>
              {catalog.buildings
                .filter(def => {
                  if (def.id === changeBuildingPicker.currentDefId) return false
                  if (!changeBuildingSearch) return true
                  const q = changeBuildingSearch.toLowerCase()
                  return def.name.toLowerCase().includes(q) || def.type.toLowerCase().includes(q) || def.id.toLowerCase().includes(q)
                })
                .map(def => (
                  <button
                    key={def.id}
                    className="flex items-center gap-[8px] px-[10px] py-[6px] w-full bg-transparent border-none text-text font-[inherit] text-[11px] cursor-pointer text-left transition-[background] duration-[80ms] hover:bg-[rgba(92,154,125,0.15)] rounded-[3px]"
                    onClick={() => {
                      onChangeBuildingDef?.(changeBuildingPicker.buildingUid, def.id)
                      setChangeBuildingPicker(null)
                    }}
                  >
                    <div className="w-[32px] h-[32px] bg-[var(--bg-deep)] flex items-center justify-center shrink-0">
                      {buildingImages[def.id] && (
                        <img
                          src={buildingImages[def.id].src}
                          style={{ maxWidth: 28, maxHeight: 28, imageRendering: 'pixelated' as const }}
                        />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium overflow-hidden text-ellipsis whitespace-nowrap">{def.name}</div>
                      <div className="text-[10px] opacity-40">{def.footprintW}x{def.footprintH} tiles &middot; {def.type}</div>
                    </div>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
