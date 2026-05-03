import { useState, useEffect, useRef, useCallback } from 'react'
import type { StatusHistoryEntry } from '../appTypes.js'
import { officeRegistry, lastActiveFloorMap } from '../office/officeStateRefs.js'
import { normalizeModel } from '../llm/index.js'
import { cancelPermTimer } from '../permissionTimer.js'
import type { AgentTrack } from '../permissionTimer.js'
import type { DebugEventKind } from '../DebugPanel.js'

interface AgentStateDeps {
  currentBuildingIdRef: React.RefObject<string | null>
  pendingPromptsRef: React.RefObject<Map<string, string>>
  debugCallbackRef: React.RefObject<(agentId: string | number, kind: DebugEventKind, label: string) => void>
}

export function useAgentState({
  currentBuildingIdRef,
  pendingPromptsRef,
  debugCallbackRef,
}: AgentStateDeps) {
  // ── Core agent lists ─────────────────────────────────
  const [agentIds, setAgentIds] = useState<string[]>([])
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)

  // ── Agent metadata maps ──────────────────────────────
  const [agentPalettes, setAgentPalettes] = useState<Map<string, number>>(new Map())
  const [agentNames, setAgentNames] = useState<Map<string, string>>(new Map())
  const [agentModels, setAgentModels] = useState<Map<string, string>>(new Map())
  const [agentStatusMap, setAgentStatusMap] = useState<Map<string, string>>(new Map())
  const [agentStatusStartMap, setAgentStatusStartMap] = useState<Map<string, number>>(new Map())
  const [agentStatusHistory, setAgentStatusHistory] = useState<StatusHistoryEntry[]>([])
  const [agentWorkerStatusMap, setAgentWorkerStatusMap] = useState<Map<string, 'idle' | 'working' | 'tool'>>(new Map())
  const [agentPermanentIdMap, setAgentPermanentIdMap] = useState<Map<string, string>>(new Map())
  const [agentBuildingMap, setAgentBuildingMap] = useState<Map<string, string>>(new Map())
  const [agentNotes, setAgentNotes] = useState<Map<string, string>>(new Map())
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)

  // ── Stable refs mirroring state (for callbacks) ──────
  const activeAgentIdRef = useRef<string | null>(null)
  useEffect(() => { activeAgentIdRef.current = activeAgentId }, [activeAgentId])

  const agentModelsRef = useRef<Map<string, string>>(new Map())
  const agentPalettesRef = useRef<Map<string, number>>(new Map())
  const agentNamesRef = useRef<Map<string, string>>(new Map())
  const agentBuildingMapRef = useRef<Map<string, string>>(new Map())
  const agentPermanentIdMapRef = useRef<Map<string, string>>(new Map())
  agentModelsRef.current = agentModels
  agentPalettesRef.current = agentPalettes
  agentNamesRef.current = agentNames
  agentPermanentIdMapRef.current = agentPermanentIdMap
  agentBuildingMapRef.current = agentBuildingMap

  // ── Permission tracking (timer disabled) ─────────────
  const agentTrackRef = useRef<Map<string, AgentTrack>>(new Map())
  const startPermTimerRef = useRef<(agentId: string, track: AgentTrack) => void>(() => {})
  startPermTimerRef.current = (_agentId: string, _track: AgentTrack) => {}

  // ── PTY status callback (no-op — JSONL is authoritative) ─
  const ptyStatusCallbackRef = useRef<(id: string, status: string | null) => void>(() => {})
  ptyStatusCallbackRef.current = () => { /* no-op */ }

  // ── Status callback ───────────────────────────────────
  const statusCallbackRef = useRef<(id: string, status: string | null) => void>(() => {})
  statusCallbackRef.current = (id: string, status: string | null) => {
    if (status !== null) {
      setAgentStatusHistory(prev => {
        const entry: StatusHistoryEntry = { agentId: id, text: status, timestamp: Date.now() }
        // Cap at 500 entries to avoid memory bloat
        const next = prev.length >= 500 ? [...prev.slice(-499), entry] : [...prev, entry]
        return next
      })
    }
    setAgentStatusMap(prev => {
      if (status === null && !prev.has(id)) return prev
      if (status !== null && prev.get(id) === status) return prev
      const next = new Map(prev)
      if (status) next.set(id, status)
      else next.delete(id)
      return next
    })
    setAgentStatusStartMap(prev => {
      if (status === null) {
        if (!prev.has(id)) return prev
        const next = new Map(prev); next.delete(id); return next
      }
      if (prev.has(id)) return prev
      const next = new Map(prev); next.set(id, Date.now()); return next
    })
  }

  // ── handleAddAgent ────────────────────────────────────
  const handleAddAgent = useCallback((
    agentId: string,
    palette: number,
    name: string,
    model: string,
    buildingId: string | null,
    initialMessage?: string,
    permanentId?: string,
  ) => {
    const resolvedBuildingId = buildingId ?? currentBuildingIdRef.current
    const shortModel = normalizeModel(model)
    agentModelsRef.current.set(agentId, shortModel)
    if (initialMessage) {
      pendingPromptsRef.current.set(agentId, initialMessage)
    }
    setAgentIds(prev => prev.includes(agentId) ? prev : [...prev, agentId])
    setAgentPalettes(prev => new Map(prev).set(agentId, palette))
    setAgentNames(prev => new Map(prev).set(agentId, name))
    setAgentModels(prev => new Map(prev).set(agentId, shortModel))
    if (permanentId) {
      setAgentPermanentIdMap(prev => new Map(prev).set(agentId, permanentId))
    }
    if (resolvedBuildingId) {
      setAgentBuildingMap(prev => new Map(prev).set(agentId, resolvedBuildingId))
      officeRegistry.registerAgent({
        agentId,
        buildingId: resolvedBuildingId,
        permanentId: permanentId ?? undefined,
        floorId: (permanentId
          ? officeRegistry.getBuilding(resolvedBuildingId)?.permanentEmployees.get(permanentId)?.settings.floorId
          : undefined) ?? lastActiveFloorMap.get(resolvedBuildingId) ?? 'floor-0',
        palette,
        name,
        model: shortModel,
        isPermanent: !!permanentId,
      })
    }
    setActiveAgentId(agentId)
    debugCallbackRef.current(agentId, 'agent', `spawned — ${name} (${shortModel})`)
  }, [])

  // ── updateAgentModel ───────────────────────────────────
  const updateAgentModel = useCallback((agentId: string, model: string) => {
    const shortModel = normalizeModel(model)
    agentModelsRef.current.set(agentId, shortModel)
    setAgentModels(prev => new Map(prev).set(agentId, shortModel))
    const buildingId = agentBuildingMapRef.current.get(agentId)
    if (buildingId) {
      const snapshot = officeRegistry.getBuilding(buildingId)
      const reg = snapshot?.agents.get(agentId)
      if (reg) {
        reg.model = shortModel
      }
      const os = snapshot?.officeState
      const ch = os?.characters.get(agentId)
      if (ch) ch.model = shortModel
    }
  }, [])

  // ── removeAgentFromState ─────────────────────────────
  // Clears all agent metadata Maps. Does NOT handle terminal cleanup —
  // the context composes this with cleanupTerminal for full removeAgent.
  const removeAgentFromState = useCallback((agentId: string) => {
    agentModelsRef.current.delete(agentId)
    agentTrackRef.current.delete(agentId)
    setAgentPalettes(prev => { const m = new Map(prev); m.delete(agentId); return m })
    setAgentNames(prev => { const m = new Map(prev); m.delete(agentId); return m })
    setAgentModels(prev => { const m = new Map(prev); m.delete(agentId); return m })
    setAgentStatusMap(prev => { const m = new Map(prev); m.delete(agentId); return m })
    setAgentStatusStartMap(prev => { const m = new Map(prev); m.delete(agentId); return m })
    setAgentWorkerStatusMap(prev => { const m = new Map(prev); m.delete(agentId); return m })
    setAgentNotes(prev => { const m = new Map(prev); m.delete(agentId); return m })
    setAgentBuildingMap(prev => { const m = new Map(prev); m.delete(agentId); return m })
    setAgentPermanentIdMap(prev => { const m = new Map(prev); m.delete(agentId); return m })
    officeRegistry.removeAgent(agentId)
    setAgentIds(prev => {
      const next = prev.filter(id => id !== agentId)
      setActiveAgentId(curr => {
        if (curr === agentId) return next.length > 0 ? next[next.length - 1] : null
        return curr
      })
      return next
    })
  }, [])

  // ── clearAllAgentState ────────────────────────────────
  // Clears all state. Does NOT handle terminal cleanup —
  // the context composes this with terminal teardown for full resetAgents.
  const clearAllAgentState = useCallback(() => {
    for (const track of agentTrackRef.current.values()) cancelPermTimer(track)
    agentTrackRef.current.clear()
    agentModelsRef.current.clear()
    setAgentIds([])
    setActiveAgentId(null)
    setAgentPalettes(new Map())
    setAgentNames(new Map())
    setAgentModels(new Map())
    setAgentStatusMap(new Map())
    setAgentStatusStartMap(new Map())
    setAgentNotes(new Map())
    setAgentBuildingMap(new Map())
    setAgentPermanentIdMap(new Map())
    setEditingNoteId(null)
  }, [])

  return {
    // State values
    agentIds, setAgentIds,
    activeAgentId, setActiveAgentId, activeAgentIdRef,
    agentPalettes, agentNames, agentModels,
    agentStatusMap, agentStatusStartMap, agentStatusHistory,
    agentWorkerStatusMap, setAgentWorkerStatusMap,
    agentPermanentIdMap, setAgentPermanentIdMap, agentBuildingMap,
    agentNotes, setAgentNotes,
    editingNoteId, setEditingNoteId,
    // Stable refs for callbacks
    agentModelsRef, agentPalettesRef, agentNamesRef, agentBuildingMapRef, agentPermanentIdMapRef,
    agentTrackRef, startPermTimerRef,
    ptyStatusCallbackRef, statusCallbackRef,
    // Actions
    handleAddAgent,
    updateAgentModel,
    removeAgentFromState,
    clearAllAgentState,
  }
}
