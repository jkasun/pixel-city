import { CityTileType, TILE_SIZE } from './cityLayoutTypes.js'

const TERRAIN_COLORS: Record<number, string> = {
  // Original
  [CityTileType.VOID]: '#1a1a2e',
  [CityTileType.GRASS_1]: '#4a8c3f',
  [CityTileType.GRASS_2]: '#5a9c4f',
  [CityTileType.ROAD]: '#6b6b6b',
  [CityTileType.WATER]: '#3a6fc9',
  [CityTileType.DIRT]: '#8b6b3a',
  [CityTileType.SAND]: '#c9b96b',
  // Nature
  [CityTileType.GRASS_3]: '#3a7530',
  [CityTileType.FLOWERS]: '#4a8c3f',
  [CityTileType.FOREST_FLOOR]: '#2d5a24',
  // Water
  [CityTileType.DEEP_WATER]: '#1e3f7a',
  [CityTileType.SHALLOW_WATER]: '#5a9fd4',
  [CityTileType.SWAMP]: '#3a6b3a',
  // Roads
  [CityTileType.SIDEWALK]: '#9e9e9e',
  [CityTileType.CROSSWALK]: '#8a8a8a',
  [CityTileType.COBBLESTONE]: '#7a7068',
  [CityTileType.HIGHWAY]: '#4a4a4a',
  // Ground
  [CityTileType.GRAVEL]: '#9a8a7a',
  [CityTileType.MUD]: '#5a4a2a',
  [CityTileType.CLAY]: '#b07850',
  [CityTileType.ROCK]: '#6a6a6a',
  // Special
  [CityTileType.SNOW]: '#e8e8f0',
  [CityTileType.ICE]: '#a0d0e8',
  [CityTileType.LAVA]: '#d44a00',
}

// Slight noise colors for pixel-art texture
const TERRAIN_NOISE: Record<number, string | null> = {
  // Original
  [CityTileType.VOID]: null,
  [CityTileType.GRASS_1]: '#3f7a35',
  [CityTileType.GRASS_2]: '#4f8c45',
  [CityTileType.ROAD]: '#5f5f5f',
  [CityTileType.WATER]: '#3063b8',
  [CityTileType.DIRT]: '#7a5c32',
  [CityTileType.SAND]: '#b8a85e',
  // Nature
  [CityTileType.GRASS_3]: '#2d6825',
  [CityTileType.FLOWERS]: '#c85a8a',
  [CityTileType.FOREST_FLOOR]: '#1f4a18',
  // Water
  [CityTileType.DEEP_WATER]: '#152f6a',
  [CityTileType.SHALLOW_WATER]: '#4a8fc4',
  [CityTileType.SWAMP]: '#2a5a2a',
  // Roads
  [CityTileType.SIDEWALK]: '#8e8e8e',
  [CityTileType.CROSSWALK]: '#d0d0d0',
  [CityTileType.COBBLESTONE]: '#6a6058',
  [CityTileType.HIGHWAY]: '#3a3a3a',
  // Ground
  [CityTileType.GRAVEL]: '#8a7a6a',
  [CityTileType.MUD]: '#4a3a1a',
  [CityTileType.CLAY]: '#a06840',
  [CityTileType.ROCK]: '#5a5a5a',
  // Special
  [CityTileType.SNOW]: '#d0d0e0',
  [CityTileType.ICE]: '#80c0d8',
  [CityTileType.LAVA]: '#ff6a10',
}

export function getTerrainColor(type: CityTileType): string {
  return TERRAIN_COLORS[type] || TERRAIN_COLORS[CityTileType.VOID]
}

const spriteCache = new Map<number, HTMLCanvasElement>()

// Seeded random for consistent texture
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 127.1) * 43758.5453
  return x - Math.floor(x)
}

// ── Water animation ──────────────────────────────────────────
const WATER_TILE_TYPES = new Set<number>([
  CityTileType.WATER,
  CityTileType.DEEP_WATER,
  CityTileType.SHALLOW_WATER,
  CityTileType.SWAMP,
])

const WATER_FRAME_COUNT = 8
const WATER_FRAME_DURATION_MS = 250 // ms per frame

// Extra highlight colors for water wave shimmer
const WATER_HIGHLIGHT: Record<number, string> = {
  [CityTileType.WATER]: '#5088d8',
  [CityTileType.DEEP_WATER]: '#2850a0',
  [CityTileType.SHALLOW_WATER]: '#78c0e8',
  [CityTileType.SWAMP]: '#4a7a4a',
}

// cache key: type * 100 + frame
const waterSpriteCache = new Map<number, HTMLCanvasElement>()

function createWaterFrame(type: CityTileType, frame: number): HTMLCanvasElement {
  const key = (type as number) * 100 + frame
  const cached = waterSpriteCache.get(key)
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = TILE_SIZE
  canvas.height = TILE_SIZE
  const ctx = canvas.getContext('2d')!

  const baseColor = getTerrainColor(type)
  const noiseColor = TERRAIN_NOISE[type as number]
  const highlightColor = WATER_HIGHLIGHT[type as number]

  // Fill base
  ctx.fillStyle = baseColor
  ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE)

  // Animated wave pattern — horizontal sine offset per row, shifting with frame
  const phaseOffset = (frame / WATER_FRAME_COUNT) * Math.PI * 2
  for (let y = 0; y < TILE_SIZE; y++) {
    // Wave: horizontal shift varies per row and frame
    const waveShift = Math.sin(y * 0.8 + phaseOffset) * 2

    for (let x = 0; x < TILE_SIZE; x++) {
      const wx = (x + waveShift + TILE_SIZE * 2) % TILE_SIZE
      const seed = type * 1000 + y * TILE_SIZE + Math.floor(wx)
      const r = seededRandom(seed)

      if (r > 0.75 && highlightColor) {
        // Bright shimmer pixels
        ctx.fillStyle = highlightColor
        ctx.fillRect(x, y, 1, 1)
      } else if (r > 0.6 && noiseColor) {
        // Dark noise pixels
        ctx.fillStyle = noiseColor
        ctx.fillRect(x, y, 1, 1)
      }
    }
  }

  waterSpriteCache.set(key, canvas)
  return canvas
}

/** Check if a tile type is animated (water). */
export function isAnimatedTerrain(type: CityTileType): boolean {
  return WATER_TILE_TYPES.has(type as number)
}

/** Get the current animation frame index based on timestamp. */
export function getTerrainAnimFrame(timeMs: number): number {
  return Math.floor(timeMs / WATER_FRAME_DURATION_MS) % WATER_FRAME_COUNT
}

export function createTerrainSprite(type: CityTileType, frame?: number): HTMLCanvasElement {
  // Animated water tiles
  if (WATER_TILE_TYPES.has(type as number) && frame !== undefined) {
    return createWaterFrame(type, frame)
  }

  const cached = spriteCache.get(type as number)
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = TILE_SIZE
  canvas.height = TILE_SIZE
  const ctx = canvas.getContext('2d')!

  // Fill base color
  ctx.fillStyle = getTerrainColor(type)
  ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE)

  // Add pixel noise for texture
  const noise = TERRAIN_NOISE[type as number]
  if (noise) {
    ctx.fillStyle = noise
    for (let y = 0; y < TILE_SIZE; y++) {
      for (let x = 0; x < TILE_SIZE; x++) {
        if (seededRandom((type as number) * 1000 + y * TILE_SIZE + x) > 0.8) {
          ctx.fillRect(x, y, 1, 1)
        }
      }
    }
  }

  spriteCache.set(type as number, canvas)
  return canvas
}
