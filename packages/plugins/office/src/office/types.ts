import type { OfficeLayout } from '@pixel-city/shared/office/types'

/**
 * OfficeStore — dependency-injection interface for office layout persistence.
 *
 * Consuming apps provide their own implementation (e.g. local SQLite via IPC).
 */
export interface OfficeStore {
  /** Load layout for a building + floor. Returns null if not found. */
  loadLayout(buildingId: string, floorId?: string): Promise<OfficeLayout | null>
}

/**
 * Agent info passed to the shared OfficeView component.
 * Abstracted from both RemoteAgent (web) and local agent state (terminal).
 */
export interface OfficeAgent {
  agentId: string
  name?: string
  model?: string
  active: boolean
  status?: string | null
}

export interface FloorEntry {
  id: string
  name: string
}
