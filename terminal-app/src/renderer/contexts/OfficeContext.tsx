import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import type { AgentTerminalData, StatusHistoryEntry } from '../appTypes.js'
import { useCityContext } from './CityContext.js'
import { useWorldContext } from './WorldContext.js'
import { listEmployeesFromRtdb } from '../employee/employeeDbLocal'
import { employeeStore } from '../employee/EmployeeStore.js'
import { useEmployeeSync } from '../hooks/useEmployeeSync.js'
import { useQuickActions } from '../hooks/useQuickActions.js'
import { useAutoStart } from '../hooks/useAutoStart.js'
import { useMcpBridge } from '../hooks/useMcpBridge.js'
import { useAgentState } from '../hooks/useAgentState.js'
import { useTerminalLifecycle } from '../hooks/useTerminalLifecycle.js'
import { randomName } from '@pixel-city/shared/office/engine/nameData'
import { officeRegistry, getOfficeState } from '../office/officeStateRefs.js'
import { performWakeHandoff } from '../office/wakeHandoff.js'
import { isSynthGhostId } from '../office/synthGhostId.js'
import { normalizeModel, MODEL_IDS } from '../llm/index.js'
import { generateAgentId } from '@pixel-city/shared/utils/agentId'

import { platform } from '../platform/index.js'


interface OfficeContextValue {
  // Agent IDs and active
  agentIds: string[]
  setAgentIds: React.Dispatch<React.SetStateAction<string[]>>
  activeAgentId: string | null
  setActiveAgentId: React.Dispatch<React.SetStateAction<string | null>>
  activeAgentIdRef: React.RefObject<string | null>

  // Agent metadata
  agentPalettes: Map<string, number>
  agentNames: Map<string, string>
  agentModels: Map<string, string>
  agentStatusMap: Map<string, string>
  agentStatusStartMap: Map<string, number>
  agentStatusHistory: StatusHistoryEntry[]
  agentWorkerStatusMap: Map<string, 'idle' | 'working' | 'tool'>
  agentPermanentIdMap: Map<string, string>
  setAgentPermanentIdMap: React.Dispatch<React.SetStateAction<Map<string, string>>>
  agentBuildingMap: Map<string, string>
  agentNotes: Map<string, string>
  editingNoteId: string | null
  setEditingNoteId: React.Dispatch<React.SetStateAction<string | null>>
  setAgentNotes: React.Dispatch<React.SetStateAction<Map<string, string>>>

  // Agent terminals
  agentTerminalsRef: React.RefObject<Map<string, AgentTerminalData>>
  initTerminal: (agentId: string, container: HTMLDivElement, options?: { resumeSessionId?: string }) => Promise<void>
  cleanupTerminal: (agentId: string) => void

  // Agent management
  handleAddAgent: (agentId: string, palette: number, name: string, model: string, buildingId: string | null, initialMessage?: string, permanentId?: string) => void
  updateAgentModel: (agentId: string, model: string) => void
  removeAgent: (agentId: string) => void
  endAgentSession: (agentId: string) => void
  resetAgents: () => void

  handleSpawnTempAgent: (model: string) => { key: string; name: string; palette: number }
  handleAutoStartTask: (taskId: string, taskTitle: string, assigneeKey: string) => Promise<void>

  // Permanent employees
  permanentEmployees: Array<{ id: string; settings: { name: string; palette?: number; hueShift?: number; model?: string; officeId?: string | null; floorId?: string; handle?: string } }>

  // Current building floors — pushed from OfficeApp so AgentPanel can map floorId → name
  currentFloors: Array<{ id: string; name: string }>
  setCurrentFloors: React.Dispatch<React.SetStateAction<Array<{ id: string; name: string }>>>

  // Office init readiness — true once OfficeApp's init() finishes (registry activated + employees registered)
  officeReady: boolean
  setOfficeReady: React.Dispatch<React.SetStateAction<boolean>>

  // Status callback ref
  statusCallbackRef: React.RefObject<(id: string, status: string | null) => void>

  // Config cache ref
  configCacheRef: React.RefObject<{ gitInstructions?: string; permissionMode?: 'bypass' | 'auto'; claudeConfigDir?: string } | null>

  // Agent JSONL sessions (for tracking which files agents edited)
  agentJsonlRef: React.RefObject<Map<string, import('../appTypes.js').AgentJsonlSession>>

  // Pending initial prompts (consumed by initTerminal). Read by AgentPanel to
  // bypass the SessionChooser when an agent was spawned with a task prompt
  // (e.g. via auto-start) so the new session begins immediately.
  pendingPromptsRef: React.RefObject<Map<string, string>>

  // PTY input
  sendPtyInput: (agentId: string, message: string) => boolean

  // Agent select handler
  handleAgentSelect: (agentId: string | null) => void

  // Wake a permanent employee from sleep (synth ghost click or DM Start button)
  wakePermanentEmployee: (permanentId: string) => void

  // Quick actions
  quickActions: Array<{ id: string; title: string; description: string; type: 'ai' | 'terminal'; command?: string }>
  addQuickAction: (title: string, description: string, type: 'ai' | 'terminal', command?: string) => void
  removeQuickAction: (id: string) => void
  updateQuickAction: (id: string, title: string, description: string, type: 'ai' | 'terminal', command?: string) => void
  runQuickAction: (action: { id: string; title: string; description: string; type: 'ai' | 'terminal'; command?: string }) => void
}

const OfficeContext = createContext<OfficeContextValue | null>(null)

export function OfficeContextProvider({ children }: { children: React.ReactNode }) {
  const { projectCwd, projectCwdRef, settingsRef, debugCallbackRef, shellTerminalsRef, updateShellName, settings } = useWorldContext()
  const { currentBuildingId, currentBuildingIdRef } = useCityContext()

  // pendingPromptsRef: written by handleAddAgent, consumed by initTerminal
  const pendingPromptsRef = useRef<Map<string, string>>(new Map())

  // ── Agent state ───────────────────────────────────────
  const {
    agentIds, setAgentIds,
    activeAgentId, setActiveAgentId, activeAgentIdRef,
    agentPalettes, agentNames, agentModels,
    agentStatusMap, agentStatusStartMap, agentStatusHistory,
    agentWorkerStatusMap, setAgentWorkerStatusMap,
    agentPermanentIdMap, setAgentPermanentIdMap, agentBuildingMap,
    agentNotes, setAgentNotes,
    editingNoteId, setEditingNoteId,
    agentModelsRef, agentPalettesRef, agentNamesRef, agentBuildingMapRef, agentPermanentIdMapRef,
    agentTrackRef, startPermTimerRef,
    ptyStatusCallbackRef, statusCallbackRef,
    handleAddAgent,
    updateAgentModel,
    removeAgentFromState,
    clearAllAgentState,
  } = useAgentState({
    currentBuildingIdRef,
    pendingPromptsRef,
    debugCallbackRef,
  })

  const configCacheRef = useRef<{ permissionMode?: 'bypass' | 'auto'; claudeConfigDir?: string } | null>(null)

  // ── Terminal lifecycle ────────────────────────────────
  const {
    agentTerminalsRef,
    agentJsonlRef,
    initTerminal,
    cleanupTerminal,
    sendPtyInput,
    stopJsonlWatch,
    pendingTerminalInitRef,
  } = useTerminalLifecycle({
    pendingPromptsRef,
    agentModelsRef,
    agentNamesRef,
    agentPermanentIdMapRef,
    agentBuildingMapRef,
    agentTrackRef,
    startPermTimerRef,
    configCacheRef,
    projectCwdRef,
    currentBuildingIdRef,
    settingsRef,
    settings,
    statusCallbackRef,
    debugCallbackRef,
    shellTerminalsRef,
    ptyStatusCallbackRef,
    updateShellName,
  })

  // ── changeAgentModel — sends /model command to live session + persists for permanent employees ──
  const changeAgentModel = useCallback((agentId: string, model: string) => {
    const shortModel = normalizeModel(model)
    updateAgentModel(agentId, model)
    const modelId = MODEL_IDS[shortModel] ?? shortModel
    sendPtyInput(agentId, `/model ${modelId}\n`)
    const permId = agentPermanentIdMapRef.current.get(agentId)
    if (permId) {
      employeeStore.update(permId, { model: shortModel })
    }
  }, [updateAgentModel, sendPtyInput])

  const removeAgentRef = useRef<(agentId: string) => void>(() => {})

  // ── removeAgent — composed glue (terminal + state) ───
  const removeAgent = useCallback((agentId: string) => {
    console.trace(`[PixelCity] removeAgent called for agentId=${agentId}`)
    const { ipcRenderer: ipc } = window.require('electron') as typeof import('electron')
    ipc.invoke('messages-clear', { agentId }).catch(() => {})
    cleanupTerminal(agentId)
    removeAgentFromState(agentId)
  }, [cleanupTerminal, removeAgentFromState])
  removeAgentRef.current = removeAgent

  // ── endAgentSession — soft cleanup for permanent agents on PTY exit ──
  // Disposes the terminal and clears React/registry state, but preserves
  // the inbox and the permId↔agentId mapping in the registry so the
  // employee can be re-woken (via ghost-click or DM Start) without
  // losing context.
  const endAgentSession = useCallback((agentId: string) => {
    cleanupTerminal(agentId)
    removeAgentFromState(agentId)
  }, [cleanupTerminal, removeAgentFromState])

  // ── resetAgents — composed glue (terminal + state) ───
  const resetAgents = useCallback(() => {
    for (const agent of agentTerminalsRef.current.values()) {
      if (agent.agentHandle) {
        agent.agentHandle.dispose()
      } else {
        if (agent.session) agent.session.kill()
        else if (agent.ptyId) platform().pty.kill(agent.ptyId)
        if (agent.terminal) agent.terminal.dispose()
      }
    }
    agentTerminalsRef.current.clear()
    pendingTerminalInitRef.current.clear()
    for (const id of [...agentJsonlRef.current.keys()]) stopJsonlWatch(id)
    clearAllAgentState()
  }, [stopJsonlWatch, clearAllAgentState])

  // Load initial config
  useEffect(() => {
    platform().config.load(projectCwd!).then((result: any) => {
      if (result.success && result.config) {
        configCacheRef.current = result.config
      }
    }).catch(() => {})
  }, [projectCwd])

  // Register MCP bridge callbacks
  useMcpBridge({
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
  })

  // ── Spawn temp agent from board ───────────────────────
  const handleSpawnTempAgent = useCallback((model: string) => {
    const agentId = generateAgentId()
    const palette = Math.floor(Math.random() * 8)
    const name = randomName()
    handleAddAgent(agentId, palette, name, model, null)
    debugCallbackRef.current(agentId, 'agent', `temp agent spawned from board — ${name} (${model})`)
    return { key: `agent:${agentId}`, name, palette }
  }, [handleAddAgent])

  // ── Auto-start task ───────────────────────────────────
  const { handleAutoStartTask } = useAutoStart({
    agentNamesRef,
    agentPalettesRef,
    agentModelsRef,
    agentTerminalsRef,
    currentBuildingIdRef,
    handleAddAgent,
  })

  // ── Permanent employees ──────────────────────────────
  const { permanentEmployees } = useEmployeeSync(projectCwd)

  // ── Current floors (pushed from OfficeApp) ─────────────
  const [currentFloors, setCurrentFloors] = useState<Array<{ id: string; name: string }>>([])

  // ── Office readiness (pushed from OfficeApp when init() completes) ──────
  const [officeReady, setOfficeReady] = useState(false)

  // ── Quick actions ────────────────────────────────────────
  const { quickActions, addQuickAction, removeQuickAction, updateQuickAction, runQuickAction } = useQuickActions({
    projectCwd,
    currentBuildingIdRef,
    handleAddAgent,
    debugCallbackRef,
  })

  // ── Wake a permanent employee (synth-ghost click or DM Start button) ──
  // Atomically swaps any synth ghost for a real character on the canvas and
  // adds the agent to React state so the SessionChooser shows. Re-uses the
  // registry's permId↔agentId mapping when present so inboxes survive
  // across sleep/wake cycles.
  const wakePermanentEmployee = useCallback((permanentId: string) => {
    if (!officeReady) return
    const buildingId = currentBuildingIdRef.current
    if (!buildingId) return
    const snap = officeRegistry.getBuilding(buildingId)
    const empData = snap?.permanentEmployees.get(permanentId)
    if (!empData) return

    // Permanents use their stable employeeId as the runtime agentId — no random
    // handle needed in OSS, and memory references stay valid across spawns.
    const agentId = permanentId
    const model = normalizeModel(empData.settings.model ?? 'sonnet')

    const os = getOfficeState()
    performWakeHandoff(os, permanentId, agentId, {
      palette: empData.settings.palette ?? 0,
      hueShift: empData.settings.hueShift,
      seatId: empData.settings.seatId,
      name: empData.settings.name,
      model,
      role: empData.settings.role,
      floorId: empData.settings.floorId ?? 'floor-0',
    })

    handleAddAgent(
      agentId,
      empData.settings.palette ?? 0,
      empData.settings.name,
      model,
      buildingId,
      undefined,
      permanentId,
    )
    setActiveAgentId(agentId)
  }, [officeReady, currentBuildingIdRef, handleAddAgent])

  // ── Agent select handler ──────────────────────────────
  const handleAgentSelect = useCallback((agentId: string | null) => {
    if (agentId === null) {
      setActiveAgentId(null)
      return
    }
    if (isSynthGhostId(agentId)) {
      // Strip the 'synth-' prefix to recover the permanentId. Wake is async-ish
      // (it spawns a session) so we route through the dedicated helper rather
      // than just setting activeAgentId — the synth id has no terminal.
      const permanentId = agentId.slice('synth-'.length)
      wakePermanentEmployee(permanentId)
      return
    }
    setActiveAgentId(agentId)
  }, [wakePermanentEmployee])

  return (
    <OfficeContext.Provider value={{
      agentIds, setAgentIds,
      activeAgentId, setActiveAgentId, activeAgentIdRef,
      agentPalettes, agentNames, agentModels,
      agentStatusMap, agentStatusStartMap, agentStatusHistory,
      agentWorkerStatusMap, agentPermanentIdMap, setAgentPermanentIdMap,
      agentBuildingMap, agentNotes, editingNoteId,
      setEditingNoteId, setAgentNotes,
      agentTerminalsRef, initTerminal, cleanupTerminal,
      handleAddAgent, updateAgentModel: changeAgentModel, removeAgent, endAgentSession, resetAgents,
      handleSpawnTempAgent,
      handleAutoStartTask,
      permanentEmployees,
      currentFloors, setCurrentFloors,
      officeReady, setOfficeReady,
      statusCallbackRef, configCacheRef, agentJsonlRef,
      pendingPromptsRef,
      sendPtyInput,
      handleAgentSelect,
      wakePermanentEmployee,
      quickActions, addQuickAction, removeQuickAction, updateQuickAction, runQuickAction,
    }}>
      {children}
    </OfficeContext.Provider>
  )
}

export function useOfficeContext() {
  const ctx = useContext(OfficeContext)
  if (!ctx) throw new Error('useOfficeContext must be used within OfficeContextProvider')
  return ctx
}
