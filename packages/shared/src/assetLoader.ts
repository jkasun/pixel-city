import type { SpriteData } from './office/types.js'
import { setCharacterTemplates } from './office/sprites/spriteData.js'
import { setWallSprites } from './office/wallTiles.js'
import { setFloorSprites } from './office/floorTiles.js'
import type { LoadedAssetData } from './office/layout/furnitureCatalog.js'

// Character sprite PNGs: 112x96 each, 7 frames x 3 directions
// Each frame is 16x32 (CHAR_FRAME_W x CHAR_FRAME_H)
// Rows: 0=down, 1=up, 2=right
// Frames per row: 7 (walk1, walk2, walk3, type1, type2, read1, read2)
const CHAR_FRAME_W = 16
const CHAR_FRAME_H = 32
const CHAR_FRAMES_PER_ROW = 7
const CHAR_COUNT = 7
const PNG_ALPHA_THRESHOLD = 128

// Wall tiles: 64x128 PNG, 4x4 grid of 16x32 pieces
const WALL_PIECE_WIDTH = 16
const WALL_PIECE_HEIGHT = 32
const WALL_GRID_COLS = 4
const WALL_BITMASK_COUNT = 16

interface CharacterDirectionSprites {
  down: SpriteData[]
  up: SpriteData[]
  right: SpriteData[]
}

/** Load a PNG image and return its RGBA pixel data */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

/** Extract RGBA pixel data from an image */
function getImageData(img: HTMLImageElement): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(0, 0, img.width, img.height)
}

/** Convert a region of pixel data to SpriteData */
function regionToSpriteData(
  data: Uint8ClampedArray,
  imgWidth: number,
  ox: number, oy: number,
  w: number, h: number,
): SpriteData {
  const sprite: string[][] = []
  for (let y = 0; y < h; y++) {
    const row: string[] = []
    for (let x = 0; x < w; x++) {
      const idx = ((oy + y) * imgWidth + (ox + x)) * 4
      const r = data[idx]
      const g = data[idx + 1]
      const b = data[idx + 2]
      const a = data[idx + 3]
      if (a < PNG_ALPHA_THRESHOLD) {
        row.push('')
      } else {
        row.push(`#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase())
      }
    }
    sprite.push(row)
  }
  return sprite
}

/** Load all 6 character sprite PNGs from /assets/characters/ */
async function loadCharacterSprites(): Promise<void> {
  const characters: CharacterDirectionSprites[] = []
  const directions: Array<'down' | 'up' | 'right'> = ['down', 'up', 'right']

  for (let ci = 0; ci < CHAR_COUNT; ci++) {
    try {
      const img = await loadImage(`./assets/characters/char_${ci}.png`)
      const imageData = getImageData(img)
      const charData: CharacterDirectionSprites = { down: [], up: [], right: [] }

      for (let dirIdx = 0; dirIdx < directions.length; dirIdx++) {
        const dir = directions[dirIdx]
        const rowOffsetY = dirIdx * CHAR_FRAME_H
        const frames: SpriteData[] = []

        for (let f = 0; f < CHAR_FRAMES_PER_ROW; f++) {
          const frameOffsetX = f * CHAR_FRAME_W
          frames.push(regionToSpriteData(
            imageData.data, img.width,
            frameOffsetX, rowOffsetY,
            CHAR_FRAME_W, CHAR_FRAME_H,
          ))
        }
        charData[dir] = frames
      }
      characters.push(charData)
    } catch (err) {
      console.warn(`Failed to load char_${ci}.png:`, err)
    }
  }

  if (characters.length > 0) {
    setCharacterTemplates(characters)
    console.log(`✓ Loaded ${characters.length} character sprites`)
  }
}

/** Load wall tiles from /assets/walls.png */
async function loadWallTiles(): Promise<void> {
  try {
    const img = await loadImage('./assets/walls.png')
    const imageData = getImageData(img)
    const sprites: SpriteData[] = []

    for (let mask = 0; mask < WALL_BITMASK_COUNT; mask++) {
      const ox = (mask % WALL_GRID_COLS) * WALL_PIECE_WIDTH
      const oy = Math.floor(mask / WALL_GRID_COLS) * WALL_PIECE_HEIGHT
      sprites.push(regionToSpriteData(
        imageData.data, img.width,
        ox, oy,
        WALL_PIECE_WIDTH, WALL_PIECE_HEIGHT,
      ))
    }

    setWallSprites(sprites)
    console.log(`✓ Loaded ${sprites.length} wall tile pieces`)
  } catch (err) {
    console.warn('Failed to load walls.png:', err)
  }
}

// Floor tiles: 112x16 PNG, 7 patterns of 16x16 in a horizontal strip
const FLOOR_PATTERN_SIZE = 16
const FLOOR_PATTERN_COUNT = 7

/** Load floor tile patterns from /assets/floors.png */
async function loadFloorTiles(): Promise<void> {
  try {
    const img = await loadImage('./assets/floors.png')
    const imageData = getImageData(img)
    const sprites: SpriteData[] = []

    for (let i = 0; i < FLOOR_PATTERN_COUNT; i++) {
      const ox = i * FLOOR_PATTERN_SIZE
      sprites.push(regionToSpriteData(
        imageData.data, img.width,
        ox, 0,
        FLOOR_PATTERN_SIZE, FLOOR_PATTERN_SIZE,
      ))
    }

    setFloorSprites(sprites)
    console.log(`✓ Loaded ${sprites.length} floor tile patterns`)
  } catch (err) {
    console.warn('Failed to load floors.png:', err)
  }
}

/** Furniture catalog JSON entry (matches furniture-catalog.json structure) */
interface CatalogJsonEntry {
  id: string
  label: string
  category: string
  file: string
  width: number
  height: number
  footprintW: number
  footprintH: number
  isDesk: boolean
  groupId?: string
  orientation?: string
  state?: string
  canPlaceOnSurfaces?: boolean
  backgroundTiles?: number
  canPlaceOnWalls?: boolean
}

/** Load furniture assets from /assets/furniture/furniture-catalog.json + PNGs */
async function loadFurnitureAssets(): Promise<LoadedAssetData | null> {
  try {
    const resp = await fetch('./assets/furniture/furniture-catalog.json')
    const catalogJson: { assets: CatalogJsonEntry[] } = await resp.json()
    const sprites: Record<string, SpriteData> = {}

    // Load all furniture PNGs in parallel
    const loadPromises = catalogJson.assets.map(async (asset) => {
      try {
        const img = await loadImage(`./assets/${asset.file}`)
        const imageData = getImageData(img)
        sprites[asset.id] = regionToSpriteData(
          imageData.data, img.width,
          0, 0,
          img.width, img.height,
        )
      } catch (err) {
        console.warn(`Failed to load furniture ${asset.id}:`, err)
      }
    })

    await Promise.all(loadPromises)

    const catalog = catalogJson.assets.map((asset) => ({
      id: asset.id,
      label: asset.label,
      category: asset.category,
      width: asset.width,
      height: asset.height,
      footprintW: asset.footprintW,
      footprintH: asset.footprintH,
      isDesk: asset.isDesk,
      ...(asset.groupId ? { groupId: asset.groupId } : {}),
      ...(asset.orientation ? { orientation: asset.orientation } : {}),
      ...(asset.state ? { state: asset.state } : {}),
      ...(asset.canPlaceOnSurfaces ? { canPlaceOnSurfaces: true } : {}),
      ...(asset.backgroundTiles ? { backgroundTiles: asset.backgroundTiles } : {}),
      ...(asset.canPlaceOnWalls ? { canPlaceOnWalls: true } : {}),
    }))

    console.log(`✓ Loaded ${Object.keys(sprites).length} furniture sprites`)
    return { catalog, sprites }
  } catch (err) {
    console.warn('Failed to load furniture catalog:', err)
    return null
  }
}

/** Load all assets. Call this once at app startup. Returns furniture data for dynamic catalog. */
export async function loadAllAssets(): Promise<LoadedAssetData | null> {
  const [, , furnitureData] = await Promise.all([
    loadCharacterSprites(),
    loadWallTiles(),
    loadFurnitureAssets(),
    loadFloorTiles(),
  ])
  return furnitureData
}
