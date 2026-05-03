/**
 * Agent-related sync command handlers for the MCP Bridge.
 */
import type { BridgeState } from './types.js'

export function executeAgentAction(
  action: string,
  params: Record<string, unknown>,
  state: BridgeState,
): unknown {
  const { activeOfficeState, agentCallbacks, emitOfficeEvent } = state

  switch (action) {
    case 'spawn_agent': {
      if (!agentCallbacks.addAgent) throw new Error('Agent system not initialized')
      const id = (params.id as string) ?? String(Date.now())
      const palette = (params.palette as number) ?? undefined
      const name = (params.name as string) ?? 'MCP Agent'
      const model = (params.model as string) ?? 'sonnet'
      const buildingId = (params.buildingId as string) ?? null
      const prompt = (params.prompt as string) ?? undefined
      agentCallbacks.addAgent(id, palette ?? 0, name, model, buildingId, prompt)
      emitOfficeEvent('agent_spawned', { agentId: id, name, model, palette: palette ?? 0, buildingId })
      return { success: true, agentId: id }
    }

    case 'remove_agent': {
      if (!agentCallbacks.removeAgent) throw new Error('Agent system not initialized')
      const id = params.id as string
      if (id === undefined) throw new Error('Missing agent id')
      console.log(`[PixelCity] MCP remove_agent called for id=${id}`)
      agentCallbacks.removeAgent(id)
      emitOfficeEvent('agent_removed', { agentId: id })
      return { success: true }
    }

    case 'set_agent_working': {
      const id = params.id as string
      if (id === undefined) throw new Error('Missing agent id')
      if (activeOfficeState) {
        activeOfficeState.setAgentActive(id, true)
        activeOfficeState.setWorkerStatus(id, 'working')
      }
      agentCallbacks.onWorkerStatus?.(id, 'working')
      emitOfficeEvent('agent_working', { agentId: id })
      return { success: true }
    }

    case 'set_agent_idle': {
      const id = params.id as string
      if (id === undefined) throw new Error('Missing agent id')
      if (activeOfficeState) {
        activeOfficeState.setAgentActive(id, false)
        activeOfficeState.setWorkerStatus(id, 'idle')
        activeOfficeState.setAgentStatusText(id, null)
        activeOfficeState.showWaitingBubble(id)
      }
      agentCallbacks.onWorkerStatus?.(id, 'idle')
      emitOfficeEvent('agent_idle', { agentId: id })
      return { success: true }
    }

    case 'show_current_status': {
      const id = params.id as string
      const text = params.text as string
      if (id === undefined) throw new Error('Missing agent id')
      if (!text) throw new Error('Missing status text')
      if (activeOfficeState) {
        activeOfficeState.setAgentStatusText(id, text)
      }
      agentCallbacks.onStatus?.(id, text)
      emitOfficeEvent('agent_status_changed', { agentId: id, text })
      return { success: true }
    }

    case 'list_agents': {
      if (agentCallbacks.listAgents) {
        return { agents: agentCallbacks.listAgents() }
      }
      if (!activeOfficeState) return { agents: [] }
      const chars = activeOfficeState.getCharacters()
      return {
        agents: chars.map(ch => ({
          id: ch.id,
          name: ch.name,
          palette: ch.palette,
          isActive: ch.isActive,
          isSubagent: ch.isSubagent,
          currentTool: ch.currentTool,
          tileCol: ch.tileCol,
          tileRow: ch.tileRow,
        })),
      }
    }

    default:
      return undefined
  }
}

/** All action names handled by this module (sync). */
export const AGENT_ACTIONS = new Set([
  'spawn_agent', 'remove_agent', 'set_agent_working', 'set_agent_idle',
  'show_current_status', 'list_agents',
])
