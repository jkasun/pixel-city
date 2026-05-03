import { useCallback } from 'react'
import { listEmployeesFromRtdb } from '../employee/employeeDbLocal.js'
import { normalizeModel } from '../llm/index.js'
import { useConfirm } from '../components/ConfirmDialog.js'
import type { AgentTerminalData } from '../appTypes.js'

interface AutoStartDeps {
  agentNamesRef: React.RefObject<Map<string, string>>
  agentPalettesRef: React.RefObject<Map<string, number>>
  agentModelsRef: React.RefObject<Map<string, string>>
  agentTerminalsRef: React.RefObject<Map<string, AgentTerminalData>>
  currentBuildingIdRef: React.RefObject<string | null>
  handleAddAgent: (agentId: string, palette: number, name: string, model: string, buildingId: string | null, initialMessage?: string, permanentId?: string) => void
}

interface ResolvedAgent {
  agentId: string
  agentName: string
  agentPalette: number
  agentModel: string
  permanentId?: string
}

export function useAutoStart({
  agentNamesRef,
  agentPalettesRef,
  agentModelsRef,
  agentTerminalsRef,
  currentBuildingIdRef,
  handleAddAgent,
}: AutoStartDeps) {
  const confirm = useConfirm()

  const resolveAgent = useCallback(async (assigneeKey: string): Promise<ResolvedAgent | null> => {
    if (assigneeKey.startsWith('emp:')) {
      const empId = assigneeKey.slice(4)
      const result = await listEmployeesFromRtdb()
      if (!result.success) return null
      const emp = result.employees.find((e: { id: string }) => e.id === empId)
      if (!emp) return null

      // Permanents use their stable id as the runtime agentId.
      return {
        agentId: empId,
        agentName: emp.settings.name,
        agentPalette: emp.settings.palette ?? 0,
        agentModel: normalizeModel(emp.settings.model ?? 'sonnet'),
        permanentId: empId,
      }
    }
    if (assigneeKey.startsWith('agent:')) {
      const agentId = assigneeKey.slice(6)
      return {
        agentId,
        agentName: agentNamesRef.current.get(agentId) ?? `Agent ${agentId}`,
        agentPalette: agentPalettesRef.current.get(agentId) ?? 0,
        agentModel: agentModelsRef.current.get(agentId) ?? 'sonnet',
      }
    }
    return null
  }, [])

  const handleAutoStartTask = useCallback(async (taskId: string, taskTitle: string, assigneeKey: string) => {
    const resolved = await resolveAgent(assigneeKey)
    if (!resolved) return
    const { agentId, agentName, agentPalette, agentModel, permanentId } = resolved

    if (agentTerminalsRef.current.has(agentId)) {
      void confirm({
        title: 'Agent already in a session',
        message: `${agentName} already has a live session. Task ${taskId} won't be started automatically — switch to that agent and pick it up manually.`,
        confirmLabel: 'OK',
        cancelLabel: 'Dismiss',
        danger: false,
      })
      return
    }

    const initialMessage = `Start now: ${taskId} — ${taskTitle}`
    handleAddAgent(agentId, agentPalette, agentName, agentModel, currentBuildingIdRef.current, initialMessage, permanentId)
  }, [resolveAgent, handleAddAgent, confirm])

  return { handleAutoStartTask }
}
