// ── Board Plugin — Main View (injection point 1) ─────────────────────
// Full kanban board view in PluginPanel.

import React, { useMemo } from 'react'
import { BoardView } from '../../../BoardView.js'
import { useCityContext } from '../../../contexts/CityContext.js'
import { useOfficeContext } from '../../../contexts/OfficeContext.js'
import type { PluginProps } from '../../types.js'

export function BoardPlugin({ host }: PluginProps) {
  const { currentBuildingId } = useCityContext()
  const { agentBuildingMap, handleSpawnTempAgent, handleAutoStartTask } = useOfficeContext()

  const spawnedAgents = useMemo(() => {
    return host.agentIds
      .filter(id => currentBuildingId ? agentBuildingMap.get(id) === currentBuildingId : !agentBuildingMap.has(id))
      .map(id => ({ id, name: host.agentNames.get(id) ?? `Agent ${id}`, palette: host.agentPalettes.get(id) ?? 0 }))
  }, [host.agentIds, host.agentNames, host.agentPalettes, currentBuildingId, agentBuildingMap])

  return (
    <BoardView
      projectCwd={host.projectCwd}
      buildingId={currentBuildingId}
      spawnedAgents={spawnedAgents}
      onSpawnTempAgent={handleSpawnTempAgent}
      onAutoStartTask={handleAutoStartTask}
    />
  )
}
