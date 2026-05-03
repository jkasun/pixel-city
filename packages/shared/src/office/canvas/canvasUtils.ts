/**
 * Shared canvas utilities for consistent DPR handling and coordinate conversion.
 * Used by both terminal-app's OfficeCanvas and city-builder's EditorCanvas.
 */

import { TILE_SIZE } from '../types.js'

// ── Canvas DPR setup ─────────────────────────────────────────

export interface CanvasSetupResult {
  width: number   // device pixels
  height: number  // device pixels
  dpr: number
}

/**
 * Set up a canvas for DPR-aware rendering.
 * Sets buffer size, explicit CSS size, and disables image smoothing.
 * Call on mount and on container resize.
 */
export function setupCanvas(
  canvas: HTMLCanvasElement,
  container: HTMLElement,
): CanvasSetupResult {
  const rect = container.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const width = Math.round(rect.width * dpr)
  const height = Math.round(rect.height * dpr)

  canvas.width = width
  canvas.height = height
  canvas.style.width = `${rect.width}px`
  canvas.style.height = `${rect.height}px`

  const ctx = canvas.getContext('2d')
  if (ctx) ctx.imageSmoothingEnabled = false

  return { width, height, dpr }
}

// ── Pan delta scaling ────────────────────────────────────────

/**
 * Scale a pan delta from CSS pixels to device pixels.
 * renderFrame operates in device-pixel space, so pan values must be DPR-scaled.
 */
export function scalePanDelta(delta: number): number {
  return delta * (window.devicePixelRatio || 1)
}

// ── Coordinate conversion ────────────────────────────────────

/**
 * Convert screen (client) coordinates to world coordinates.
 * World coordinates are in unzoomed pixel space (1 unit = 1 sprite pixel).
 */
export function screenToWorld(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  offset: { x: number; y: number },
  zoom: number,
): { worldX: number; worldY: number } | null {
  const rect = canvas.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const deviceX = (clientX - rect.left) * dpr
  const deviceY = (clientY - rect.top) * dpr
  return {
    worldX: (deviceX - offset.x) / zoom,
    worldY: (deviceY - offset.y) / zoom,
  }
}

/**
 * Convert screen (client) coordinates to tile grid coordinates.
 * Returns null if out of bounds (when clamp is true, the default).
 */
export function screenToTile(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  offset: { x: number; y: number },
  zoom: number,
  cols: number,
  rows: number,
  clamp = true,
): { col: number; row: number } | null {
  const pos = screenToWorld(clientX, clientY, canvas, offset, zoom)
  if (!pos) return null
  const col = Math.floor(pos.worldX / TILE_SIZE)
  const row = Math.floor(pos.worldY / TILE_SIZE)
  if (clamp && (col < 0 || col >= cols || row < 0 || row >= rows)) return null
  return { col, row }
}

/**
 * Convert screen coordinates to device pixel coordinates (for button hit-testing).
 */
export function screenToDevice(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  return {
    x: (clientX - rect.left) * dpr,
    y: (clientY - rect.top) * dpr,
  }
}
