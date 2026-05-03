import { useMemo, useRef, useEffect } from 'react'
import { useOfficeContext } from '../../contexts/OfficeContext.js'

export interface BuildingAgentSummary {
  total: number
  working: number
}

export interface TransientStatusTag {
  buildingUid: string
  agentName: string
  statusText: string
  startTime: number
}

const TAG_TTL_MS = 3000 // 2.5s visible + 0.5s fade

export function useBuildingAgentSummaries() {
  const {
    agentIds,
    agentBuildingMap,
    agentWorkerStatusMap,
    agentStatusMap,
    agentNames,
  } = useOfficeContext()

  // ── Per-building summary ──────────────────────────────────
  const summaryMap = useMemo(() => {
    const map = new Map<string, BuildingAgentSummary>()
    for (const id of agentIds) {
      const buildingUid = agentBuildingMap.get(id)
      if (!buildingUid) continue
      let entry = map.get(buildingUid)
      if (!entry) {
        entry = { total: 0, working: 0 }
        map.set(buildingUid, entry)
      }
      entry.total++
      const ws = agentWorkerStatusMap.get(id)
      if (ws === 'working' || ws === 'tool') {
        entry.working++
      }
    }
    return map
  }, [agentIds, agentBuildingMap, agentWorkerStatusMap])

  // ── Transient status tags ─────────────────────────────────
  const prevStatusRef = useRef<Map<string, string>>(new Map())
  const tagsRef = useRef<TransientStatusTag[]>([])

  // Detect status changes and push new tags
  useEffect(() => {
    const now = performance.now()
    const prev = prevStatusRef.current
    const nextPrev = new Map<string, string>()

    for (const id of agentIds) {
      const status = agentStatusMap.get(id)
      if (!status) continue
      nextPrev.set(id, status)

      const oldStatus = prev.get(id)
      if (oldStatus !== status) {
        const buildingUid = agentBuildingMap.get(id)
        if (!buildingUid) continue
        const rawName = agentNames.get(id) ?? id
        const agentName = rawName.length > 8 ? rawName.slice(0, 8) + '..' : rawName
        const statusText = status.length > 25 ? status.slice(0, 25) + '...' : status
        tagsRef.current.push({ buildingUid, agentName, statusText, startTime: now })
      }
    }

    prevStatusRef.current = nextPrev

    // Prune expired tags
    tagsRef.current = tagsRef.current.filter(t => now - t.startTime < TAG_TTL_MS)
  }, [agentIds, agentStatusMap, agentBuildingMap, agentNames])

  return { summaryMap, transientTagsRef: tagsRef }
}
