export {
  TILE_SIZE,
  MAX_COLS,
  MAX_ROWS,
} from '../../constants.js'

// ── Terrain tile types ──────────────────────────────────────
export const CityTileType = {
  // Original values (0-6) kept for backward compatibility
  VOID: 0,
  GRASS_1: 1,
  GRASS_2: 2,
  ROAD: 3,
  WATER: 4,
  DIRT: 5,
  SAND: 6,
  // Nature (10-19)
  GRASS_3: 10,
  FLOWERS: 11,
  FOREST_FLOOR: 12,
  // Water (20-29)
  DEEP_WATER: 20,
  SHALLOW_WATER: 21,
  SWAMP: 22,
  // Roads (30-39)
  SIDEWALK: 30,
  CROSSWALK: 31,
  COBBLESTONE: 32,
  HIGHWAY: 33,
  // Ground (40-49)
  GRAVEL: 40,
  MUD: 41,
  CLAY: 42,
  ROCK: 43,
  // Special (50-59)
  SNOW: 50,
  ICE: 51,
  LAVA: 52,
} as const
export type CityTileType = (typeof CityTileType)[keyof typeof CityTileType]

// ── Terrain categories ─────────────────────────────────────
export interface TerrainCategory {
  id: string
  label: string
  types: { type: CityTileType; label: string }[]
}

export const TERRAIN_CATEGORIES: TerrainCategory[] = [
  {
    id: 'nature',
    label: 'Nature',
    types: [
      { type: CityTileType.GRASS_1, label: 'Grass' },
      { type: CityTileType.GRASS_2, label: 'Grass Alt' },
      { type: CityTileType.GRASS_3, label: 'Tall Grass' },
      { type: CityTileType.FLOWERS, label: 'Flowers' },
      { type: CityTileType.FOREST_FLOOR, label: 'Forest' },
    ],
  },
  {
    id: 'water',
    label: 'Water',
    types: [
      { type: CityTileType.SHALLOW_WATER, label: 'Shallow' },
      { type: CityTileType.WATER, label: 'Water' },
      { type: CityTileType.DEEP_WATER, label: 'Deep' },
      { type: CityTileType.SWAMP, label: 'Swamp' },
    ],
  },
  {
    id: 'roads',
    label: 'Roads',
    types: [
      { type: CityTileType.ROAD, label: 'Road' },
      { type: CityTileType.SIDEWALK, label: 'Sidewalk' },
      { type: CityTileType.CROSSWALK, label: 'Crosswalk' },
      { type: CityTileType.COBBLESTONE, label: 'Cobblestone' },
      { type: CityTileType.HIGHWAY, label: 'Highway' },
    ],
  },
  {
    id: 'ground',
    label: 'Ground',
    types: [
      { type: CityTileType.DIRT, label: 'Dirt' },
      { type: CityTileType.SAND, label: 'Sand' },
      { type: CityTileType.GRAVEL, label: 'Gravel' },
      { type: CityTileType.MUD, label: 'Mud' },
      { type: CityTileType.CLAY, label: 'Clay' },
      { type: CityTileType.ROCK, label: 'Rock' },
    ],
  },
  {
    id: 'special',
    label: 'Special',
    types: [
      { type: CityTileType.VOID, label: 'Void' },
      { type: CityTileType.SNOW, label: 'Snow' },
      { type: CityTileType.ICE, label: 'Ice' },
      { type: CityTileType.LAVA, label: 'Lava' },
    ],
  },
]

// ── Editor tool ─────────────────────────────────────────────
export const CityEditTool = {
  SELECT: 'select',
  TERRAIN_PAINT: 'terrain_paint',
  BUILDING_PLACE: 'building_place',
  VEHICLE_PLACE: 'vehicle_place',
  ERASE: 'erase',
} as const
export type CityEditTool = (typeof CityEditTool)[keyof typeof CityEditTool]

// ── A building placed on the city map ───────────────────────
export interface PlacedBuilding {
  uid: string
  buildingDefId: string
  col: number
  row: number
  title?: string
  description?: string
  /** Human-friendly handle like "myproject" — unique per user. Required for new buildings. */
  handle?: string
  workingDir?: string // resolved from local machine mapping (not stored in RTDB)
}

// ── A building type in the catalog (importable asset) ───────
export interface CityBuildingDef {
  id: string
  name: string
  type: string // shop, office, apartment, etc.
  file: string // relative path to PNG
  footprintW: number // width in tiles
  footprintH: number // height in tiles
  pixelW: number // actual PNG pixel width
  pixelH: number // actual PNG pixel height
  layout?: string // office layout file (for entering the building)
  category?: string // category path e.g. "vehicles" or "terrain/water"
  downloadUrl?: string // optional remote URL for the asset image
}

// ── The full city layout (persisted as JSON) ────────────────
export interface CityLayout {
  version: 1
  cols: number
  rows: number
  tiles: CityTileType[]
  buildings: PlacedBuilding[]
}

// ── Vehicle definition (importable asset) ───────────────────
export type VehicleDirection = 'up' | 'down' | 'left' | 'right'

export interface CityVehicleDef {
  id: string
  name: string
  files: Record<VehicleDirection, string> // relative paths to PNGs
  pixelW: number
  pixelH: number
  // Tile size for left/right sprites
  tileLrW: number
  tileLrH: number
  // Tile size for up/down sprites
  tileUdW: number
  tileUdH: number
  speedMin: number // tiles per second
  speedMax: number // tiles per second
  mirrorLR?: boolean // if true, left sprite is mirrored for right (only left file needed)
  category?: string
  downloadUrls?: Record<VehicleDirection, string> // optional remote URLs per direction
}

// ── Catalog of available building assets ────────────────────
export interface CityAssetCategory {
  id: string
  name: string
  parentId?: string // for nested categories e.g. "terrain/water"
}

export interface CityBuildingCatalog {
  buildings: CityBuildingDef[]
  vehicles?: CityVehicleDef[]
  categories?: CityAssetCategory[]
}
