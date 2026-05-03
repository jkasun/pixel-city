/**
 * useAgentSync — L2 Hook
 *
 * Keeps the OfficeState canvas in sync with OfficeContext's agent maps:
 *   1. Removes characters for agents no longer in agentIds
 *   2. Adds characters for agents in existingAgents not yet on canvas
 *   3. Applies JSONL status (working/idle/tool) to non-MCP characters
 *   4. Applies MCP worker status to MCP-controlled characters
 *
 * Zero JSX. Pure side-effects against getOfficeState().
 */
import { useEffect } from 'react'
import { getOfficeState, officeRegistry, getPermanentIdForAgent } from '../office/officeStateRefs.js'
import { isAgentMcpControlled } from '../mcpBridge.js'
import type { ExistingAgentsData } from '../OfficeRouter.js'
import { computeStaleCharacterIds } from './agentSyncReconcile.js'

// Pre-compiled regexes for tool detection
const RE_READING = /^Reading/i
const RE_SEARCHING = /^Searching|^Fetching web|^Searching the web/i

function detectTool(status: string): 'Read' | 'Grep' | 'Write' {
  if (RE_READING.test(status)) return 'Read'
  if (RE_SEARCHING.test(status)) return 'Grep'
  return 'Write'
}

export interface UseAgentSyncOptions {
  ready: boolean
  buildingId: string | null
  agentIds: string[] | undefined
  activeFloorId: string
  activeFloorIdRef: React.RefObject<string>
  agentStatusMap: Map<string, string> | undefined
  agentWorkerStatusMap: Map<string, 'idle' | 'working' | 'tool'> | undefined
  existingAgents: ExistingAgentsData | undefined
}

export function useAgentSync({
  ready,
  buildingId,
  agentIds,
  activeFloorId,
  activeFloorIdRef,
  agentStatusMap,
  agentWorkerStatusMap,
  existingAgents,
}: UseAgentSyncOptions): void {
  // ── 1. Sync non-permanent characters with agentIds ─────────────────────
  useEffect(() => {
    if (!ready || !agentIds) return
    const os = getOfficeState()
    const activeSet = new Set(agentIds)

    // Remove stale characters. Permanents without a live session get removed
    // here; syncPermanentGhosts re-materializes them as asleep ghosts on their
    // assigned floor.
    const stale = computeStaleCharacterIds(os.characters, agentIds)
    for (const id of stale) {
      console.log(`[PixelCity] useAgentSync removing agentId=${id} (not in agentIds)`)
      os.removeAgent(id)
    }
    // Clean up floor stash entries for removed non-permanent agents
    if (buildingId) {
      const snap = officeRegistry.getBuilding(buildingId)
      if (snap) {
        for (const [id, entry] of snap.floorStash) {
          if (entry.character.isPermanent) continue
          if (!activeSet.has(id)) snap.floorStash.delete(id)
        }
      }
    }

    // Add characters for agents that are in existingAgents but not yet on canvas
    if (existingAgents && buildingId) {
      for (const id of existingAgents.ids) {
        if (os.characters.has(id)) continue
        if (officeRegistry.getBuilding(buildingId)?.floorStash.has(id)) continue
        if (existingAgents.buildingMap.get(id) !== buildingId) continue
        const palette = existingAgents.palettes.get(id) ?? 0
        const model = existingAgents.models.get(id) ?? 'sonnet'
        // Check if this is a permanent employee so we restore their identity + correct floor
        const permId = officeRegistry.getPermanentIdForAgent(id)
        const empData = permId ? officeRegistry.getBuilding(buildingId)?.permanentEmployees.get(permId) : undefined
        const hueShift = empData?.settings.hueShift ?? undefined
        const seatId = empData?.settings.seatId ?? undefined
        // Only place on the current floor — skip if this employee belongs to a different floor.
        // When the user switches to their assigned floor, activeFloorId changes, this effect
        // re-fires, and the check passes.
        if (permId && empData) {
          const empFloorId = empData.settings.floorId ?? activeFloorIdRef.current
          if (empFloorId !== activeFloorIdRef.current) continue
        }
        os.addAgent(id, palette, hueShift, seatId, true, undefined, model)
        const ch = os.characters.get(id)
        if (ch) {
          ch.name = existingAgents.names.get(id) ?? `Agent ${id}`
          ch.model = model
          if (permId && empData) {
            ch.isPermanent = true
            ch.permanentId = permId
            ch.floorId = empData.settings.floorId ?? activeFloorIdRef.current
          } else {
            ch.floorId = activeFloorIdRef.current
          }
        }
      }
    }
  }, [ready, agentIds, existingAgents, buildingId, activeFloorId])

  // ── 2. Sync JSONL status → non-MCP characters ──────────────────────────
  useEffect(() => {
    if (!ready || !agentStatusMap) return
    const os = getOfficeState()
    for (const [id, ch] of os.characters) {
      if (ch.isSubagent) continue
      if (isAgentMcpControlled(id)) continue
      const status = agentStatusMap.get(id)
      const shouldBeActive = !!status
      os.setAgentStatusText(id, status ?? null)
      if (shouldBeActive && !ch.isActive) {
        const tool = detectTool(status!)
        os.setAgentActive(id, true)
        os.setAgentTool(id, tool)
        if (ch.seatId) os.sendToSeat(id)
      } else if (shouldBeActive && ch.isActive) {
        os.setAgentTool(id, detectTool(status!))
      } else if (!shouldBeActive && ch.isActive) {
        os.setAgentActive(id, false)
        os.setAgentTool(id, null)
      }
    }
  }, [agentStatusMap, ready])

  // ── 3. Sync MCP worker status + restore MCP agents on re-mount ──────────
  useEffect(() => {
    if (!ready) return
    const os = getOfficeState()
    const activeSet = new Set(agentIds ?? [])

    // Add MCP agents that exist in persistent maps but weren't on canvas
    if (agentWorkerStatusMap) {
      for (const [id, workerStatus] of agentWorkerStatusMap) {
        if (!isAgentMcpControlled(id)) continue
        if (os.characters.has(id)) continue
        // Must have a live session in agentIds — otherwise syncPermanentGhosts
        // owns the visual (asleep ghost).
        if (!activeSet.has(id)) continue

        // Scope check: permanent employees must match building + active floor
        const permId = getPermanentIdForAgent(id)
        const agentBldg = officeRegistry.getBuildingForAgent(id)
        const agentSnap = agentBldg ? officeRegistry.getBuilding(agentBldg) : null
        const empData = permId
          ? agentSnap?.permanentEmployees.get(permId)
          : agentSnap?.permanentEmployees.get(id)
        if (empData) {
          if ((empData.settings.officeId ?? null) !== (buildingId ?? null)) continue
          const empFloorId = empData.settings.floorId ?? 'floor-0'
          if (empFloorId !== activeFloorIdRef.current) continue
        } else {
          const agentBuilding = existingAgents?.buildingMap.get(id)
          if (agentBuilding !== undefined && agentBuilding !== (buildingId ?? null)) continue
        }

        const palette = existingAgents?.palettes.get(id) ?? 0
        const model = existingAgents?.models.get(id) ?? 'sonnet'
        os.addAgent(id, palette, undefined, undefined, workerStatus === 'working', undefined, model)
        const ch = os.characters.get(id)
        if (ch) {
          ch.name = existingAgents?.names.get(id) ?? `Agent ${id}`
          ch.floorId = activeFloorIdRef.current
        }
      }
    }

    // Apply latest MCP worker status to all MCP-controlled characters
    for (const [id] of os.characters) {
      if (!isAgentMcpControlled(id)) continue
      const workerStatus = agentWorkerStatusMap?.get(id)
      const status = agentStatusMap?.get(id)
      if (workerStatus === 'working') {
        os.setAgentActive(id, true)
        os.setWorkerStatus(id, 'working')
      } else if (workerStatus === 'idle') {
        os.setAgentActive(id, false)
        os.setWorkerStatus(id, 'idle')
      }
      if (status !== undefined) {
        os.setAgentStatusText(id, status ?? null)
      }
    }
  }, [ready, agentWorkerStatusMap, agentStatusMap, existingAgents, buildingId, agentIds])
}
