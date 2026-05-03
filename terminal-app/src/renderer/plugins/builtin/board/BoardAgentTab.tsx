// ── Board Plugin — Agent Tab (injection point 3) ─────────────────────
// Agent-scoped task panel showing the selected agent's assigned tasks.

import React, { useMemo } from 'react'
import { AgentTaskPanel } from '../../../board/SubtaskPanel.js'
import { getPermanentIdForAgent } from '../../../OfficeApp.js'
import { useCityContext } from '../../../contexts/CityContext.js'
import { useWorldContext } from '../../../contexts/WorldContext.js'
import type { AgentTabProps } from '../../types.js'

export function BoardAgentTab({ host, agentId, visible }: AgentTabProps) {
  const { projectCwd } = useWorldContext()
  const { currentBuildingId } = useCityContext()

  const selectedAgentKey = agentId ? `agent:${agentId}` : null
  const selectedAgentName = agentId ? (host.agentNames.get(agentId) ?? null) : null
  const selectedEmployeeKey = useMemo(() => {
    if (!agentId) return null
    const pid = getPermanentIdForAgent(agentId)
    return pid ? `emp:${pid}` : null
  }, [agentId])

  return (
    <AgentTaskPanel
      projectCwd={projectCwd}
      buildingId={currentBuildingId}
      selectedAgentKey={selectedAgentKey}
      selectedAgentName={selectedAgentName}
      selectedEmployeeKey={selectedEmployeeKey}
    />
  )
}
