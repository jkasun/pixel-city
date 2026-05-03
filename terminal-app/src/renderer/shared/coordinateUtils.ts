import { TILE_SIZE } from '@pixel-city/shared/constants'
import { PAN_MARGIN_FRACTION } from '@pixel-city/shared/constants'

// ── Types ────────────────────────────────────────────────────────

export interface CanvasRefs {
  canvas: HTMLCanvasElement | null
  /** Current rendering offset in device pixels (set by the render loop). */
  offset: { x: number; y: number }
}

export interface WorldCoord {
  worldX: number
  worldY: number
}

export interface TileCoord {
  col: number
  row: number
}

export interface LayoutBounds {
  cols: number
  rows: number
}

// ── screenToWorld ────────────────────────────────────────────────

/**
 * Convert browser clientX/clientY to world coordinates.
 *
 * The caller supplies the current zoom level and a function that returns the
 * device-pixel offset of the world origin. This keeps the helper agnostic
 * about *how* the offset is computed (OfficeCanvas stores it differently from
 * CityEditorCanvas).
 */
export function screenToWorld(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement | null,
  zoom: number,
  getOffset: () => { x: number; y: number },
): WorldCoord | null {
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const deviceX = (clientX - rect.left) * dpr
  const deviceY = (clientY - rect.top) * dpr
  const offset = getOffset()
  const worldX = (deviceX - offset.x) / zoom
  const worldY = (deviceY - offset.y) / zoom
  return { worldX, worldY }
}

// ── screenToTile ─────────────────────────────────────────────────

/**
 * Convert browser clientX/clientY to a clamped tile coordinate.
 * Returns null if the tile is outside the layout bounds.
 */
export function screenToTile(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement | null,
  zoom: number,
  getOffset: () => { x: number; y: number },
  bounds: LayoutBounds,
): TileCoord | null {
  const pos = screenToWorld(clientX, clientY, canvas, zoom, getOffset)
  if (!pos) return null
  const col = Math.floor(pos.worldX / TILE_SIZE)
  const row = Math.floor(pos.worldY / TILE_SIZE)
  if (col < 0 || col >= bounds.cols || row < 0 || row >= bounds.rows) return null
  return { col, row }
}

// ── screenToTileUnclamped ────────────────────────────────────────

/**
 * Like screenToTile but allows out-of-bounds coordinates
 * (useful for ghost border / expansion detection).
 */
export function screenToTileUnclamped(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement | null,
  zoom: number,
  getOffset: () => { x: number; y: number },
): TileCoord | null {
  const pos = screenToWorld(clientX, clientY, canvas, zoom, getOffset)
  if (!pos) return null
  const col = Math.floor(pos.worldX / TILE_SIZE)
  const row = Math.floor(pos.worldY / TILE_SIZE)
  return { col, row }
}

// ── clampPan ─────────────────────────────────────────────────────

/**
 * Clamp a pan offset so the map stays reasonably on-screen.
 */
export function clampPan(
  px: number,
  py: number,
  canvas: HTMLCanvasElement | null,
  zoom: number,
  bounds: LayoutBounds,
): { x: number; y: number } {
  if (!canvas) return { x: px, y: py }
  const mapW = bounds.cols * TILE_SIZE * zoom
  const mapH = bounds.rows * TILE_SIZE * zoom
  const marginX = canvas.width * PAN_MARGIN_FRACTION
  const marginY = canvas.height * PAN_MARGIN_FRACTION
  const maxPanX = mapW / 2 + canvas.width / 2 - marginX
  const maxPanY = mapH / 2 + canvas.height / 2 - marginY
  return {
    x: Math.max(-maxPanX, Math.min(maxPanX, px)),
    y: Math.max(-maxPanY, Math.min(maxPanY, py)),
  }
}
