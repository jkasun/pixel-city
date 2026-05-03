import { CityTileType, TILE_SIZE } from './editor/cityLayoutTypes.js'
import type { CityLayout, CityVehicleDef, CityBuildingCatalog, VehicleDirection } from './editor/cityLayoutTypes.js'

function ensureArray<T>(val: T[] | null | undefined): T[] {
  return Array.isArray(val) ? val : []
}

import {
  VEHICLE_SPAWN_INTERVAL_SEC,
  VEHICLE_MAX_COUNT,
} from '../constants.js'

export interface VehicleInstance {
  id: string
  defId: string
  x: number      // pixel center, world coords
  y: number
  direction: VehicleDirection
  speed: number   // tiles/sec
  lastTurnCol: number
  lastTurnRow: number
  /** Pending turn direction decided at intersection entry */
  pendingTurn?: VehicleDirection
  /** Whether the vehicle is currently inside an intersection */
  inIntersection: boolean
}

/** Probability that a vehicle turns at an intersection (0-1) */
const TURN_CHANCE = 0.35

/** Lane drift speed in tiles/sec */
const LANE_DRIFT_SPEED = 3

/** Snap to lane when within this many pixels */
const LANE_SNAP_PX = 1

let vehicleIdCounter = 0

// ── Tile helpers ────────────────────────────────────────────

const ROAD_TILE_TYPES: ReadonlySet<number> = new Set([
  CityTileType.ROAD,
  CityTileType.SIDEWALK,
  CityTileType.CROSSWALK,
  CityTileType.COBBLESTONE,
  CityTileType.HIGHWAY,
])

function isRoadTile(col: number, row: number, layout: CityLayout): boolean {
  if (col < 0 || col >= layout.cols || row < 0 || row >= layout.rows) return false
  return ROAD_TILE_TYPES.has(layout.tiles[row * layout.cols + col])
}

function isBuildingTile(
  col: number, row: number, layout: CityLayout, catalog: CityBuildingCatalog,
): boolean {
  for (const b of ensureArray(layout.buildings)) {
    const def = ensureArray(catalog.buildings).find(d => d.id === b.buildingDefId)
    if (!def) continue
    if (col >= b.col && col < b.col + def.footprintW &&
        row >= b.row && row < b.row + def.footprintH) return true
  }
  return false
}

function isNonRoadNeighbor(
  col: number, row: number, layout: CityLayout, catalog: CityBuildingCatalog,
): boolean {
  if (col < 0 || col >= layout.cols || row < 0 || row >= layout.rows) return true
  if (!ROAD_TILE_TYPES.has(layout.tiles[row * layout.cols + col])) return true
  if (isBuildingTile(col, row, layout, catalog)) return true
  return false
}

// ── Road extent helpers ────────────────────────────────────

function hExtent(c: number, r: number, layout: CityLayout): { min: number; max: number } {
  let min = c, max = c
  while (isRoadTile(min - 1, r, layout)) min--
  while (isRoadTile(max + 1, r, layout)) max++
  return { min, max }
}

function vExtent(c: number, r: number, layout: CityLayout): { min: number; max: number } {
  let min = r, max = r
  while (isRoadTile(c, min - 1, layout)) min--
  while (isRoadTile(c, max + 1, layout)) max++
  return { min, max }
}

// ── Road classification ────────────────────────────────────
//
// Detects whether a road tile is part of a vertical road, horizontal road,
// or an intersection by comparing road extents at the tile vs at the edges.
//
// Grid reference (user spec):
//   x = non-moveable, r = road, i = intersection, b = building
//   xxxxrrrrxxxx    Row 0
//   xxxbrrrrbxxx    Row 1
//   xxxxrrrrxxxx    Row 2
//   rrrriiiirrrr    Row 3  ← intersection rows
//   rrrriiiirrrr    Row 4
//   rrrriiiirrrr    Row 5
//   rrrriiiirrrr    Row 6
//   xxxxrrrrxxxx    Row 7
//   xxxxrrrrxxxx    Row 8
//   xxxbrrrrbxxx    Row 9

type RoadOrientation = 'none' | 'vertical' | 'horizontal' | 'intersection'

interface RoadInfo {
  orientation: RoadOrientation
  /** Vertical road strip column boundaries (for vertical / intersection) */
  vRoadHMin: number
  vRoadHMax: number
  /** Horizontal road strip row boundaries (for horizontal / intersection) */
  hRoadVMin: number
  hRoadVMax: number
}

const EMPTY_INFO: RoadInfo = {
  orientation: 'none', vRoadHMin: 0, vRoadHMax: 0, hRoadVMin: 0, hRoadVMax: 0,
}

function getRoadInfo(c: number, r: number, layout: CityLayout): RoadInfo {
  if (!isRoadTile(c, r, layout)) return EMPTY_INFO

  const h = hExtent(c, r, layout)        // horizontal span at this row
  const v = vExtent(c, r, layout)         // vertical span at this col
  const hW = h.max - h.min + 1
  const vH = v.max - v.min + 1

  // Core vertical road width = horizontal extent at the top of the vertical span
  const edgeH = hExtent(c, v.min, layout)
  const coreVW = edgeH.max - edgeH.min + 1

  // Core horizontal road height = vertical extent at the left of the horizontal span
  const edgeV = vExtent(h.min, r, layout)
  const coreHH = edgeV.max - edgeV.min + 1

  const hasExtraH = hW > coreVW   // horizontal road crosses here
  const hasExtraV = vH > coreHH   // vertical road crosses here

  if (hasExtraH && hasExtraV) {
    return {
      orientation: 'intersection',
      vRoadHMin: edgeH.min, vRoadHMax: edgeH.max,
      hRoadVMin: edgeV.min, hRoadVMax: edgeV.max,
    }
  }

  if (vH >= hW) {
    return {
      orientation: 'vertical',
      vRoadHMin: h.min, vRoadHMax: h.max,
      hRoadVMin: 0, hRoadVMax: 0,
    }
  }

  return {
    orientation: 'horizontal',
    vRoadHMin: 0, vRoadHMax: 0,
    hRoadVMin: v.min, hRoadVMax: v.max,
  }
}

// ── Lane target positions ──────────────────────────────────
//
// Right-hand traffic:
//   UP    → right half of vertical road
//   DOWN  → left half
//   LEFT  → top half of horizontal road
//   RIGHT → bottom half

function targetLaneX(dir: 'up' | 'down', hMin: number, hMax: number): number {
  const w = hMax - hMin + 1
  return dir === 'up'
    ? (hMin + w * 3 / 4) * TILE_SIZE
    : (hMin + w / 4) * TILE_SIZE
}

function targetLaneY(dir: 'left' | 'right', vMin: number, vMax: number): number {
  const h = vMax - vMin + 1
  return dir === 'left'
    ? (vMin + h / 4) * TILE_SIZE
    : (vMin + h * 3 / 4) * TILE_SIZE
}

// ── Spawn points ───────────────────────────────────────────

interface SpawnPoint {
  col: number
  row: number
  direction: VehicleDirection
  spawnX: number
  spawnY: number
}

const NEIGHBOR_DIRS: Array<{ dc: number; dr: number; awayDir: VehicleDirection }> = [
  { dc: 0, dr: -1, awayDir: 'down' },    // non-road above → head down
  { dc: 0, dr: 1,  awayDir: 'up' },      // non-road below → head up
  { dc: -1, dr: 0, awayDir: 'right' },   // non-road left  → head right
  { dc: 1, dr: 0,  awayDir: 'left' },    // non-road right → head left
]

function getSpawnPoints(layout: CityLayout, catalog: CityBuildingCatalog): SpawnPoint[] {
  const points: SpawnPoint[] = []

  for (let r = 0; r < layout.rows; r++) {
    for (let c = 0; c < layout.cols; c++) {
      if (!isRoadTile(c, r, layout)) continue

      const info = getRoadInfo(c, r, layout)
      if (info.orientation === 'none' || info.orientation === 'intersection') continue

      for (const n of NEIGHBOR_DIRS) {
        const nc = c + n.dc
        const nr = r + n.dr
        if (!isNonRoadNeighbor(nc, nr, layout, catalog)) continue

        const dir = n.awayDir

        // Direction must match road orientation
        if (info.orientation === 'vertical' && (dir === 'left' || dir === 'right')) continue
        if (info.orientation === 'horizontal' && (dir === 'up' || dir === 'down')) continue

        // Only spawn in the correct lane half for this direction
        if (dir === 'up' || dir === 'down') {
          const w = info.vRoadHMax - info.vRoadHMin + 1
          const half = Math.floor(w / 2)
          if (dir === 'up' && c < info.vRoadHMin + half) continue    // UP → right half only
          if (dir === 'down' && c >= info.vRoadHMin + half) continue // DOWN → left half only
        } else {
          const h = info.hRoadVMax - info.hRoadVMin + 1
          const half = Math.floor(h / 2)
          if (dir === 'left' && r < info.hRoadVMin + half) continue    // LEFT → bottom half only
          if (dir === 'right' && r >= info.hRoadVMin + half) continue  // RIGHT → top half only
        }

        // Snap spawn position to lane center
        const spawnX = (dir === 'up' || dir === 'down')
          ? targetLaneX(dir, info.vRoadHMin, info.vRoadHMax)
          : (c + 0.5) * TILE_SIZE
        const spawnY = (dir === 'left' || dir === 'right')
          ? targetLaneY(dir, info.hRoadVMin, info.hRoadVMax)
          : (r + 0.5) * TILE_SIZE

        points.push({ col: c, row: r, direction: dir, spawnX, spawnY })
      }
    }
  }
  return points
}

// ── Shuffle ────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ── Simulation class ───────────────────────────────────────

export class CityVehicleSimulation {
  vehicles: VehicleInstance[] = []
  private spawnTimer = VEHICLE_SPAWN_INTERVAL_SEC

  private spawnVehicle(layout: CityLayout, catalog: CityBuildingCatalog, vehicleDefs: CityVehicleDef[]) {
    if (vehicleDefs.length === 0) return
    if (this.vehicles.length >= VEHICLE_MAX_COUNT) return

    const spawnPoints = getSpawnPoints(layout, catalog)
    if (spawnPoints.length === 0) return

    const shuffled = shuffle(spawnPoints)

    for (const sp of shuffled) {
      // Avoid spawning too close to existing vehicles
      let tooClose = false
      for (const v of this.vehicles) {
        const dx = v.x - sp.spawnX
        const dy = v.y - sp.spawnY
        if (Math.sqrt(dx * dx + dy * dy) < TILE_SIZE * 1.5) { tooClose = true; break }
      }
      if (tooClose) continue

      const def = vehicleDefs[Math.floor(Math.random() * vehicleDefs.length)]
      const speed = def.speedMin + Math.random() * (def.speedMax - def.speedMin)

      this.vehicles.push({
        id: `v-${vehicleIdCounter++}`,
        defId: def.id,
        x: sp.spawnX,
        y: sp.spawnY,
        direction: sp.direction,
        speed,
        lastTurnCol: sp.col,
        lastTurnRow: sp.row,
        inIntersection: false,
      })
      return
    }
  }

  update(dt: number, layout: CityLayout, catalog: CityBuildingCatalog, vehicleDefs: CityVehicleDef[]) {
    // Spawning
    this.spawnTimer += dt
    if (this.spawnTimer >= VEHICLE_SPAWN_INTERVAL_SEC) {
      this.spawnTimer -= VEHICLE_SPAWN_INTERVAL_SEC
      this.spawnVehicle(layout, catalog, vehicleDefs)
    }

    const toRemove: string[] = []

    for (const v of this.vehicles) {
      // ── Forward movement ─────────────────────────────
      const movePx = v.speed * TILE_SIZE * dt
      switch (v.direction) {
        case 'up':    v.y -= movePx; break
        case 'down':  v.y += movePx; break
        case 'left':  v.x -= movePx; break
        case 'right': v.x += movePx; break
      }

      const col = Math.floor(v.x / TILE_SIZE)
      const row = Math.floor(v.y / TILE_SIZE)

      // Despawn if off-road
      if (!isRoadTile(col, row, layout)) {
        toRemove.push(v.id)
        continue
      }

      const info = getRoadInfo(col, row, layout)

      // ── Intersection logic ───────────────────────────
      if (info.orientation === 'intersection') {
        if (!v.inIntersection) {
          // Just entered — decide whether to turn
          v.inIntersection = true
          if (Math.random() < TURN_CHANCE) {
            const perpDirs: VehicleDirection[] =
              (v.direction === 'up' || v.direction === 'down')
                ? ['left', 'right']
                : ['up', 'down']
            v.pendingTurn = perpDirs[Math.floor(Math.random() * perpDirs.length)]
          } else {
            v.pendingTurn = undefined
          }
        }

        // Execute pending turn when vehicle reaches the correct lane row/col
        if (v.pendingTurn) {
          const pd = v.pendingTurn

          if (pd === 'left' || pd === 'right') {
            // Need to be in the correct row half of the horizontal road
            const h = info.hRoadVMax - info.hRoadVMin + 1
            const half = Math.floor(h / 2)
            if (pd === 'left' && row < info.hRoadVMin + half) {
              // Top half reached → turn left
              v.direction = 'left'
              v.pendingTurn = undefined
            } else if (pd === 'right' && row >= info.hRoadVMin + half) {
              // Bottom half reached → turn right
              v.direction = 'right'
              v.pendingTurn = undefined
            }
          } else {
            // Need to be in the correct col half of the vertical road
            const w = info.vRoadHMax - info.vRoadHMin + 1
            const half = Math.floor(w / 2)
            if (pd === 'up' && col >= info.vRoadHMin + half) {
              // Right half reached → turn up
              v.direction = 'up'
              v.pendingTurn = undefined
            } else if (pd === 'down' && col < info.vRoadHMin + half) {
              // Left half reached → turn down
              v.direction = 'down'
              v.pendingTurn = undefined
            }
          }
        }

        // Lane drift within intersection
        applyLaneDrift(v, info, dt)

      } else {
        // ── Regular road ─────────────────────────────────
        if (v.inIntersection) {
          v.inIntersection = false
          v.pendingTurn = undefined
        }

        // Validate direction matches road orientation — despawn if wrong
        if (info.orientation === 'vertical' && (v.direction === 'left' || v.direction === 'right')) {
          toRemove.push(v.id)
          continue
        }
        if (info.orientation === 'horizontal' && (v.direction === 'up' || v.direction === 'down')) {
          toRemove.push(v.id)
          continue
        }

        applyLaneDrift(v, info, dt)
      }
    }

    // Remove despawned vehicles
    if (toRemove.length > 0) {
      const removeSet = new Set(toRemove)
      this.vehicles = this.vehicles.filter(v => !removeSet.has(v.id))
    }
  }

  reset() {
    this.vehicles = []
    this.spawnTimer = VEHICLE_SPAWN_INTERVAL_SEC
    vehicleIdCounter = 0
  }
}

// ── Lane drift ─────────────────────────────────────────────
//
// Gradually corrects the vehicle's lateral position to the lane center.

function applyLaneDrift(v: VehicleInstance, info: RoadInfo, dt: number) {
  const driftPx = LANE_DRIFT_SPEED * TILE_SIZE * dt

  if (v.direction === 'up' || v.direction === 'down') {
    // Correct X toward lane center
    if (info.vRoadHMin === info.vRoadHMax) return
    const target = targetLaneX(v.direction, info.vRoadHMin, info.vRoadHMax)
    const diff = target - v.x
    if (Math.abs(diff) <= LANE_SNAP_PX) {
      v.x = target
    } else {
      v.x += Math.max(-driftPx, Math.min(driftPx, diff))
    }
  } else {
    // Correct Y toward lane center
    if (info.hRoadVMin === info.hRoadVMax) return
    const target = targetLaneY(v.direction, info.hRoadVMin, info.hRoadVMax)
    const diff = target - v.y
    if (Math.abs(diff) <= LANE_SNAP_PX) {
      v.y = target
    } else {
      v.y += Math.max(-driftPx, Math.min(driftPx, diff))
    }
  }
}
