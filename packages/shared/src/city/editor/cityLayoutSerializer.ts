import type { CityLayout } from './cityLayoutTypes.js'
import { CityTileType } from './cityLayoutTypes.js'
import seed from './defaultCityLayout.json' with { type: 'json' }

export function createDefaultCityLayout(): CityLayout {
  return JSON.parse(JSON.stringify(seed)) as CityLayout
}

export function serializeCityLayout(layout: CityLayout): string {
  return JSON.stringify(layout, null, 2)
}

export function deserializeCityLayout(json: string): CityLayout {
  const data = JSON.parse(json) as CityLayout
  if (!data.version) data.version = 1
  if (!data.buildings) data.buildings = []
  if (!data.tiles) data.tiles = new Array(data.cols * data.rows).fill(CityTileType.GRASS_1)
  return data
}
