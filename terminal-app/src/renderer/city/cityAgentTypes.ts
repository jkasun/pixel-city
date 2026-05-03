export interface CityAgent {
  slot: 1 | 2 | 3
  /** null = no character picked */
  palette: number | null
  /** null = not assigned to any building */
  buildingId: string | null
}

export const AGENT_SLOT_COLORS: Record<1 | 2 | 3, string> = {
  1: '#5ac8fa',  // cyan
  2: '#ff6ec7',  // pink
  3: '#ffaa44',  // orange
}

export const AGENT_NAMES: Record<1 | 2 | 3, string> = {
  1: 'Alpha',
  2: 'Beta',
  3: 'Gamma',
}

export type CityViewMode = 'editor'
