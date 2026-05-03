import { TILE_SIZE } from '../constants.js'

// ── Types ──────────────────────────────────────────────────────
interface CloudPuff {
  cx: number // center x in pixels (relative to sprite)
  cy: number // center y in pixels
  r: number  // radius in pixels
}

interface Cloud {
  x: number           // tile-space x (left edge)
  y: number           // tile-space y (top edge)
  speed: number       // tiles per second
  widthTiles: number  // cloud width in tiles
  heightTiles: number // cloud height in tiles
  sprite: HTMLCanvasElement | null
  morphTimer: number
  shapeSeed: number
}

// ── Seeded RNG ─────────────────────────────────────────────────
let _seed = 42
function rng(): number {
  _seed = (_seed * 16807 + 0) % 2147483647
  return (_seed - 1) / 2147483646
}

function rngRange(min: number, max: number): number {
  return min + rng() * (max - min)
}

function rngInt(min: number, max: number): number {
  return Math.floor(rngRange(min, max + 1))
}

// Deterministic random for sprite pixel variation
function pixelRng(seed: number, x: number, y: number): number {
  const s = Math.sin(seed * 127.1 + x * 311.7 + y * 74.96) * 43758.5453
  return s - Math.floor(s)
}

// ── Constants ──────────────────────────────────────────────────
const CLOUD_COUNT = 4
const MORPH_INTERVAL_MIN = 10
const MORPH_INTERVAL_MAX = 18
const CLOUD_SPEED_MIN = 0.06
const CLOUD_SPEED_MAX = 0.15
const CLOUD_W_MIN = 5
const CLOUD_W_MAX = 9
const CLOUD_H_MIN = 2
const CLOUD_H_MAX = 4
const CLOUD_OPACITY = 0.30

// ── Puff-based cloud sprite generator ──────────────────────────
// Builds a cloud from overlapping circles ("puffs") arranged along
// a horizontal baseline, bigger in the middle — classic cumulus shape.
function generatePuffs(widthPx: number, heightPx: number, seed: number): CloudPuff[] {
  // Use a local RNG so we don't disturb the global seed
  let ls = seed
  function lrng(): number {
    ls = (ls * 16807 + 0) % 2147483647
    return (ls - 1) / 2147483646
  }

  const puffs: CloudPuff[] = []
  const baseline = heightPx * 0.62 // vertical center-line for puffs
  const margin = widthPx * 0.12
  const usableW = widthPx - margin * 2

  // Number of puffs: 4–7 depending on width
  const count = Math.max(4, Math.min(7, Math.round(widthPx / (TILE_SIZE * 1.1))))

  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1) // 0..1 across width
    const cx = margin + t * usableW

    // Larger puffs toward center, smaller at edges
    const centeredness = 1 - Math.abs(t - 0.5) * 2 // 0 at edges, 1 at center
    const minR = heightPx * 0.22
    const maxR = heightPx * 0.48
    const r = minR + centeredness * (maxR - minR) + (lrng() - 0.5) * heightPx * 0.1

    // Vertical jitter: center puffs sit higher (cloud top), edge puffs lower
    const cy = baseline - centeredness * heightPx * 0.18 + (lrng() - 0.5) * heightPx * 0.12

    puffs.push({ cx, cy, r: Math.max(heightPx * 0.18, r) })
  }

  // Add 1-2 small extra puffs for irregularity
  const extras = lrng() > 0.4 ? 2 : 1
  for (let i = 0; i < extras; i++) {
    const parent = puffs[Math.floor(lrng() * puffs.length)]
    const angle = lrng() * Math.PI * 2
    const dist = parent.r * (0.3 + lrng() * 0.4)
    puffs.push({
      cx: parent.cx + Math.cos(angle) * dist,
      cy: parent.cy + Math.sin(angle) * dist,
      r: parent.r * (0.4 + lrng() * 0.3),
    })
  }

  return puffs
}

function generateCloudSprite(
  widthPx: number,
  heightPx: number,
  seed: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = widthPx
  canvas.height = heightPx
  const ctx = canvas.getContext('2d')!

  const puffs = generatePuffs(widthPx, heightPx, seed)

  // Build cloud density map — additive blending across puffs so overlapping
  // regions accumulate depth, eliminating visible seams between circles.
  // Uses a smooth (quadratic) falloff so the transition is gradual.
  const densityF = new Float32Array(widthPx * heightPx)

  for (const p of puffs) {
    // Only iterate over bounding box of this puff
    const x0 = Math.max(0, Math.floor(p.cx - p.r))
    const x1 = Math.min(widthPx - 1, Math.ceil(p.cx + p.r))
    const y0 = Math.max(0, Math.floor(p.cy - p.r))
    const y1 = Math.min(heightPx - 1, Math.ceil(p.cy + p.r))
    const rSq = p.r * p.r

    for (let py = y0; py <= y1; py++) {
      const dy = py - p.cy
      const dySq = dy * dy
      for (let px = x0; px <= x1; px++) {
        const dx = px - p.cx
        const distSq = dx * dx + dySq
        if (distSq < rSq) {
          // Smooth quadratic falloff: 1 at center, 0 at edge
          const t = 1 - distSq / rSq
          densityF[py * widthPx + px] += t
        }
      }
    }
  }

  // Normalize to 0..255, clamping at 1.0 (values > 1 from overlap become solid core)
  const mask = new Uint8Array(widthPx * heightPx)
  for (let i = 0; i < densityF.length; i++) {
    if (densityF[i] > 0) {
      mask[i] = Math.min(255, Math.floor(Math.min(densityF[i], 1.0) * 255))
    }
  }

  // Render pixels
  for (let py = 0; py < heightPx; py++) {
    for (let px = 0; px < widthPx; px++) {
      const depth = mask[py * widthPx + px]
      if (depth === 0) continue

      const norm = depth / 255 // 0 = edge, 1 = deep inside
      const r = pixelRng(seed + 3, px, py)

      // Check if edge pixel
      const isEdge = norm < 0.15 ||
        (px > 0 && mask[py * widthPx + px - 1] === 0) ||
        (px < widthPx - 1 && mask[py * widthPx + px + 1] === 0) ||
        (py > 0 && mask[(py - 1) * widthPx + px] === 0) ||
        (py < heightPx - 1 && mask[(py + 1) * widthPx + px] === 0)

      if (isEdge) {
        // Soft, semi-transparent edge
        const a = 0.3 + norm * 0.3 + r * 0.1
        ctx.fillStyle = `rgba(235, 240, 250, ${a})`
      } else if (norm > 0.7) {
        // Bright core
        const bright = 242 + Math.floor(r * 12)
        ctx.fillStyle = `rgb(${bright}, ${bright}, ${Math.min(255, bright + 5)})`
      } else if (norm > 0.4) {
        // Mid body
        const bright = 225 + Math.floor(r * 18)
        ctx.fillStyle = `rgb(${bright}, ${bright + 2}, ${Math.min(255, bright + 8)})`
      } else {
        // Outer body — slightly transparent
        const bright = 215 + Math.floor(r * 15)
        const a = 0.6 + norm * 0.8
        ctx.fillStyle = `rgba(${bright}, ${bright + 4}, ${Math.min(255, bright + 12)}, ${a})`
      }

      ctx.fillRect(px, py, 1, 1)
    }
  }

  return canvas
}

// ── Cloud creation ─────────────────────────────────────────────
function createCloud(mapCols: number, mapRows: number, startAnywhere: boolean): Cloud {
  const widthTiles = rngInt(CLOUD_W_MIN, CLOUD_W_MAX)
  const heightTiles = rngInt(CLOUD_H_MIN, CLOUD_H_MAX)
  const x = startAnywhere
    ? rngRange(-widthTiles, mapCols)
    : -(widthTiles + rng() * 6)
  const y = rngRange(-1, mapRows * 0.5)
  const shapeSeed = Math.floor(rng() * 100000)
  return {
    x,
    y,
    speed: rngRange(CLOUD_SPEED_MIN, CLOUD_SPEED_MAX),
    widthTiles,
    heightTiles,
    sprite: null,
    morphTimer: rngRange(MORPH_INTERVAL_MIN, MORPH_INTERVAL_MAX),
    shapeSeed,
  }
}

function ensureSprite(cloud: Cloud): HTMLCanvasElement {
  if (!cloud.sprite) {
    cloud.sprite = generateCloudSprite(
      cloud.widthTiles * TILE_SIZE,
      cloud.heightTiles * TILE_SIZE,
      cloud.shapeSeed,
    )
  }
  return cloud.sprite
}

// ── Cloud simulation ───────────────────────────────────────────
export class CityClouds {
  clouds: Cloud[] = []
  private mapCols = 0
  private mapRows = 0
  lastInitCols = 0
  lastInitRows = 0

  init(cols: number, rows: number): void {
    this.mapCols = cols
    this.mapRows = rows
    this.lastInitCols = cols
    this.lastInitRows = rows
    _seed = 42 + cols * 7 + rows * 13
    this.clouds = []
    for (let i = 0; i < CLOUD_COUNT; i++) {
      this.clouds.push(createCloud(cols, rows, true))
    }
  }

  update(dt: number): void {
    for (const cloud of this.clouds) {
      cloud.x += cloud.speed * dt

      // Wrap when off right edge
      if (cloud.x > this.mapCols + 2) {
        const oldSeed = _seed
        _seed = cloud.shapeSeed + Math.floor(cloud.x * 100)
        cloud.x = -(cloud.widthTiles + rng() * 4)
        cloud.y = rngRange(-1, this.mapRows * 0.5)
        cloud.widthTiles = rngInt(CLOUD_W_MIN, CLOUD_W_MAX)
        cloud.heightTiles = rngInt(CLOUD_H_MIN, CLOUD_H_MAX)
        cloud.speed = rngRange(CLOUD_SPEED_MIN, CLOUD_SPEED_MAX)
        cloud.shapeSeed = Math.floor(rng() * 100000)
        cloud.sprite = null
        cloud.morphTimer = rngRange(MORPH_INTERVAL_MIN, MORPH_INTERVAL_MAX)
        _seed = oldSeed
        continue
      }

      // Slowly morph shape
      cloud.morphTimer -= dt
      if (cloud.morphTimer <= 0) {
        cloud.shapeSeed = (cloud.shapeSeed + 7919) % 100000
        cloud.sprite = null
        cloud.morphTimer = rngRange(MORPH_INTERVAL_MIN, MORPH_INTERVAL_MAX)
      }
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    for (const cloud of this.clouds) {
      const sprite = ensureSprite(cloud)

      ctx.save()
      ctx.globalAlpha = CLOUD_OPACITY
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(
        sprite,
        cloud.x * TILE_SIZE,
        cloud.y * TILE_SIZE,
      )
      ctx.restore()
    }
  }
}
