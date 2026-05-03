/**
 * Floor tile pattern storage and caching.
 *
 * Stores 7 grayscale floor patterns loaded from floors.png.
 * Uses shared colorize module for HSL tinting (Photoshop-style Colorize).
 * Caches colorized SpriteData by (pattern, h, s, b, c) key.
 * Also supports custom imported tiles (ID >= 100).
 */

import type { SpriteData, FloorColor, CustomTileDef } from './types.js'
import { CUSTOM_TILE_BASE_ID } from './types.js'
import { getColorizedSprite, clearColorizeCache } from './colorize.js'
import { TILE_SIZE, FALLBACK_FLOOR_COLOR } from '../constants.js'

/** Default solid gray 16×16 tile used when floors.png is not loaded */
const DEFAULT_FLOOR_SPRITE: SpriteData = Array.from(
  { length: TILE_SIZE },
  () => Array(TILE_SIZE).fill(FALLBACK_FLOOR_COLOR) as string[],
)

/** Module-level storage for floor tile sprites (set once on load) */
let floorSprites: SpriteData[] = []

/** Wall color constant */
export const WALL_COLOR = '#3A3A5C'

/** Set floor tile sprites (called once when extension sends floorTilesLoaded) */
export function setFloorSprites(sprites: SpriteData[]): void {
  floorSprites = sprites
  clearColorizeCache()
}

/** Get the raw (grayscale) floor sprite for a pattern index (1-7 -> array index 0-6).
 *  Falls back to the default solid gray tile when floors.png is not loaded. */
export function getFloorSprite(patternIndex: number): SpriteData | null {
  const idx = patternIndex - 1
  if (idx < 0) return null
  if (idx < floorSprites.length) return floorSprites[idx]
  // No PNG sprites loaded — return default solid tile for any valid pattern index
  if (floorSprites.length === 0 && patternIndex >= 1) return DEFAULT_FLOOR_SPRITE
  return null
}

/** Check if floor sprites are available (always true — falls back to default solid tile) */
export function hasFloorSprites(): boolean {
  return true
}

/** Get count of available floor patterns (at least 1 for the default solid tile) */
export function getFloorPatternCount(): number {
  return floorSprites.length > 0 ? floorSprites.length : 1
}

/** Get all floor sprites (for preview rendering, falls back to default solid tile) */
export function getAllFloorSprites(): SpriteData[] {
  return floorSprites.length > 0 ? floorSprites : [DEFAULT_FLOOR_SPRITE]
}

/**
 * Get a colorized version of a floor sprite.
 * Uses Photoshop-style Colorize: grayscale -> HSL with given hue/saturation,
 * then brightness/contrast adjustment.
 */
export function getColorizedFloorSprite(patternIndex: number, color: FloorColor): SpriteData {
  const key = `floor-${patternIndex}-${color.h}-${color.s}-${color.b}-${color.c}`

  const base = getFloorSprite(patternIndex)
  if (!base) {
    // Return a 16x16 magenta error tile
    const err: SpriteData = Array.from({ length: 16 }, () => Array(16).fill('#FF00FF'))
    return err
  }

  // Floor tiles are always colorized (grayscale patterns need Photoshop-style Colorize)
  return getColorizedSprite(key, base, { ...color, colorize: true })
}

// ── Custom tile support ────────────────────────────────────────

/** Cached HTMLImageElement per custom tile ID */
const customTileImages = new Map<number, HTMLImageElement>()

/** Cached sub-tile canvases: key = `${tileId}-${subCol}-${subRow}-${zoom}` */
const customTileSubCache = new Map<string, HTMLCanvasElement>()

/** Custom tile definitions (set from layout) */
let customTileDefs: CustomTileDef[] = []

/** Check if a tile type is a custom tile */
export function isCustomTile(tileType: number): boolean {
  return tileType >= CUSTOM_TILE_BASE_ID
}

/** Set custom tile definitions and preload images */
export function setCustomTileDefs(defs: CustomTileDef[]): void {
  // Only rebuild if defs changed
  if (customTileDefs === defs) return
  customTileDefs = defs

  // Clear caches for removed tiles
  const newIds = new Set(defs.map(d => d.id))
  for (const id of customTileImages.keys()) {
    if (!newIds.has(id)) customTileImages.delete(id)
  }
  // Clear sub-tile cache (zoom-dependent entries may be stale)
  customTileSubCache.clear()

  // Preload images — prefer inline base64 so OSS works offline; fall back to
  // remote URL only when no local data is bundled.
  for (const def of defs) {
    if (customTileImages.has(def.id)) continue
    const img = new Image()
    img.src = def.imageDataUrl || def.downloadUrl || ''
    customTileImages.set(def.id, img)
  }
}

/** Get a custom tile definition by ID */
export function getCustomTileDef(tileId: number): CustomTileDef | undefined {
  return customTileDefs.find(d => d.id === tileId)
}

/** Get all custom tile definitions */
export function getCustomTileDefs(): CustomTileDef[] {
  return customTileDefs
}

/**
 * Draw a custom tile sub-region onto the canvas context.
 * For a tile with footprint WxH, each cell (col, row) on the grid
 * uses (col % W, row % H) to determine which portion of the image to render.
 */
export function drawCustomTile(
  ctx: CanvasRenderingContext2D,
  tileId: number,
  gridCol: number,
  gridRow: number,
  destX: number,
  destY: number,
  tileSize: number,
): void {
  const def = getCustomTileDef(tileId)
  if (!def) return

  const img = customTileImages.get(tileId)
  if (!img || !img.complete) return

  const subCol = gridCol % def.footprintW
  const subRow = gridRow % def.footprintH
  // Ensure positive modulo for negative coordinates
  const sc = ((subCol % def.footprintW) + def.footprintW) % def.footprintW
  const sr = ((subRow % def.footprintH) + def.footprintH) % def.footprintH

  // Source rect: divide image into footprintW x footprintH sub-tiles
  const srcTileW = img.naturalWidth / def.footprintW
  const srcTileH = img.naturalHeight / def.footprintH
  const srcX = sc * srcTileW
  const srcY = sr * srcTileH

  ctx.drawImage(
    img,
    srcX, srcY, srcTileW, srcTileH,
    destX, destY, tileSize, tileSize,
  )
}

/** Get the next available custom tile ID */
export function getNextCustomTileId(): number {
  let maxId = CUSTOM_TILE_BASE_ID - 1
  for (const def of customTileDefs) {
    if (def.id > maxId) maxId = def.id
  }
  return maxId + 1
}
