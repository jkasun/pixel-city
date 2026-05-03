import { OfficeState } from '@pixel-city/shared/office/engine/officeState'
import { registerOfficeState, unregisterOfficeState } from '../mcpBridge.js'
import { generateAgentId } from '@pixel-city/shared/utils/agentId'
import { officeRegistry } from './officeRegistry.js'

export { generateAgentId }
export { officeRegistry }
export type { IOfficeRegistry, AgentRegistration, BuildingSnapshot } from './officeRegistry.js'

export const officeStateRef = { current: null as OfficeState | null }

// Remember last active floor per building so it survives remounts
export const lastActiveFloorMap = new Map<string, string>()

/** Look up the permanent employee ID for a given agent ID, or null if not permanent. */
export function getPermanentIdForAgent(agentId: string): string | null {
  return officeRegistry.getPermanentIdForAgent(agentId)
}

/** Look up the agent ID for a permanent employee, or null if not spawned in the office. */
export function getAgentIdForPermanent(permanentId: string): string | null {
  const buildingId = officeRegistry.getActiveBuilding()
  if (!buildingId) return null
  return officeRegistry.getAgentIdForPermanent(permanentId, buildingId)
}

export function setOfficeState(state: OfficeState) {
  if (officeStateRef.current) unregisterOfficeState(officeStateRef.current)
  officeStateRef.current = state
  registerOfficeState(state)
  // Expose for test MCP server access
  ;(window as any).__pixelCityOfficeState = state
}

export function getOfficeState(): OfficeState {
  if (!officeStateRef.current) {
    setOfficeState(new OfficeState())
  }
  return officeStateRef.current!
}
