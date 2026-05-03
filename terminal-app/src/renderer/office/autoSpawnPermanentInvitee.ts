import { officeRegistry } from './officeRegistry.js'

export type AddAgentFn = (
  agentId: string,
  palette: number,
  name: string,
  model: string,
  buildingId: string | null,
  initialMessage?: string,
  permanentId?: string,
) => void

export interface AutoSpawnDeps {
  addAgent: AddAgentFn
}

export function autoSpawnPermanentInvitee(
  permId: string,
  buildingId: string,
  deps: AutoSpawnDeps,
  initialMessage?: string,
): string | null {
  const snap = officeRegistry.getBuilding(buildingId)
  const empData = snap?.permanentEmployees.get(permId)
  if (!empData) return null

  // Permanents use their stable id as the runtime agentId. If the agent is
  // already live on canvas, addAgent only fires when there's a message to
  // queue (pendingPromptsRef picks it up at terminal init time).
  const agentId = permId
  const alreadyLive = !!officeRegistry.getBuildingForAgent(agentId)
  if (alreadyLive && !initialMessage) return agentId

  deps.addAgent(
    agentId,
    empData.settings.palette ?? 0,
    empData.settings.name,
    empData.settings.model ?? 'sonnet',
    empData.settings.officeId ?? null,
    initialMessage,
    permId,
  )
  return agentId
}
