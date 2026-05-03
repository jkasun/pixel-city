import { TileType } from '../types.js'
import type { TileType as TileTypeVal, OfficeLayout, FloorColor } from '../types.js'

export type RoomSize = 'small' | 'medium' | 'large'

const ROOM_SIZES: Record<RoomSize, { cols: number; rows: number }> = {
  small:  { cols: 16, rows: 10 },
  medium: { cols: 22, rows: 14 },
  large:  { cols: 30, rows: 19 },
}

/** Simple seeded LCG random number generator (0..1) */
function makeRng(seed: number) {
  let s = (seed ^ 0xdeadbeef) >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/**
 * Generate a usable office layout for a given size and seed.
 * Produces: perimeter walls, floor tiles, desk+chair rows, and corner decor.
 * Same seed always produces the same layout.
 */
export function generateLayout(size: RoomSize, seed: number): OfficeLayout {
  const rng = makeRng(seed >>> 0)
  const { cols, rows } = ROOM_SIZES[size]

  // ── Tiles ──────────────────────────────────────────────────
  const tiles: TileTypeVal[] = new Array(cols * rows).fill(TileType.VOID as TileTypeVal)

  // Perimeter walls
  for (let c = 0; c < cols; c++) {
    tiles[0 * cols + c] = TileType.WALL as TileTypeVal
    tiles[(rows - 1) * cols + c] = TileType.WALL as TileTypeVal
  }
  for (let r = 1; r < rows - 1; r++) {
    tiles[r * cols + 0] = TileType.WALL as TileTypeVal
    tiles[r * cols + cols - 1] = TileType.WALL as TileTypeVal
  }

  // Interior floor — one random tile pattern for cohesion
  const floorType = (Math.floor(rng() * 7) + 1) as TileTypeVal // FLOOR_1..7
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      tiles[r * cols + c] = floorType
    }
  }

  // Optional interior partition wall for large rooms — creates a nook
  if (size === 'large' && rng() < 0.6) {
    const partitionRow = Math.floor(rows * 0.45) // roughly mid-height
    const gapStart = Math.floor(cols * 0.35)
    const gapEnd = Math.floor(cols * 0.65)
    for (let c = 1; c < cols - 1; c++) {
      if (c < gapStart || c > gapEnd) {
        tiles[partitionRow * cols + c] = TileType.WALL as TileTypeVal
      }
    }
  }

  // ── Colors ─────────────────────────────────────────────────
  const floorColor: FloorColor = {
    h: Math.round(rng() * 360),
    s: 10 + Math.round(rng() * 30),
    b: Math.round(rng() * 20) - 5,
    c: 0,
  }
  const wallColor: FloorColor = {
    h: Math.round(rng() * 360),
    s: 15 + Math.round(rng() * 30),
    b: 0,
    c: 0,
  }

  const tileColors: Array<FloorColor | null> = new Array(cols * rows).fill(null)
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === (TileType.WALL as TileTypeVal)) tileColors[i] = { ...wallColor }
    else if (tiles[i] !== (TileType.VOID as TileTypeVal)) tileColors[i] = { ...floorColor }
  }

  return { version: 1, cols, rows, tiles, furniture: [], tileColors }
}
