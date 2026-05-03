/**
 * Shared types for the MCP Bridge command handlers.
 */
import type { OfficeState } from '@pixel-city/shared/office/engine/officeState'

export interface McpCommand {
  type: 'mcp-command'
  requestId: number
  action: string
  params: Record<string, unknown>
}

export type AddAgentCallback = (
  agentId: string,
  palette: number,
  name: string,
  model: string,
  buildingId: string | null,
  initialMessage?: string,
) => void

export type RemoveAgentCallback = (agentId: string) => void

export type ListAgentsCallback = () => Array<{
  id: string
  name: string
  palette: number
  model: string
  active: boolean
}>

export type StatusCallback = (agentId: string, status: string | null) => void

export type WorkerStatusCallback = (agentId: string, status: 'idle' | 'working' | 'tool') => void

export type WsFrameCallback = (direction: 'rx' | 'tx', summary: string) => void

export interface AgentCallbacks {
  addAgent: AddAgentCallback | null
  removeAgent: RemoveAgentCallback | null
  listAgents: ListAgentsCallback | null
  onStatus: StatusCallback | null
  onWorkerStatus: WorkerStatusCallback | null
}

export interface BridgeState {
  activeOfficeState: OfficeState | null
  agentCallbacks: AgentCallbacks
  emitOfficeEvent: (event: string, data?: Record<string, unknown>) => void
}
