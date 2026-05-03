import { useEffect } from 'react'
import {
  registerAgentCallbacks,
  registerMcpDebugCallback,
  registerSendPtyInputCallback,
  registerGetAgentLastOutputAt,
} from '../mcpBridge.js'
import { officeRegistry } from '../office/officeStateRefs.js'
import { platform } from '../platform/index.js'
import type { AgentTerminalData } from '../appTypes.js'
import type { DebugEventKind } from '../DebugPanel.js'

interface McpBridgeDeps {
  handleAddAgent: (agentId: string, palette: number, name: string, model: string, buildingId: string | null, initialMessage?: string, permanentId?: string) => void
  removeAgent: (agentId: string) => void
  agentIds: string[]
  agentNames: Map<string, string>
  agentPalettes: Map<string, number>
  agentModels: Map<string, string>
  agentBuildingMap: Map<string, string>
  agentTerminalsRef: React.RefObject<Map<string, AgentTerminalData>>
  statusCallbackRef: React.RefObject<(id: string, status: string | null) => void>
  setAgentWorkerStatusMap: React.Dispatch<React.SetStateAction<Map<string, 'idle' | 'working' | 'tool'>>>
  debugCallbackRef: React.RefObject<(agentId: string | number, kind: DebugEventKind, label: string) => void>
}

export function useMcpBridge({
  handleAddAgent,
  removeAgent,
  agentIds,
  agentNames,
  agentPalettes,
  agentModels,
  agentBuildingMap,
  agentTerminalsRef,
  statusCallbackRef,
  setAgentWorkerStatusMap,
  debugCallbackRef,
}: McpBridgeDeps) {
  useEffect(() => {
    registerAgentCallbacks({
      addAgent: handleAddAgent,
      removeAgent,
      listAgents: () => {
        const activeBuildingId = officeRegistry.getActiveBuilding()
        const activeList = Array.from(agentNames.entries())
          .filter(([id]) => !activeBuildingId || agentBuildingMap.get(id) === activeBuildingId)
          .map(([id, name]) => ({
            id,
            name,
            palette: agentPalettes.get(id) ?? 0,
            model: agentModels.get(id) ?? 'sonnet',
            active: agentIds.includes(id),
          }))
        const activeIdSet = new Set(activeList.map(a => a.id))
        if (activeBuildingId) {
          const snap = officeRegistry.getBuilding(activeBuildingId)
          if (snap) {
            for (const [permId, empData] of snap.permanentEmployees) {
              // Permanents use permId as their runtime agentId.
              if (activeIdSet.has(permId)) continue
              activeList.push({
                id: permId,
                name: empData.settings.name,
                palette: empData.settings.palette ?? 0,
                model: empData.settings.model ?? 'sonnet',
                active: false,
              })
            }
          }
        }
        return activeList
      },
      onStatus: (agentId, status) => {
        statusCallbackRef.current(agentId, status)
      },
      onWorkerStatus: (agentId, status) => {
        setAgentWorkerStatusMap(prev => {
          const next = new Map(prev)
          next.set(agentId, status)
          return next
        })
      },
    })
    registerMcpDebugCallback((agentId, kind, label) => {
      debugCallbackRef.current(agentId, kind, label)
    })
    registerSendPtyInputCallback((agentId: string, data: string) => {
      const agent = agentTerminalsRef.current.get(agentId)
      if (!agent) return { success: false, error: `No terminal session found for agent ${agentId}` }
      if (agent.exited) return { success: false, error: `Agent ${agentId} process has exited` }
      if (agent.session) {
        if (!agent.session.isAlive()) return { success: false, error: `Agent ${agentId} session is not alive` }
        // PTY-backed sessions (Claude Code CLI, Codex CLI) need
        // raw bytes — the bracketed-paste markers and submit \r are required
        // for the TUI to accept and submit the input. Only API-only sessions
        // (no PTY) get the strip-and-forward-as-text treatment.
        if (agent.session.capabilities.hasTerminal) {
          agent.session.sendInput(data)
        } else {
          const text = data.replace(/\x1b\[200~/g, '').replace(/\x1b\[201~/g, '').replace(/\r/g, '').trim()
          if (text) agent.session.sendInput(text)
        }
      } else {
        platform().pty.input(agent.ptyId, data)
      }
      return { success: true }
    })
    registerGetAgentLastOutputAt((agentId: string) => {
      const agent = agentTerminalsRef.current.get(agentId)
      return agent?.lastOutputAt
    })
  }, [handleAddAgent, removeAgent, agentNames, agentPalettes, agentModels, agentIds])
}
