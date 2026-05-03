import React, { useRef, useMemo, useEffect } from 'react'
import type { QuickMenuItem } from '../QuickMenu.js'
import { getAgentIdForPermanent } from '../OfficeApp.js'
import { AgentIcon } from '../AgentIcon.js'
import { generateAgentId } from '@pixel-city/shared/utils/agentId'
import type { ShellTerminalData } from '../appTypes.js'
import { getFileIconData } from '../files/fileTypes.js'
import { TerminalPromptIcon, PlusIcon, SettingsDotIcon, CityIcon, FileSmallIcon } from '../icons/index.js'
import { useProjectFiles, type UseProjectFilesReturn } from './useProjectFiles.js'

import { platform } from '../platform/index.js'
const pathModule = window.require('path') as typeof import('path')


interface UseQuickMenuItemsArgs {
  agentIds: string[]
  agentPermanentIdMap: Map<string, string>
  agentTerminalsRef: React.RefObject<Map<string, any>>
  agentStatusMap: Map<string, string>
  agentPalettes: Map<string, number>
  agentNames: Map<string, string>
  agentBuildingMap: Map<string, string>
  permanentEmployees: Array<{ id: string; settings: { name: string; palette?: number; model?: string; officeId?: string | null } }>
  currentRoute: 'city' | 'building'
  currentBuildingId: string | null
  shellIds: number[]
  shellBuildingMap: Map<number, string>
  shellTerminalsRef: React.RefObject<Map<number, ShellTerminalData>>
  shellNames: Record<number, string>
  projectCwd: string | null
  setActiveAgentId: (id: string) => void
  setActiveView: (view: 'agent' | 'shell') => void
  setActiveShellId: (id: number) => void
  handleAddAgent: (agentId: string, palette: number, name: string, model: string, buildingId: string | null, initialMessage?: string, permanentId?: string) => void
  addShellTerminal: () => void
  quickMenuOpen: boolean
}

export function useQuickMenuItems({
  agentIds, agentPermanentIdMap, agentTerminalsRef, agentStatusMap,
  agentPalettes, agentNames, agentBuildingMap, permanentEmployees,
  currentRoute, currentBuildingId,
  shellIds, shellBuildingMap, shellTerminalsRef, shellNames, projectCwd,
  setActiveAgentId, setActiveView, setActiveShellId,
  handleAddAgent, addShellTerminal, quickMenuOpen,
}: UseQuickMenuItemsArgs) {
  // Stable ref for callbacks — prevents useMemo from re-running on callback identity changes
  const cbRef = useRef({ setActiveAgentId, setActiveView, setActiveShellId, handleAddAgent, addShellTerminal })
  cbRef.current = { setActiveAgentId, setActiveView, setActiveShellId, handleAddAgent, addShellTerminal }

  // Shared project file index (also used by @-mention in ChatView)
  const projectFiles = useProjectFiles(projectCwd)
  const { filePaths, searchPhase, nestedRepoName } = projectFiles

  // Trigger file loading when quick menu opens
  useEffect(() => {
    if (quickMenuOpen) projectFiles.ensureLoaded()
  }, [quickMenuOpen])

  // Build items with useMemo — only recomputes when actual data changes
  const items = useMemo((): QuickMenuItem[] => {
    const result: QuickMenuItem[] = []
    const cb = cbRef.current

    const activePermIds = new Set<string>()
    const permIdToAgentId = new Map<string, string>()
    for (const [aid, pid] of agentPermanentIdMap.entries()) {
      if (agentTerminalsRef.current.has(aid)) {
        activePermIds.add(pid)
        permIdToAgentId.set(pid, aid)
      }
    }

    const inBuilding = currentRoute === 'building' && currentBuildingId !== null

    for (const emp of permanentEmployees) {
      const empOfficeId = emp.settings.officeId ?? null
      if (inBuilding && empOfficeId !== currentBuildingId) continue

      const hasSession = activePermIds.has(emp.id)
      const existingAgentId = permIdToAgentId.get(emp.id)
      const status = existingAgentId != null ? agentStatusMap.get(existingAgentId) : undefined

      result.push({
        id: `emp-${emp.id}`,
        label: emp.settings.name,
        description: hasSession ? (status ?? 'session open') : 'no session',
        category: 'agent',
        icon: <AgentIcon palette={emp.settings.palette ?? 0} />,
        onSelect: () => {
          if (hasSession && existingAgentId != null) {
            cb.setActiveAgentId(existingAgentId)
            cb.setActiveView('agent')
          } else {
            const officeAgentId = getAgentIdForPermanent(emp.id)
            const agentId = officeAgentId ?? generateAgentId()
            cb.handleAddAgent(agentId, emp.settings.palette ?? 0, emp.settings.name, emp.settings.model ?? 'claude-sonnet-4-20250514', null, undefined, emp.id)
          }
        },
      })
    }

    for (const id of agentIds) {
      if (agentPermanentIdMap.has(id)) continue
      const agentBuilding = agentBuildingMap.get(id) ?? null
      if (inBuilding && agentBuilding !== currentBuildingId) continue
      if (!inBuilding && agentBuilding !== null) continue

      const name = agentNames.get(id) ?? `Agent ${id}`
      const status = agentStatusMap.get(id)
      result.push({
        id: `agent-${id}`,
        label: name,
        description: status ?? 'idle',
        category: 'agent',
        icon: <AgentIcon palette={agentPalettes.get(id) ?? 0} />,
        onSelect: () => { cb.setActiveAgentId(id); cb.setActiveView('agent') },
      })
    }

    for (const id of shellIds) {
      const shellBuilding = shellBuildingMap.get(id) ?? null
      if (inBuilding && shellBuilding !== currentBuildingId) continue
      if (!inBuilding && shellBuilding !== null) continue

      result.push({
        id: `shell-${id}`,
        label: shellNames[id] ?? `Terminal ${id + 1}`,
        category: 'shell',
        icon: <TerminalPromptIcon />,
        onSelect: () => { cb.setActiveShellId(id); cb.setActiveView('shell') },
      })
    }

    result.push({
      id: 'action-new-terminal',
      label: 'New Terminal',
      category: 'action',
      icon: <PlusIcon />,
      onSelect: () => cb.addShellTerminal(),
    })

    result.push({
      id: 'action-settings',
      label: 'Open Settings',
      category: 'action',
      icon: <SettingsDotIcon />,
      onSelect: () => platform().app.openSettings(),
    })

    if (currentRoute === 'building') {
      result.push({
        id: 'nav-city',
        label: 'Go to City View',
        category: 'action',
        icon: <CityIcon />,
        onSelect: () => { window.location.hash = '#city' },
      })
    }

    if (projectCwd) {
      for (const filePath of filePaths) {
        const name = pathModule.basename(filePath)
        const ext = name.split('.').pop()?.toLowerCase() ?? ''
        const rel = pathModule.relative(projectCwd, filePath)
        const iconData = getFileIconData(ext, name.toLowerCase())
        result.push({
          id: `file-${filePath}`,
          label: name,
          description: rel,
          category: 'file',
          icon: (
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 16, height: 16, borderRadius: 2,
              fontSize: 8, fontWeight: 700, color: iconData.color,
            }}>
              {iconData.letter || <FileSmallIcon />}
            </span>
          ),
          onSelect: () => {
            window.dispatchEvent(new CustomEvent('pixelcity:open-file', { detail: { filePath } }))
          },
        })
      }
    }

    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    agentIds, agentPermanentIdMap, agentStatusMap, agentPalettes, agentNames,
    agentBuildingMap, permanentEmployees, currentRoute, currentBuildingId,
    shellIds, shellBuildingMap, shellNames, projectCwd, filePaths,
  ])

  return { items, searchPhase, nestedRepoName, projectFiles }
}
