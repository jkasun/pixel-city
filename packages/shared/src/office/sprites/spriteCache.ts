import type { SpriteData } from '../types.js'

const zoomCaches = new Map<number, WeakMap<SpriteData, HTMLCanvasElement>>()

// ── Outline sprite generation ─────────────────────────────────

const outlineCache = new WeakMap<SpriteData, SpriteData>()
const grayscaleCache = new WeakMap<SpriteData, SpriteData>()
const blueTintCache = new WeakMap<SpriteData, SpriteData>()

/** Generate a 1px white outline SpriteData (2px larger in each dimension) */
export function getOutlineSprite(sprite: SpriteData): SpriteData {
  const cached = outlineCache.get(sprite)
  if (cached) return cached

  const rows = sprite.length
  const cols = sprite[0].length
  // Expanded grid: +2 in each dimension for 1px border
  const outline: string[][] = []
  for (let r = 0; r < rows + 2; r++) {
    outline.push(new Array<string>(cols + 2).fill(''))
  }

  // For each opaque pixel, mark its 4 cardinal neighbors as white
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (sprite[r][c] === '') continue
      const er = r + 1
      const ec = c + 1
      if (outline[er - 1][ec] === '') outline[er - 1][ec] = '#FFFFFF'
      if (outline[er + 1][ec] === '') outline[er + 1][ec] = '#FFFFFF'
      if (outline[er][ec - 1] === '') outline[er][ec - 1] = '#FFFFFF'
      if (outline[er][ec + 1] === '') outline[er][ec + 1] = '#FFFFFF'
    }
  }

  // Clear pixels that overlap with original opaque pixels
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (sprite[r][c] !== '') {
        outline[r + 1][c + 1] = ''
      }
    }
  }

  outlineCache.set(sprite, outline)
  return outline
}

/** Convert a sprite to grayscale with slight dimming for sub-agent visual distinction */
export function getGrayscaleSprite(sprite: SpriteData): SpriteData {
  const cached = grayscaleCache.get(sprite)
  if (cached) return cached

  const rows = sprite.length
  const cols = sprite[0].length
  const result: SpriteData = []

  for (let r = 0; r < rows; r++) {
    const newRow: string[] = []
    for (let c = 0; c < cols; c++) {
      const pixel = sprite[r][c]
      if (pixel === '') {
        newRow.push('')
        continue
      }
      // Parse hex → RGB → luminance → slightly dimmed grayscale
      const rv = parseInt(pixel.slice(1, 3), 16)
      const gv = parseInt(pixel.slice(3, 5), 16)
      const bv = parseInt(pixel.slice(5, 7), 16)
      // Perceived luminance (ITU-R BT.601)
      const lum = Math.round((0.299 * rv + 0.587 * gv + 0.114 * bv) * 0.85)
      const clamped = Math.max(0, Math.min(255, lum))
      const hex = clamped.toString(16).padStart(2, '0')
      newRow.push(`#${hex}${hex}${hex}`)
    }
    result.push(newRow)
  }

  grayscaleCache.set(sprite, result)
  return result
}

/** Tint a sprite toward cool blue to mark temp (non-permanent) agents. */
export function getBlueTintSprite(sprite: SpriteData): SpriteData {
  const cached = blueTintCache.get(sprite)
  if (cached) return cached

  const rows = sprite.length
  const cols = sprite[0].length
  const result: SpriteData = []

  for (let r = 0; r < rows; r++) {
    const newRow: string[] = []
    for (let c = 0; c < cols; c++) {
      const pixel = sprite[r][c]
      if (pixel === '') {
        newRow.push('')
        continue
      }
      const rv = parseInt(pixel.slice(1, 3), 16)
      const gv = parseInt(pixel.slice(3, 5), 16)
      const bv = parseInt(pixel.slice(5, 7), 16)
      const lum = 0.299 * rv + 0.587 * gv + 0.114 * bv
      // Luminance-based blue target, blended with original to retain some identity
      const tintR = lum * 0.25
      const tintG = lum * 0.50
      const tintB = Math.min(255, lum * 1.0 + 50)
      const nr = Math.max(0, Math.min(255, Math.round(tintR * 0.75 + rv * 0.25)))
      const ng = Math.max(0, Math.min(255, Math.round(tintG * 0.75 + gv * 0.25)))
      const nb = Math.max(0, Math.min(255, Math.round(tintB * 0.75 + bv * 0.25)))
      const toHex = (n: number) => n.toString(16).padStart(2, '0')
      newRow.push(`#${toHex(nr)}${toHex(ng)}${toHex(nb)}`)
    }
    result.push(newRow)
  }

  blueTintCache.set(sprite, result)
  return result
}

export function getCachedSprite(sprite: SpriteData, zoom: number): HTMLCanvasElement {
  let cache = zoomCaches.get(zoom)
  if (!cache) {
    cache = new WeakMap()
    zoomCaches.set(zoom, cache)
  }

  const cached = cache.get(sprite)
  if (cached) return cached

  const rows = sprite.length
  const cols = sprite[0].length
  const canvas = document.createElement('canvas')
  canvas.width = cols * zoom
  canvas.height = rows * zoom
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const color = sprite[r][c]
      if (color === '') continue
      ctx.fillStyle = color
      ctx.fillRect(c * zoom, r * zoom, zoom, zoom)
    }
  }

  cache.set(sprite, canvas)
  return canvas
}
