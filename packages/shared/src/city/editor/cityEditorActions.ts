import { CityTileType, MAX_COLS, MAX_ROWS } from './cityLayoutTypes.js'
import type { CityTileType as CityTileTypeVal, CityLayout, PlacedBuilding, CityBuildingCatalog, CityBuildingDef } from './cityLayoutTypes.js'

function ensureArray<T>(val: T[] | null | undefined): T[] {
  return Array.isArray(val) ? val : []
}

/** Paint a single terrain tile. Returns new layout (immutable). */
export function paintTerrain(layout: CityLayout, col: number, row: number, tileType: CityTileTypeVal): CityLayout {
  const idx = row * layout.cols + col
  if (idx < 0 || idx >= layout.tiles.length) return layout
  if (col < 0 || col >= layout.cols || row < 0 || row >= layout.rows) return layout
  if (layout.tiles[idx] === tileType) return layout

  const tiles = [...layout.tiles]
  tiles[idx] = tileType
  return { ...layout, tiles }
}

/** Place a building. Returns new layout (immutable). */
export function placeBuilding(layout: CityLayout, uid: string, buildingDefId: string, col: number, row: number, title?: string, description?: string, workingDir?: string, handle?: string): CityLayout {
  const building: PlacedBuilding = {
    uid,
    buildingDefId,
    col,
    row,
    title,
    description,
    ...(handle ? { handle } : {}),
    ...(workingDir ? { workingDir } : {}),
  }
  const buildings = ensureArray(layout.buildings)
  return { ...layout, buildings: [...buildings, building] }
}

/** Remove a building by uid. Returns new layout (immutable). */
export function removeBuilding(layout: CityLayout, uid: string): CityLayout {
  const buildings = ensureArray(layout.buildings)
  const filtered = buildings.filter((b) => b.uid !== uid)
  if (filtered.length === buildings.length) return layout
  return { ...layout, buildings: filtered }
}

/** Move a building to a new position. Returns new layout (immutable). */
export function moveBuilding(layout: CityLayout, uid: string, newCol: number, newRow: number): CityLayout {
  const buildings = ensureArray(layout.buildings)
  const item = buildings.find((b) => b.uid === uid)
  if (!item) return layout
  return {
    ...layout,
    buildings: buildings.map((b) => (b.uid === uid ? { ...b, col: newCol, row: newRow } : b)),
  }
}

/** Environment asset types that can overlap with other buildings. */
const ENV_TYPES = new Set(['decoration', 'nature', 'infrastructure'])

/** Check whether a building def represents an environment/decoration asset. */
export function isEnvironmentAsset(def: CityBuildingDef): boolean {
  return def.id.startsWith('ai_env_') || ENV_TYPES.has(def.type)
}

/** Check if a building can be placed at (col, row) without overlapping others. */
export function canPlaceBuilding(
  layout: CityLayout,
  catalog: CityBuildingCatalog,
  defId: string,
  col: number,
  row: number,
  excludeUid?: string,
): boolean {
  const catalogBuildings = ensureArray(catalog.buildings)
  const def = catalogBuildings.find((b) => b.id === defId)
  if (!def) return false

  // Bounds check
  if (col < 0 || row < 0 || col + def.footprintW > layout.cols || row + def.footprintH > layout.rows) {
    return false
  }

  // Environment assets can overlap anything — skip collision check
  if (isEnvironmentAsset(def)) return true

  // Overlap check against other buildings
  const buildings = ensureArray(layout.buildings)
  for (const building of buildings) {
    if (building.uid === excludeUid) continue
    const otherDef = catalogBuildings.find((b) => b.id === building.buildingDefId)
    if (!otherDef) continue

    const overlapX = col < building.col + otherDef.footprintW && col + def.footprintW > building.col
    const overlapY = row < building.row + otherDef.footprintH && row + def.footprintH > building.row
    if (overlapX && overlapY) return false
  }

  return true
}

/** Find a building whose footprint covers the given tile. */
export function getBuildingAtTile(
  layout: CityLayout,
  catalog: CityBuildingCatalog,
  col: number,
  row: number,
): PlacedBuilding | null {
  // Search in reverse so top-rendered buildings are found first
  const buildings = ensureArray(layout.buildings)
  const catalogBuildings = ensureArray(catalog.buildings)
  for (let i = buildings.length - 1; i >= 0; i--) {
    const b = buildings[i]
    const def = catalogBuildings.find((d) => d.id === b.buildingDefId)
    if (!def) continue
    if (col >= b.col && col < b.col + def.footprintW && row >= b.row && row < b.row + def.footprintH) {
      return b
    }
  }
  return null
}

export type ExpandDirection = 'left' | 'right' | 'up' | 'down'

/** Expand layout by 1 tile in the given direction. Returns null if exceeding limits. */
export function expandLayout(
  layout: CityLayout,
  direction: ExpandDirection,
): { layout: CityLayout; shift: { col: number; row: number } } | null {
  const { cols, rows, tiles } = layout
  const buildings = ensureArray(layout.buildings)

  let newCols = cols
  let newRows = rows
  let shiftCol = 0
  let shiftRow = 0

  if (direction === 'right') newCols = cols + 1
  else if (direction === 'left') { newCols = cols + 1; shiftCol = 1 }
  else if (direction === 'down') newRows = rows + 1
  else if (direction === 'up') { newRows = rows + 1; shiftRow = 1 }

  if (newCols > MAX_COLS || newRows > MAX_ROWS) return null

  const newTiles: CityTileTypeVal[] = new Array(newCols * newRows).fill(CityTileType.VOID as CityTileTypeVal)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      newTiles[(r + shiftRow) * newCols + (c + shiftCol)] = tiles[r * cols + c]
    }
  }

  const newBuildings: PlacedBuilding[] = buildings.map((b) => ({
    ...b,
    col: b.col + shiftCol,
    row: b.row + shiftRow,
  }))

  return {
    layout: { ...layout, cols: newCols, rows: newRows, tiles: newTiles, buildings: newBuildings },
    shift: { col: shiftCol, row: shiftRow },
  }
}
