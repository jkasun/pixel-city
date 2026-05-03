import { useRef, useEffect, useCallback } from 'react'
import type { OfficeState } from '@pixel-city/shared/office/engine/officeState'
import type { EditorRenderState, SelectionRenderState } from '@pixel-city/shared/office/engine/renderer'
import { startGameLoop } from '@pixel-city/shared/office/engine/gameLoop'
import { log } from '../../logger'
import { renderFrame } from '@pixel-city/shared/office/engine/renderer'
import { EditTool, TileType, TILE_SIZE } from '@pixel-city/shared/office/types'
import type { TileType as TileTypeVal, OfficeLayout, PlacedFurniture, FloorColor } from '@pixel-city/shared/office/types'
import type { EditorState } from '../editor/editorState.js'
import {
  paintTile,
  placeFurniture,
  removeFurniture,
  moveFurniture,
  rotateFurniture,
  canPlaceFurniture,
  expandLayout,
  getWallPlacementRow,
} from '@pixel-city/shared/office/editor/editorActions'
import { getCatalogEntry, getRotatedType, isRotatable as isFurnitureRotatable } from '@pixel-city/shared/office/layout/furnitureCatalog'
import {
  setupCanvas,
  scalePanDelta,
  screenToWorld as sharedScreenToWorld,
  screenToTile as sharedScreenToTile,
  screenToDevice as sharedScreenToDevice,
} from '@pixel-city/shared/office/canvas/canvasUtils'
import {
  handleOfficeWheel,
  handleOfficeClick,
  handleOfficeContextMenu,
  handleOfficeHover,
  handleOfficeMouseDown,
  handleOfficeMouseLeave,
  type InteractionRefs,
} from '@pixel-city/shared/office/canvas/interactionHandlers'
import {
  CAMERA_FOLLOW_LERP,
  CAMERA_FOLLOW_SNAP_THRESHOLD,
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_SCROLL_THRESHOLD,
  PAN_MARGIN_FRACTION,
} from '@pixel-city/shared/constants'

// ── Helpers ─────────────────────────────────────────────────────

function ensureFurnitureArray(val: PlacedFurniture[] | null | undefined): PlacedFurniture[] {
  return Array.isArray(val) ? val : []
}

function getFurnitureAtTile(layout: OfficeLayout, col: number, row: number): PlacedFurniture | null {
  // Search in reverse so topmost (last placed) furniture is found first
  const furniture = ensureFurnitureArray(layout.furniture)
  for (let i = furniture.length - 1; i >= 0; i--) {
    const item = furniture[i]
    const entry = getCatalogEntry(item.type)
    if (!entry) continue
    if (col >= item.col && col < item.col + entry.footprintW &&
      row >= item.row && row < item.row + entry.footprintH) {
      return item
    }
  }
  return null
}

function getExpandDirection(col: number, row: number, cols: number, rows: number): 'left' | 'right' | 'up' | 'down' | null {
  if (col < 0) return 'left'
  if (col >= cols) return 'right'
  if (row < 0) return 'up'
  if (row >= rows) return 'down'
  return null
}

let furnitureUidCounter = Date.now()
function nextFurnitureUid(): string {
  return `f-${furnitureUidCounter++}`
}

// ── Component ───────────────────────────────────────────────────

interface OfficeCanvasProps {
  officeState: OfficeState
  onClick: (agentId: string) => void
  zoom: number
  onZoomChange: (zoom: number) => void
  panRef: React.MutableRefObject<{ x: number; y: number }>
  // Editor props
  editorState?: EditorState
  onLayoutChange?: (newLayout: OfficeLayout, shift?: { col: number; row: number }) => void
  onPushUndo?: () => void
}

export function OfficeCanvas({
  officeState,
  onClick,
  zoom,
  onZoomChange,
  panRef,
  editorState,
  onLayoutChange,
  onPushUndo,
}: OfficeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const offsetRef = useRef({ x: 0, y: 0 })
  const isPanningRef = useRef(false)
  const panStartRef = useRef({ mouseX: 0, mouseY: 0, panX: 0, panY: 0 })
  const zoomAccumulatorRef = useRef(0)

  // Editor render state (mutable, read back by renderer for button bounds)
  const editorRenderRef = useRef<EditorRenderState>({
    showGrid: false,
    ghostSprite: null,
    ghostCol: -1,
    ghostRow: -1,
    ghostValid: false,
    selectedCol: 0,
    selectedRow: 0,
    selectedW: 0,
    selectedH: 0,
    hasSelection: false,
    isRotatable: false,
    deleteButtonBounds: null,
    rotateButtonBounds: null,
    showGhostBorder: false,
    ghostBorderHoverCol: -999,
    ghostBorderHoverRow: -999,
  })

  // Track whether a drag occurred (to distinguish click from drag-end)
  const didDragRef = useRef(false)

  const isEditMode = editorState?.isEditMode ?? false

  const clampPan = useCallback((px: number, py: number): { x: number; y: number } => {
    const canvas = canvasRef.current
    if (!canvas) return { x: px, y: py }
    const layout = officeState.getLayout()
    const mapW = layout.cols * TILE_SIZE * zoom
    const mapH = layout.rows * TILE_SIZE * zoom
    const marginX = canvas.width * PAN_MARGIN_FRACTION
    const marginY = canvas.height * PAN_MARGIN_FRACTION
    const maxPanX = (mapW / 2) + canvas.width / 2 - marginX
    const maxPanY = (mapH / 2) + canvas.height / 2 - marginY
    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, px)),
      y: Math.max(-maxPanY, Math.min(maxPanY, py)),
    }
  }, [officeState, zoom])

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    setupCanvas(canvas, container)
  }, [])

  // ── Coordinate conversion (shared utilities) ─────────────────

  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current
      if (!canvas) return null
      return sharedScreenToWorld(clientX, clientY, canvas, offsetRef.current, zoom)
    },
    [zoom],
  )

  const screenToTile = useCallback(
    (clientX: number, clientY: number): { col: number; row: number } | null => {
      const canvas = canvasRef.current
      if (!canvas) return null
      const layout = officeState.getLayout()
      return sharedScreenToTile(clientX, clientY, canvas, offsetRef.current, zoom, layout.cols, layout.rows, true)
    },
    [zoom, officeState],
  )

  /** Like screenToTile but allows out-of-bounds (for ghost border detection) */
  const screenToTileUnclamped = useCallback(
    (clientX: number, clientY: number): { col: number; row: number } | null => {
      const canvas = canvasRef.current
      if (!canvas) return null
      const layout = officeState.getLayout()
      return sharedScreenToTile(clientX, clientY, canvas, offsetRef.current, zoom, layout.cols, layout.rows, false)
    },
    [zoom, officeState],
  )

  /** Convert device pixel coordinates to check button hit */
  const screenToDevice = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const canvas = canvasRef.current
      if (!canvas) return null
      return sharedScreenToDevice(clientX, clientY, canvas)
    },
    [],
  )

  // ── Editor helpers ────────────────────────────────────────────

  const applyLayout = useCallback(
    (newLayout: OfficeLayout, shift?: { col: number; row: number }) => {
      onLayoutChange?.(newLayout, shift)
    },
    [onLayoutChange],
  )

  const pushUndoAndApply = useCallback(
    (newLayout: OfficeLayout, shift?: { col: number; row: number }) => {
      onPushUndo?.()
      applyLayout(newLayout, shift)
    },
    [onPushUndo, applyLayout],
  )

  // Update editor render state each frame
  const updateEditorRenderState = useCallback(() => {
    const er = editorRenderRef.current
    if (!editorState || !isEditMode) {
      er.showGrid = false
      er.ghostSprite = null
      er.hasSelection = false
      er.showGhostBorder = false
      return
    }

    er.showGrid = true

    const layout = officeState.getLayout()
    const tool = editorState.activeTool

    // Ghost border (expansion tiles)
    const showBorder = tool === EditTool.TILE_PAINT || tool === EditTool.WALL_PAINT ||
      tool === EditTool.ERASE || tool === EditTool.FURNITURE_PLACE
    er.showGhostBorder = showBorder

    // Ghost preview for furniture placement
    if (tool === EditTool.FURNITURE_PLACE && editorState.ghostCol >= 0) {
      const entry = getCatalogEntry(editorState.selectedFurnitureType)
      er.ghostSprite = entry?.sprite ?? null
      er.ghostCol = editorState.ghostCol
      er.ghostRow = editorState.ghostRow
      er.ghostValid = editorState.ghostValid
    } else if (editorState.dragUid && editorState.isDragMoving) {
      // Furniture drag preview
      const furnitureArr = ensureFurnitureArray(layout.furniture)
      const item = furnitureArr.find(f => f.uid === editorState.dragUid)
      if (item) {
        const entry = getCatalogEntry(item.type)
        er.ghostSprite = entry?.sprite ?? null
        er.ghostCol = editorState.ghostCol
        er.ghostRow = editorState.ghostRow
        er.ghostValid = editorState.ghostValid
      } else {
        er.ghostSprite = null
      }
    } else {
      er.ghostSprite = null
    }

    // Selection highlight
    if (editorState.selectedFurnitureUid) {
      const furnitureArr = ensureFurnitureArray(layout.furniture)
      const item = furnitureArr.find(f => f.uid === editorState.selectedFurnitureUid)
      if (item) {
        const entry = getCatalogEntry(item.type)
        if (entry) {
          er.hasSelection = true
          er.selectedCol = item.col
          er.selectedRow = item.row
          er.selectedW = entry.footprintW
          er.selectedH = entry.footprintH
          er.isRotatable = isFurnitureRotatable(item.type)
        } else {
          er.hasSelection = false
        }
      } else {
        er.hasSelection = false
        editorState.selectedFurnitureUid = null
      }
    } else {
      er.hasSelection = false
    }
  }, [editorState, isEditMode, officeState])

  // ── Game loop ─────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    resizeCanvas()

    const observer = new ResizeObserver(() => resizeCanvas())
    if (containerRef.current) {
      observer.observe(containerRef.current)
    }

    const stop = startGameLoop(canvas, {
      update: (dt) => {
        officeState.update(dt)
      },
      render: (ctx) => {
        const w = canvas.width
        const h = canvas.height

        // Camera follow
        if (officeState.cameraFollowId !== null) {
          const followCh = officeState.characters.get(officeState.cameraFollowId)
          if (followCh) {
            const layout = officeState.getLayout()
            const mapW = layout.cols * TILE_SIZE * zoom
            const mapH = layout.rows * TILE_SIZE * zoom
            const targetX = mapW / 2 - followCh.x * zoom
            const targetY = mapH / 2 - followCh.y * zoom
            const dx = targetX - panRef.current.x
            const dy = targetY - panRef.current.y
            if (Math.abs(dx) < CAMERA_FOLLOW_SNAP_THRESHOLD && Math.abs(dy) < CAMERA_FOLLOW_SNAP_THRESHOLD) {
              panRef.current = { x: targetX, y: targetY }
            } else {
              panRef.current = {
                x: panRef.current.x + dx * CAMERA_FOLLOW_LERP,
                y: panRef.current.y + dy * CAMERA_FOLLOW_LERP,
              }
            }
          }
        }

        const selectionRender: SelectionRenderState = {
          selectedAgentId: officeState.selectedAgentId,
          hoveredAgentId: officeState.hoveredAgentId,
          hoveredTile: officeState.hoveredTile,
          seats: officeState.seats,
          characters: officeState.characters,
        }

        // Build editor render state
        updateEditorRenderState()
        const editorRender = isEditMode ? editorRenderRef.current : undefined

        const { offsetX, offsetY } = renderFrame(
          ctx, w, h,
          officeState.tileMap,
          officeState.furniture,
          officeState.getCharacters(),
          zoom,
          panRef.current.x,
          panRef.current.y,
          selectionRender,
          editorRender,
          officeState.getLayout().tileColors,
          officeState.getLayout().cols,
          officeState.getLayout().rows,
        )
        offsetRef.current = { x: offsetX, y: offsetY }
      },
      onError: (err, { failCount, sampled, fatal }) => {
        if (fatal) log.fatal('gameLoop', err, { stopped: true })
        else if (sampled) log.error('gameLoop', err, { failCount })
      },
    })

    return () => {
      stop()
      observer.disconnect()
    }
  }, [officeState, resizeCanvas, zoom, panRef, isEditMode, updateEditorRenderState])

  // ── Mouse handlers ────────────────────────────────────────────

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      // Panning (any mode)
      if (isPanningRef.current) {
        const dx = scalePanDelta(e.clientX - panStartRef.current.mouseX)
        const dy = scalePanDelta(e.clientY - panStartRef.current.mouseY)
        panRef.current = clampPan(panStartRef.current.panX + dx, panStartRef.current.panY + dy)
        return
      }

      // ── Editor mode ──
      if (isEditMode && editorState) {
        const layout = officeState.getLayout()
        const tile = screenToTile(e.clientX, e.clientY)
        const tileU = screenToTileUnclamped(e.clientX, e.clientY)
        const tool = editorState.activeTool

        // Update ghost border hover
        if (tileU) {
          const dir = getExpandDirection(tileU.col, tileU.row, layout.cols, layout.rows)
          if (dir) {
            editorRenderRef.current.ghostBorderHoverCol = tileU.col
            editorRenderRef.current.ghostBorderHoverRow = tileU.row
          } else {
            editorRenderRef.current.ghostBorderHoverCol = -999
            editorRenderRef.current.ghostBorderHoverRow = -999
          }
        }

        // Tile paint/erase/wall drag
        if (editorState.isDragging && tile) {
          if (tool === EditTool.TILE_PAINT) {
            const newLayout = paintTile(layout, tile.col, tile.row, editorState.selectedTileType, editorState.floorColor)
            if (newLayout !== layout) applyLayout(newLayout)
          } else if (tool === EditTool.ERASE) {
            let newLayout = layout
            const hit = getFurnitureAtTile(newLayout, tile.col, tile.row)
            if (hit) {
              newLayout = removeFurniture(newLayout, hit.uid)
            } else {
              newLayout = paintTile(newLayout, tile.col, tile.row, TileType.VOID as TileTypeVal)
            }
            if (newLayout !== layout) applyLayout(newLayout)
          } else if (tool === EditTool.WALL_PAINT) {
            const idx = tile.row * layout.cols + tile.col
            const isWall = layout.tiles[idx] === TileType.WALL
            if (editorState.wallDragAdding === true && !isWall) {
              const newLayout = paintTile(layout, tile.col, tile.row, TileType.WALL as TileTypeVal, editorState.wallColor)
              if (newLayout !== layout) applyLayout(newLayout)
            } else if (editorState.wallDragAdding === false && isWall) {
              const newLayout = paintTile(layout, tile.col, tile.row, editorState.selectedTileType, editorState.floorColor)
              if (newLayout !== layout) applyLayout(newLayout)
            }
          }
          return
        }

        // Furniture drag-move
        if (editorState.dragUid && tile) {
          const newCol = tile.col - editorState.dragOffsetCol
          const newRow = tile.row - editorState.dragOffsetRow
          if (newCol !== editorState.ghostCol || newRow !== editorState.ghostRow) {
            editorState.isDragMoving = true
            editorState.ghostCol = newCol
            editorState.ghostRow = newRow
            editorState.ghostValid = canPlaceFurniture(layout, ensureFurnitureArray(layout.furniture).find(f => f.uid === editorState.dragUid)!.type, newCol, newRow, editorState.dragUid)
          }
          return
        }

        // Ghost preview for furniture placement
        if (tool === EditTool.FURNITURE_PLACE && tile) {
          const entry = getCatalogEntry(editorState.selectedFurnitureType)
          if (entry) {
            const placementRow = entry.canPlaceOnWalls ? getWallPlacementRow(editorState.selectedFurnitureType, tile.row) : tile.row
            editorState.ghostCol = tile.col
            editorState.ghostRow = placementRow
            editorState.ghostValid = canPlaceFurniture(layout, editorState.selectedFurnitureType, tile.col, placementRow)
          }
        } else if (tool !== EditTool.FURNITURE_PLACE) {
          editorState.clearGhost()
        }

        // Cursor
        const canvas = canvasRef.current
        if (canvas) {
          if (tool === EditTool.TILE_PAINT || tool === EditTool.WALL_PAINT || tool === EditTool.ERASE) {
            canvas.style.cursor = 'crosshair'
          } else if (tool === EditTool.FURNITURE_PLACE) {
            canvas.style.cursor = 'copy'
          } else if (tool === EditTool.EYEDROPPER || tool === EditTool.FURNITURE_PICK) {
            canvas.style.cursor = 'crosshair'
          } else if (tool === EditTool.SELECT) {
            // Check if hovering over furniture
            if (tile) {
              const furn = getFurnitureAtTile(layout, tile.col, tile.row)
              canvas.style.cursor = furn ? 'pointer' : 'default'
            } else {
              canvas.style.cursor = 'default'
            }
          } else {
            canvas.style.cursor = 'default'
          }
        }
        return
      }

      // ── Normal mode (shared handler) ──
      const canvas = canvasRef.current
      if (!canvas) return
      const refs: InteractionRefs = { canvas, offset: offsetRef.current, pan: panRef.current, zoom }
      handleOfficeHover(e.clientX, e.clientY, refs, officeState)
    },
    [officeState, screenToWorld, screenToTile, screenToTileUnclamped, panRef, clampPan, isEditMode, editorState, applyLayout, zoom],
  )

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Middle button: panning (all modes) — shared handler
      if (e.button === 1) {
        e.preventDefault()
        const canvas = canvasRef.current
        if (!canvas) return
        const refs: InteractionRefs = { canvas, offset: offsetRef.current, pan: panRef.current, zoom }
        const ps = handleOfficeMouseDown(e.button, e.clientX, e.clientY, refs, officeState)
        if (ps) {
          isPanningRef.current = true
          panStartRef.current = { mouseX: ps.mouseX, mouseY: ps.mouseY, panX: ps.panX, panY: ps.panY }
        }
        return
      }

      if (e.button !== 0) return
      didDragRef.current = false

      // Focus container so keyboard events (R to rotate, Del to delete) work
      containerRef.current?.focus()

      // ── Editor mode ──
      if (isEditMode && editorState) {
        const layout = officeState.getLayout()
        const tile = screenToTile(e.clientX, e.clientY)
        const tool = editorState.activeTool

        // SELECT tool: check delete/rotate buttons first
        if (tool === EditTool.SELECT && editorState.selectedFurnitureUid) {
          const device = screenToDevice(e.clientX, e.clientY)
          if (device) {
            const er = editorRenderRef.current
            // Delete button hit
            if (er.deleteButtonBounds) {
              const { cx, cy, radius } = er.deleteButtonBounds
              const dist = Math.sqrt((device.x - cx) ** 2 + (device.y - cy) ** 2)
              if (dist <= radius + 2) {
                const newLayout = removeFurniture(layout, editorState.selectedFurnitureUid)
                if (newLayout !== layout) {
                  pushUndoAndApply(newLayout)
                  editorState.clearSelection()
                }
                didDragRef.current = true // prevent click handler
                return
              }
            }
            // Rotate button hit
            if (er.rotateButtonBounds) {
              const { cx, cy, radius } = er.rotateButtonBounds
              const dist = Math.sqrt((device.x - cx) ** 2 + (device.y - cy) ** 2)
              if (dist <= radius + 2) {
                const newLayout = rotateFurniture(layout, editorState.selectedFurnitureUid, 'cw')
                if (newLayout !== layout) {
                  pushUndoAndApply(newLayout)
                }
                didDragRef.current = true
                return
              }
            }
          }
        }

        // SELECT tool: start furniture drag
        if (tool === EditTool.SELECT && tile) {
          const furn = getFurnitureAtTile(layout, tile.col, tile.row)
          if (furn) {
            editorState.selectedFurnitureUid = furn.uid
            editorState.startDrag(furn.uid, furn.col, furn.row, tile.col - furn.col, tile.row - furn.row)
            return
          }
        }

        // TILE_PAINT: start drag
        if (tool === EditTool.TILE_PAINT && tile) {
          onPushUndo?.()
          editorState.isDragging = true
          editorState.clearSelection()
          const newLayout = paintTile(layout, tile.col, tile.row, editorState.selectedTileType, editorState.floorColor)
          if (newLayout !== layout) applyLayout(newLayout)
          didDragRef.current = true
          return
        }

        // ERASE: start drag
        if (tool === EditTool.ERASE && tile) {
          onPushUndo?.()
          editorState.isDragging = true
          editorState.clearSelection()
          let newLayout = layout
          const hit = getFurnitureAtTile(newLayout, tile.col, tile.row)
          if (hit) {
            newLayout = removeFurniture(newLayout, hit.uid)
          } else {
            newLayout = paintTile(newLayout, tile.col, tile.row, TileType.VOID as TileTypeVal)
          }
          if (newLayout !== layout) applyLayout(newLayout)
          didDragRef.current = true
          return
        }

        // WALL_PAINT: start drag
        if (tool === EditTool.WALL_PAINT && tile) {
          onPushUndo?.()
          editorState.isDragging = true
          editorState.clearSelection()
          const idx = tile.row * layout.cols + tile.col
          const isWall = layout.tiles[idx] === TileType.WALL
          editorState.wallDragAdding = !isWall
          if (isWall) {
            // Remove wall → paint floor
            const newLayout = paintTile(layout, tile.col, tile.row, editorState.selectedTileType, editorState.floorColor)
            if (newLayout !== layout) applyLayout(newLayout)
          } else {
            // Add wall
            const newLayout = paintTile(layout, tile.col, tile.row, TileType.WALL as TileTypeVal, editorState.wallColor)
            if (newLayout !== layout) applyLayout(newLayout)
          }
          didDragRef.current = true
          return
        }

        return
      }

      // ── Normal mode (no change) ──
    },
    [officeState, panRef, screenToTile, screenToDevice, isEditMode, editorState, applyLayout, pushUndoAndApply, onPushUndo],
  )

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      // End panning
      if (e.button === 1) {
        isPanningRef.current = false
        const canvas = canvasRef.current
        if (canvas) canvas.style.cursor = 'default'
        return
      }

      if (e.button !== 0) return

      // ── Editor mode ──
      if (isEditMode && editorState) {
        // End tile paint/erase/wall drag
        if (editorState.isDragging) {
          editorState.isDragging = false
          editorState.wallDragAdding = null
          return
        }

        // End furniture drag-move
        if (editorState.dragUid) {
          if (editorState.isDragMoving && editorState.ghostValid) {
            const layout = officeState.getLayout()
            onPushUndo?.()
            const newLayout = moveFurniture(layout, editorState.dragUid, editorState.ghostCol, editorState.ghostRow)
            if (newLayout !== layout) applyLayout(newLayout)
          }
          editorState.clearDrag()
          editorState.clearGhost()
          return
        }
      }
    },
    [isEditMode, editorState, officeState, applyLayout, onPushUndo],
  )

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (didDragRef.current) {
        didDragRef.current = false
        return
      }

      // ── Editor mode ──
      if (isEditMode && editorState) {
        const layout = officeState.getLayout()
        const tile = screenToTile(e.clientX, e.clientY)
        const tileU = screenToTileUnclamped(e.clientX, e.clientY)
        const tool = editorState.activeTool

        // Ghost border click → expand layout
        if (tileU) {
          const dir = getExpandDirection(tileU.col, tileU.row, layout.cols, layout.rows)
          if (dir) {
            const result = expandLayout(layout, dir)
            if (result) {
              pushUndoAndApply(result.layout, result.shift)
            }
            return
          }
        }

        if (!tile) return

        // FURNITURE_PLACE: place furniture
        if (tool === EditTool.FURNITURE_PLACE) {
          const entry = getCatalogEntry(editorState.selectedFurnitureType)
          if (!entry) return
          const placementRow = entry.canPlaceOnWalls ? getWallPlacementRow(editorState.selectedFurnitureType, tile.row) : tile.row
          if (!canPlaceFurniture(layout, editorState.selectedFurnitureType, tile.col, placementRow)) return
          const newItem: PlacedFurniture = {
            uid: nextFurnitureUid(),
            type: editorState.selectedFurnitureType,
            col: tile.col,
            row: placementRow,
            ...(editorState.pickedFurnitureColor ? { color: { ...editorState.pickedFurnitureColor } } : {}),
          }
          const newLayout = placeFurniture(layout, newItem)
          if (newLayout !== layout) pushUndoAndApply(newLayout)
          return
        }

        // FURNITURE_PICK: pick furniture type from placed item
        if (tool === EditTool.FURNITURE_PICK) {
          const furn = getFurnitureAtTile(layout, tile.col, tile.row)
          if (furn) {
            editorState.selectedFurnitureType = furn.type
            if (furn.color) {
              editorState.pickedFurnitureColor = { ...furn.color }
            } else {
              editorState.pickedFurnitureColor = null
            }
            editorState.activeTool = EditTool.FURNITURE_PLACE
          }
          return
        }

        // EYEDROPPER: pick floor color + pattern
        if (tool === EditTool.EYEDROPPER) {
          const idx = tile.row * layout.cols + tile.col
          const tileType = layout.tiles[idx]
          if (tileType !== TileType.WALL && tileType !== TileType.VOID) {
            editorState.selectedTileType = tileType
            const color = layout.tileColors?.[idx]
            if (color) {
              editorState.floorColor = { ...color }
            }
            editorState.activeTool = EditTool.TILE_PAINT
          }
          return
        }

        // SELECT: select/deselect furniture
        if (tool === EditTool.SELECT) {
          // If we were dragging but didn't move, this is a select click
          if (editorState.dragUid && !editorState.isDragMoving) {
            editorState.clearDrag()
            // Selection was already set in mouseDown
            return
          }

          const furn = getFurnitureAtTile(layout, tile.col, tile.row)
          if (furn) {
            editorState.selectedFurnitureUid = furn.uid
          } else {
            editorState.clearSelection()
          }
          return
        }

        return
      }

      // ── Normal mode (shared handler) ──
      const canvas = canvasRef.current
      if (!canvas) return
      const refs: InteractionRefs = { canvas, offset: offsetRef.current, pan: panRef.current, zoom }
      handleOfficeClick(e.clientX, e.clientY, refs, officeState, {
        onAgentClick: onClick,
      })
    },
    [officeState, onClick, screenToWorld, screenToTile, screenToTileUnclamped, isEditMode, editorState, applyLayout, pushUndoAndApply, zoom],
  )

  const handleMouseLeave = useCallback(() => {
    isPanningRef.current = false
    handleOfficeMouseLeave(officeState)
    if (editorState) {
      editorState.clearGhost()
      editorRenderRef.current.ghostBorderHoverCol = -999
      editorRenderRef.current.ghostBorderHoverRow = -999
    }
  }, [officeState, editorState])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    if (isEditMode) return // no right-click walk in editor
    const canvas = canvasRef.current
    if (!canvas) return
    const refs: InteractionRefs = { canvas, offset: offsetRef.current, pan: panRef.current, zoom }
    handleOfficeContextMenu(e.clientX, e.clientY, refs, officeState)
  }, [officeState, zoom, isEditMode])

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.cancelable) e.preventDefault()
      const canvas = canvasRef.current
      if (!canvas) return
      const refs: InteractionRefs = { canvas, offset: offsetRef.current, pan: panRef.current, zoom }
      handleOfficeWheel(
        e.deltaX, e.deltaY, e.ctrlKey || e.metaKey,
        refs, officeState, zoomAccumulatorRef,
        clampPan, onZoomChange,
      )
    },
    [zoom, onZoomChange, officeState, panRef, clampPan],
  )

  const handleAuxClick = useCallback((e: React.MouseEvent) => {
    if (e.button === 1) e.preventDefault()
  }, [])

  // ── Keyboard handler for editor ───────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isEditMode || !editorState) return

      const layout = officeState.getLayout()

      // Delete / Backspace: remove selected furniture
      if ((e.key === 'Delete' || e.key === 'Backspace') && editorState.selectedFurnitureUid) {
        e.preventDefault()
        const newLayout = removeFurniture(layout, editorState.selectedFurnitureUid)
        if (newLayout !== layout) {
          pushUndoAndApply(newLayout)
          editorState.clearSelection()
        }
        return
      }

      // R: rotate selected furniture or placement ghost
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey) {
        const direction = e.shiftKey ? 'ccw' : 'cw'

        // Rotate selected furniture
        if (editorState.selectedFurnitureUid) {
          e.preventDefault()
          const newLayout = rotateFurniture(layout, editorState.selectedFurnitureUid, direction)
          if (newLayout !== layout) {
            pushUndoAndApply(newLayout)
          }
          return
        }

        // Rotate furniture placement ghost
        if (editorState.activeTool === EditTool.FURNITURE_PLACE) {
          e.preventDefault()
          const nextType = getRotatedType(editorState.selectedFurnitureType, direction)
          if (nextType) {
            editorState.selectedFurnitureType = nextType
          }
          return
        }
      }

      // Escape: deselect
      if (e.key === 'Escape') {
        editorState.clearSelection()
        editorState.clearGhost()
        return
      }
    },
    [isEditMode, editorState, officeState, pushUndoAndApply],
  )

  return (
    <div
      data-testid="office-canvas-container"
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        background: '#1E1E2E',
      }}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <canvas
        data-testid="office-canvas"
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onClick={handleClick}
        onAuxClick={handleAuxClick}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
        style={{ display: 'block' }}
      />
    </div>
  )
}
