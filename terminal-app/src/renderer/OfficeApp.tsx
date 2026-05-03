import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { OfficeState } from '@pixel-city/shared/office/engine/officeState'
import { OfficeCanvas } from '@pixel-city/plugin-office'
import { loadAllAssets } from '@pixel-city/shared/assetLoader'
import { buildDynamicCatalog } from '@pixel-city/shared/office/layout/furnitureCatalog'
import { EditTool, TileType } from '@pixel-city/shared/office/types'
import type { OfficeLayout, FloorColor, PlacedFurniture } from '@pixel-city/shared/office/types'
import type { TileType as TileTypeVal } from '@pixel-city/shared/office/types'
import { EditorState, EditorToolbar } from './office/editor/index.js'
import type { LoadedAssetData } from '@pixel-city/shared/office/layout/furnitureCatalog'
import { useFloorManager } from './hooks/useFloorManager.js'
import { usePermanentEmployees } from './hooks/usePermanentEmployees.js'
import { useReducedMotionSync } from './hooks/useReducedMotionSync.js'
import { useAgentSync } from './hooks/useAgentSync.js'
import { platform } from './platform/index.js'
import { useOfficeContext } from './contexts/OfficeContext.js'

import { FullOfficeView, normalizeLayout } from '@pixel-city/plugin-office/components'
import type { FullOfficeViewHandle } from '@pixel-city/plugin-office/components'

// Pre-compiled regexes for tool detection (avoid recompilation every frame)
const RE_READING = /^Reading/i
const RE_SEARCHING = /^Searching|^Fetching web|^Searching the web/i

function detectTool(status: string): 'Read' | 'Grep' | 'Write' {
  if (RE_READING.test(status)) return 'Read'
  if (RE_SEARCHING.test(status)) return 'Grep'
  return 'Write'
}

import { listEmployeesFromRtdb } from './employee/employeeDbLocal'
import { loadLayoutFromRtdb, saveLayoutToRtdb, loadFloorsFromRtdb, saveFloorsToRtdb, loadDefaultOfficeLayout } from './office/layoutDbLocal'
import { loadCityLayout, loadCityCatalog } from './city/cityLayoutDbLocal'
import { useCityContext } from './contexts/CityContext.js'
import type { FloorEntry, PermanentEmployeeData, AppProps, BuildingInfo } from './office/officeAppTypes.js'
import {
  officeStateRef, generateAgentId,
  lastActiveFloorMap,
  setOfficeState, getOfficeState,
  officeRegistry,
} from './office/officeStateRefs.js'
import { btnBase } from './office/officeStyles.js'
import { CharacterPicker } from '@pixel-city/plugin-office'
import { FloorGeneratorPanel } from '@pixel-city/plugin-office'
import { MakePermanentModal } from './office/components/MakePermanentModal.js'
import { FireConfirmModal } from './office/components/FireConfirmModal.js'
import { llmRegistry } from './llm/index.js'
import type { ModelPickerEntry } from '@pixel-city/core/session'
import { Bulkhead } from './Bulkhead.js'
import { log } from './logger.js'

// Bootstrap supervisor — wraps each init phase so a single failure doesn't
// strand setReady(true). Each safeStep resolves to T | null on rejection.
function serializeBootstrapErr(err: unknown) {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack }
  return { name: 'NonError', message: String(err) }
}

async function safeStep<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (err) {
    log.warn(`bootstrap.${name}`, 'init failed, starting degraded', { err: serializeBootstrapErr(err) })
    return null
  }
}

// Re-export for external consumers
export { getPermanentIdForAgent, getAgentIdForPermanent } from './office/officeStateRefs.js'

function OfficeModelPicker({ agentId, currentModel, availableModels, onChangeModel }: {
  agentId: string
  currentModel: string
  availableModels: ModelPickerEntry[]
  onChangeModel: (agentId: string, model: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          ...btnBase,
          fontSize: '11px',
          padding: '3px 8px',
          color: currentModel.includes('opus') ? '#c87aff' : currentModel.includes('haiku') ? '#e8b85a' : '#5ac8e8',
          border: '1px solid var(--border)',
        }}
        title="Change model"
      >
        {currentModel.includes('opus') ? 'Opus' : currentModel.includes('haiku') ? 'Haiku' : currentModel === 'sonnet' || currentModel.includes('sonnet') ? 'Sonnet' : currentModel} ▾
      </button>
      {open && (
        <div style={{
          position: 'absolute',
          bottom: '100%',
          right: 0,
          marginBottom: 4,
          zIndex: 200,
          background: 'var(--bg-popup, #1a1a2e)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 4,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          minWidth: 140,
        }}>
          {availableModels.map(({ providerId, providerDisplayName, models }) => (
            <div key={providerId}>
              <div style={{
                padding: '4px 14px 2px',
                fontSize: '9px',
                color: 'rgba(255,255,255,0.35)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}>
                {providerDisplayName}
              </div>
              {models.map(m => (
                <button
                  key={m.id}
                  onClick={(e) => { e.stopPropagation(); onChangeModel(agentId, m.id); setOpen(false) }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: '6px 14px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    color: m.color,
                    textAlign: 'left',
                    whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.07)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {m.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function OfficeApp({ buildingId, onAddAgent, onRemoveAgent, onResetAgents, externalSelectedId, onAgentSelect, agentStatusMap, agentWorkerStatusMap, projectCwd, existingAgents, agentIds }: AppProps) {
  const { activeCityId } = useCityContext()
  const { sendPtyInput, setCurrentFloors, setOfficeReady, updateAgentModel, agentModels, setAgentPermanentIdMap } = useOfficeContext()
  const viewRef = useRef<FullOfficeViewHandle>(null)
  const [ready, setReady] = useState(false)
  const [officeState, setOfficeStateLocal] = useState<OfficeState | null>(null)
  const [, setTick] = useState(0)
  const agentIdsRef = useRef<string[] | undefined>(agentIds)
  const pendingSpawnRef = useRef<Set<string>>(new Set())
  const assetsLoadedRef = useRef(false)
  const loadedAssetsRef = useRef<LoadedAssetData | null>(null)
  const initStartedRef = useRef(false)
  const [buildingInfo, setBuildingInfo] = useState<BuildingInfo | null>(null)

  // ── Available models for office card model picker ──
  const availableModels = useMemo((): ModelPickerEntry[] => {
    return llmRegistry.getAllModels()
      .map(({ provider, models }) => ({
        providerId: provider.id,
        providerDisplayName: provider.displayName,
        models: models.map(m => {
          const color = provider.id === 'claude-code'
            ? (m.id.includes('opus') ? '#c87aff' : '#5ac8e8')
            : '#e8b85a'
          return { id: m.id, label: m.label, color }
        }),
      }))
  }, [])

  // ── Floor manager (L2) ──
  const {
    floors, setFloors,
    activeFloorId, setActiveFloorId, activeFloorIdRef,
    activeLayoutId, setActiveLayoutId,
    switchFloor, saveFloors, stashAllCharacters,
  } = useFloorManager({ buildingId: buildingId ?? null, onFloorChanged: () => setTick(n => n + 1) })

  // Push current floor list to OfficeContext so AgentPanel can map floorId → name
  useEffect(() => { setCurrentFloors(floors) }, [floors, setCurrentFloors])

  // Stash all current-floor characters on unmount so their floor assignments survive building switches
  useEffect(() => {
    return () => {
      const os = officeStateRef.current
      if (!os || !buildingId) return
      for (const [id, ch] of os.characters) {
        const snap = officeRegistry.getBuilding(buildingId)
        if (!snap?.floorStash.has(id)) {
          officeRegistry.stashCharacter(id, buildingId, { ...ch })
        }
      }
    }
  }, [buildingId])

  // ── Editor state ──
  const editorStateRef = useRef(new EditorState())
  const [isEditMode, setIsEditMode] = useState(false)

  // ── Auto-save debounce ref ──
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current) }
  }, [])

  // ── Floor generator state ──
  const [showGenPanel, setShowGenPanel] = useState(false)
  const preGenLayoutRef = useRef<OfficeLayout | null>(null)

  // ── prefers-reduced-motion → wakeQueue (L2) ──
  useReducedMotionSync()

  // ── Permanent employees (L2) ──
  const {
    showMakePermanentModal, setShowMakePermanentModal,
    showFireConfirmModal, setShowFireConfirmModal,
    makePermanent: handleMakePermanent,
    firePermanent: handleFirePermanent,
  } = usePermanentEmployees({
    buildingId: buildingId ?? null,
    buildingInfo,
    projectCwd,
    activeFloorIdRef,
    agentIdsRef,
    pendingSpawnRef,
    viewRef,
    sendPtyInput,
    onAddAgent,
    onRemoveAgent,
    setAgentPermanentIdMap,
    ready,
    onTick: () => setTick(n => n + 1),
  })

  // ── Hire from AgentPanel — bridge "pixelcity:hire-agent" event ──
  // The Hire button in the AgentPanel message header dispatches this event
  // with the agent ID. We select that character in the office and open the
  // existing MakePermanent modal (which reads viewRef.current.selectedId).
  useEffect(() => {
    const handler = (e: Event) => {
      const { agentId } = (e as CustomEvent).detail ?? {}
      if (!agentId) return
      viewRef.current?.setSelectedId(agentId)
      setShowMakePermanentModal(true)
    }
    window.addEventListener('pixelcity:hire-agent', handler)
    return () => window.removeEventListener('pixelcity:hire-agent', handler)
  }, [setShowMakePermanentModal])

  // ── Character picker ──
  const [showCharPicker, setShowCharPicker] = useState(false)

  const [officeInstructions, setOfficeInstructions] = useState('')
  const officeConfigLoadedRef = useRef(false)

  const isInBuilding = !!buildingId

  // ── Load assets and initial layout ──
  useEffect(() => {
    if (initStartedRef.current) return
    initStartedRef.current = true
    setOfficeReady(false) // reset while this building's init runs
    async function bootstrap() {
      // Phase 1 — assets. Failure must not block subsequent init; the asset-read
      // site (loadedAssets prop on EditorToolbar) already null-guards via `?? undefined`.
      const furnitureData = await safeStep('assets', () => loadAllAssets())
      if (furnitureData) {
        buildDynamicCatalog(furnitureData)
        loadedAssetsRef.current = furnitureData
      }
      assetsLoadedRef.current = true

      async function loadPersistedLayout(id: string): Promise<OfficeLayout | null> {
        try {
          const result = await loadLayoutFromRtdb(id)
          if (result.found && result.data) return normalizeLayout(result.data as OfficeLayout)
        } catch { /* RTDB not available */ }
        return null
      }

      // Tracks the floor we will actually land on — used for canvas rendering decisions below.
      // Must be determined synchronously in bootstrap() because setActiveFloorId() is async
      // (React batches the update) so activeFloorIdRef.current may lag behind.
      let initFloorId = activeFloorIdRef.current

      // Phase 2 — building / layout / floor setup. Wrapped as a single safeStep
      // so any IPC / fetch / parse failure inside falls through to the fallback
      // OfficeState below without stranding setReady(true).
      const buildingResult = buildingId
        ? await safeStep('building', async () => {
            const catalogResult = await loadCityCatalog()
            const catalog = catalogResult.found && catalogResult.data ? catalogResult.data : { buildings: [] }
            const layoutResult = await loadCityLayout(activeCityId ?? undefined)
            const cityLayout = layoutResult.found && layoutResult.data ? layoutResult.data : { buildings: [] } as any

            const placedBuilding = (cityLayout.buildings || []).find((b: any) => b.uid === buildingId)
            const defId = placedBuilding?.buildingDefId
            const building = defId ? catalog.buildings.find((b: any) => b.id === defId) : null
            const buildingName = placedBuilding?.title || building?.name || buildingId
            if (building || placedBuilding) {
              setBuildingInfo({ id: defId || buildingId, name: buildingName, layout: building?.layout || '', handle: placedBuilding?.handle })

              let buildingFloors: FloorEntry[] = []
              try {
                const result = await loadFloorsFromRtdb(buildingId)
                if (result.found && Array.isArray(result.floors) && result.floors.length > 0) {
                  buildingFloors = result.floors
                }
              } catch { /* RTDB not available */ }
              if (buildingFloors.length === 0) {
                buildingFloors = [{ id: 'floor-0', name: 'Floor 1' }]
              }
              const rememberedFloorId = lastActiveFloorMap.get(buildingId)
              const targetFloorId = rememberedFloorId && buildingFloors.some(f => f.id === rememberedFloorId)
                ? rememberedFloorId
                : buildingFloors[0].id

              let layout: OfficeLayout | null = await loadPersistedLayout(`${buildingId}--${targetFloorId}`)
              if (!layout) layout = await loadPersistedLayout(buildingId)

              // First-boot seed: if neither floor nor building layout exists in SQLite,
              // fall back to the bundled DEFAULT_OFFICE_LAYOUT and persist it under the
              // floor key so subsequent boots load the user's edited copy from DB.
              if (!layout) {
                const seed = await loadDefaultOfficeLayout()
                if (seed.found && seed.data) {
                  layout = normalizeLayout(seed.data)
                  try {
                    await saveLayoutToRtdb(`${buildingId}--${targetFloorId}`, layout)
                  } catch { /* non-fatal: in-memory state still works */ }
                }
              }

              const newOfficeState = layout ? new OfficeState(layout) : new OfficeState()
              setOfficeState(newOfficeState)
              officeRegistry.activateBuilding(buildingId, newOfficeState)
              setFloors(buildingFloors)
              setActiveFloorId(targetFloorId)
              setActiveLayoutId(`${buildingId}--${targetFloorId}`)
              return { resolvedFloorId: targetFloorId }
            } else {
              log.warn('bootstrap.building', 'Building not found', { buildingId })
              const fallbackState = new OfficeState()
              setOfficeState(fallbackState)
              officeRegistry.activateBuilding(buildingId, fallbackState)
              setFloors([{ id: 'floor-0', name: 'Floor 1' }])
              setActiveFloorId('floor-0')
              setActiveLayoutId(`${buildingId}--floor-0`)
              return { resolvedFloorId: 'floor-0' }
            }
          })
        : null

      if (buildingId) {
        if (buildingResult) {
          initFloorId = buildingResult.resolvedFloorId
        } else {
          // safeStep swallowed an error — apply the fallback state here.
          const fallbackState = new OfficeState()
          setOfficeState(fallbackState)
          officeRegistry.activateBuilding(buildingId, fallbackState)
          setFloors([{ id: 'floor-0', name: 'Floor 1' }])
          setActiveFloorId('floor-0')
          initFloorId = 'floor-0'
          setActiveLayoutId(`${buildingId}--floor-0`)
        }
      } else {
        setOfficeState(new OfficeState())
      }

      // Phase 3 — permanent employees. Failure must not block agent restoration below.
      await safeStep('employees', async () => {
        const result = await listEmployeesFromRtdb()
        if (result.success && result.employees && result.employees.length > 0) {
          const os = getOfficeState()
          const currentOfficeId = buildingId ?? null
          for (const emp of result.employees as PermanentEmployeeData[]) {
            const empOfficeId = emp.settings.officeId ?? null
            if (empOfficeId !== currentOfficeId) continue
            const empFloorId = emp.settings.floorId ?? 'floor-0'
            const { palette = 0, hueShift = 0, seatId, name, model = 'sonnet' } = emp.settings
            // Permanents use their stable employeeId as the runtime agentId.
            const agentId = emp.id
            // Register in the registry (scoped to this building — no global maps)
            officeRegistry.registerPermanentEmployee(emp)
            // Only render on canvas for the landing floor
            if (empFloorId !== initFloorId) continue
            os.addAgent(agentId, palette, hueShift, seatId ?? undefined, true, undefined, model)
            const ch = os.characters.get(agentId)
            if (ch) {
              ch.isPermanent = true
              ch.permanentId = emp.id
              ch.name = name
              ch.role = emp.settings.role
              ch.model = model
              ch.floorId = empFloorId
              // Ensure hueShift is correct even if the character was pre-placed by useAgentSync
              // before bootstrap() ran (race condition when user clicks offline agent during startup).
              ch.hueShift = hueShift
            }
          }
        }
      })

      // Phase 4 — restore stashed + non-permanent agents. Synchronous-ish but
      // wrapped so a thrown registry op can't strand setReady(true).
      await safeStep('agents', async () => {
        // Restore stashed characters that belong to this building's active floor
        if (buildingId) {
          const os = getOfficeState()
          for (const stashed of officeRegistry.popStashedCharacters(buildingId, initFloorId)) {
            if (os.characters.has(stashed.id)) continue
            os.addAgent(stashed.id, stashed.palette, stashed.hueShift, stashed.seatId ?? undefined, true, undefined, stashed.model)
            const ch = os.characters.get(stashed.id)
            if (ch) {
              ch.name = stashed.name
              ch.role = stashed.role
              ch.model = stashed.model
              ch.floorId = stashed.floorId
              ch.isPermanent = stashed.isPermanent
              ch.permanentId = stashed.permanentId
              ch.isActive = stashed.isActive
              ch.workerStatus = stashed.workerStatus
              ch.statusText = stashed.statusText
              ch.currentTool = stashed.currentTool
            }
          }
        }

        // Restore non-permanent agents that belong to this building
        if (existingAgents && buildingId) {
          const os = getOfficeState()
          for (const id of existingAgents.ids) {
            if (existingAgents.buildingMap.get(id) !== buildingId) continue
            if (os.characters.has(id)) continue
            if (officeRegistry.getBuilding(buildingId)?.floorStash.has(id)) continue
            const palette = existingAgents.palettes.get(id) ?? 0
            const model = existingAgents.models.get(id) ?? 'sonnet'
            os.addAgent(id, palette, undefined, undefined, true, undefined, model)
            const ch = os.characters.get(id)
            if (ch) {
              ch.name = existingAgents.names.get(id) ?? `Agent ${id}`
              ch.model = model
              ch.floorId = activeFloorIdRef.current
            }
          }
        }
      })

      setOfficeStateLocal(getOfficeState())
      // setReady(true) is unconditional — every phase above is wrapped in safeStep,
      // so we always reach this line. App enters degraded UI rather than blank loading.
      setReady(true)
      setOfficeReady(true)
    }
    bootstrap().catch((err) => {
      // Defensive: bootstrap() itself shouldn't throw, but if a setState call
      // somehow rejects, still flip ready so the user sees a degraded UI.
      log.error('bootstrap', err)
      setReady(true)
      setOfficeReady(true)
    })
  }, [buildingId])

  useEffect(() => { agentIdsRef.current = agentIds }, [agentIds])

  // ── Agent sync (L2) — keeps canvas in sync with context maps ─────────────
  useAgentSync({
    ready,
    buildingId: buildingId ?? null,
    agentIds,
    activeFloorId,
    activeFloorIdRef,
    agentStatusMap,
    agentWorkerStatusMap,
    existingAgents,
  })

  // Load office instructions (from `.pixelcity/office-instructions.md`)
  useEffect(() => {
    if (officeConfigLoadedRef.current) return
    platform().config.loadOfficeInstructions(projectCwd).then((officeRes: any) => {
      setOfficeInstructions(officeRes?.content || '')
      officeConfigLoadedRef.current = true
    })
  }, [projectCwd, buildingId])

  // ── Callbacks ──

  const handleSaveInstructions = useCallback((text: string) => {
    setOfficeInstructions(text)
    platform().config.saveOfficeInstructions(projectCwd, text).catch(err => {
      log.warn('office-instructions.save', 'failed', { err: String(err) })
    })
  }, [projectCwd])

  const handleOpenInstructionsFile = useCallback(() => {
    platform().config.openOfficeInstructionsFile(projectCwd).catch(err => {
      log.warn('office-instructions.open', 'failed', { err: String(err) })
    })
  }, [projectCwd])

  const handleAddAgent = useCallback(() => {
    setShowCharPicker(prev => !prev)
  }, [])

  const handlePickCharacter = useCallback((palette: number, model: string, customName: string, initialMessage?: string) => {
    const os = getOfficeState()
    const id = generateAgentId()
    os.addAgent(id, palette, undefined, undefined, undefined, undefined, model, customName)
    const ch = os.characters.get(id)
    if (ch) {
      ch.floorId = activeFloorIdRef.current
      ch.spawnReason = 'manual'
      ch.visualState = 'awake'
    }
    const name = customName || (ch?.name ?? `Agent ${id}`)
    onAddAgent?.(id, palette, name, model, buildingId ?? null, initialMessage)
    setShowCharPicker(false)
    setTick(n => n + 1)
  }, [onAddAgent, buildingId])

  const handleRemoveAgent = useCallback((agentId: string) => {
    const os = getOfficeState()
    const ch = os.characters.get(agentId)
    if (ch?.isPermanent) return
    os.removeAgent(agentId)
    onRemoveAgent?.(agentId)
    os.selectedAgentId = null
    os.cameraFollowId = null
    setTick(n => n + 1)
  }, [onRemoveAgent])

  // handleMakePermanent, handleFirePermanent → provided by usePermanentEmployees (above)
  // switchFloor, saveFloors → provided by useFloorManager (above)

  // ── Floor switch: also resets editor state ──
  const handleSwitchFloor = useCallback(async (floorId: string, setActiveFloorIdInView: (id: string) => void) => {
    await switchFloor(floorId, setActiveFloorIdInView)
    editorStateRef.current.reset()
    setIsEditMode(false)
  }, [switchFloor])

  // ── Editor callbacks ──

  const scheduleAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(async () => {
      const layout = getOfficeState().getLayout()
      try {
        const saveId = isInBuilding ? `${buildingId}--${activeFloorIdRef.current}` : activeLayoutId
        const result = await saveLayoutToRtdb(saveId, layout)
        if (result.success) {
          editorStateRef.current.isDirty = false
          setTick(n => n + 1)
        }
      } catch (err) {
        console.warn('Auto-save failed:', err)
      }
    }, 5000)
  }, [isInBuilding, buildingId, activeLayoutId])

  const handleLayoutChange = useCallback((newLayout: OfficeLayout, shift?: { col: number; row: number }) => {
    const os = getOfficeState()
    os.rebuildFromLayout(newLayout, shift)
    editorStateRef.current.isDirty = true
    setTick(n => n + 1)
    scheduleAutoSave()
  }, [scheduleAutoSave])

  const handlePushUndo = useCallback(() => {
    const os = getOfficeState()
    const es = editorStateRef.current
    es.pushUndo(os.getLayout())
    es.clearRedo()
  }, [])

  const handleUndo = useCallback(() => {
    const es = editorStateRef.current
    const prevLayout = es.popUndo()
    if (!prevLayout) return
    const os = getOfficeState()
    es.pushRedo(os.getLayout())
    os.rebuildFromLayout(prevLayout)
    es.clearSelection()
    es.clearGhost()
    setTick(n => n + 1)
    scheduleAutoSave()
  }, [scheduleAutoSave])

  const handleRedo = useCallback(() => {
    const es = editorStateRef.current
    const nextLayout = es.popRedo()
    if (!nextLayout) return
    const os = getOfficeState()
    es.pushUndo(os.getLayout())
    os.rebuildFromLayout(nextLayout)
    es.clearSelection()
    es.clearGhost()
    setTick(n => n + 1)
    scheduleAutoSave()
  }, [scheduleAutoSave])

  const handleToggleEdit = useCallback(() => {
    const es = editorStateRef.current
    const newMode = !isEditMode
    es.isEditMode = newMode
    if (!newMode) {
      es.reset()
    } else {
      es.activeTool = EditTool.SELECT
    }
    setIsEditMode(newMode)
    if (newMode) {
      const os = getOfficeState()
      os.selectedAgentId = null
      os.cameraFollowId = null
      viewRef.current?.setSelectedId(null)
    }
    setTick(n => n + 1)
  }, [isEditMode])

  const handleToolChange = useCallback((tool: typeof EditTool[keyof typeof EditTool]) => {
    const es = editorStateRef.current
    es.activeTool = tool
    es.clearSelection()
    es.clearGhost()
    setTick(n => n + 1)
  }, [])

  const handleTileTypeChange = useCallback((type: TileTypeVal) => {
    editorStateRef.current.selectedTileType = type
    setTick(n => n + 1)
  }, [])

  const handleFloorColorChange = useCallback((color: FloorColor) => {
    editorStateRef.current.floorColor = color
    setTick(n => n + 1)
  }, [])

  const handleWallColorChange = useCallback((color: FloorColor) => {
    editorStateRef.current.wallColor = color
    const os = getOfficeState()
    const layout = os.getLayout()
    const existingColors = layout.tileColors || new Array(layout.tiles.length).fill(null)
    const newTileColors = existingColors.map((c, i) =>
      layout.tiles[i] === TileType.WALL ? { ...color } : c
    )
    handleLayoutChange({ ...layout, tileColors: newTileColors })
  }, [handleLayoutChange])

  const handleFurnitureTypeChange = useCallback((type: string) => {
    editorStateRef.current.selectedFurnitureType = type
    editorStateRef.current.activeTool = EditTool.FURNITURE_PLACE
    setTick(n => n + 1)
  }, [])

  const handleSelectedFurnitureColorChange = useCallback((color: FloorColor | null) => {
    const es = editorStateRef.current
    if (!es.selectedFurnitureUid) return
    const os = getOfficeState()
    const layout = os.getLayout()
    const furnitureArr: PlacedFurniture[] = Array.isArray(layout.furniture) ? layout.furniture : (layout.furniture ? Object.values(layout.furniture) : [])
    const item = furnitureArr.find(f => f.uid === es.selectedFurnitureUid)
    if (!item) return
    const newFurniture = furnitureArr.map(f => {
      if (f.uid !== es.selectedFurnitureUid) return f
      if (color) {
        return { ...f, color: { ...color } }
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { color: _, ...rest } = f
      return rest
    })
    const newLayout = { ...layout, furniture: newFurniture }
    handlePushUndo()
    handleLayoutChange(newLayout)
  }, [handlePushUndo, handleLayoutChange])

  // ── Generator callbacks ──

  const handleOpenGenPanel = useCallback(() => {
    preGenLayoutRef.current = getOfficeState().getLayout()
    setShowGenPanel(true)
  }, [])

  const handleGenPreview = useCallback((layout: OfficeLayout) => {
    getOfficeState().rebuildFromLayout(layout)
    setTick(n => n + 1)
  }, [])

  const handleGenApply = useCallback(async (floorName: string) => {
    if (isInBuilding) {
      const newFloorId = `floor-${Date.now()}`
      const name = floorName.trim() || `Floor ${floors.length + 1}`
      const newFloor: FloorEntry = { id: newFloorId, name }
      const updatedFloors = [...floors, newFloor]

      const layout = getOfficeState().getLayout()
      try {
        await saveLayoutToRtdb(`${buildingId}--${newFloorId}`, layout)
        if (buildingId) await saveFloorsToRtdb(buildingId, updatedFloors)
      } catch (err) {
        console.warn('Failed to save new floor:', err)
      }

      // Stash current characters so the new floor starts empty
      stashAllCharacters()

      setFloors(updatedFloors)
      setActiveFloorId(newFloorId)
      setActiveLayoutId(`${buildingId}--${newFloorId}`)
      viewRef.current?.setFloors(updatedFloors)
      viewRef.current?.setActiveFloorId(newFloorId)
      preGenLayoutRef.current = null
      editorStateRef.current.isDirty = false
      editorStateRef.current.isEditMode = true
      editorStateRef.current.activeTool = EditTool.FURNITURE_PLACE
      setIsEditMode(true)
      setShowGenPanel(false)
      setTick(n => n + 1)
    } else {
      preGenLayoutRef.current = null
      editorStateRef.current.isDirty = true
      editorStateRef.current.isEditMode = true
      editorStateRef.current.activeTool = EditTool.FURNITURE_PLACE
      setIsEditMode(true)
      setShowGenPanel(false)
      setTick(n => n + 1)
    }
  }, [isInBuilding, floors, buildingId, stashAllCharacters])

  const handleGenCancel = useCallback(() => {
    const prev = preGenLayoutRef.current
    if (prev) getOfficeState().rebuildFromLayout(prev)
    preGenLayoutRef.current = null
    setShowGenPanel(false)
    setTick(n => n + 1)
  }, [])

  // ── Keyboard shortcuts for undo/redo ──
  useEffect(() => {
    if (!isEditMode) return
    const handler = (e: KeyboardEvent) => {
      const isMac = navigator.platform.includes('Mac')
      const mod = isMac ? e.metaKey : e.ctrlKey
      if (mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        handleUndo()
        return
      }
      if ((mod && e.key === 'z' && e.shiftKey) || (mod && e.key === 'y')) {
        e.preventDefault()
        handleRedo()
        return
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isEditMode, handleUndo, handleRedo])

  // ── Derive editor state for toolbar ──
  const es = editorStateRef.current
  let selectedFurnitureColor: FloorColor | null = null
  if (ready && es.selectedFurnitureUid) {
    const item = getOfficeState().getLayout().furniture.find(f => f.uid === es.selectedFurnitureUid)
    if (item?.color) selectedFurnitureColor = item.color
  }

  const selectedId = viewRef.current?.selectedId ?? null
  const selectedCh = ready && selectedId !== null ? getOfficeState().characters.get(selectedId) ?? null : null

  return (
    <FullOfficeView
      ref={viewRef}
      buildingId={buildingId ?? ''}
      buildingName={buildingInfo?.name}
      agents={[]}
      agentStatusMap={agentStatusMap}
      agentWorkerStatusMap={agentWorkerStatusMap}
      officeState={officeState}
      initialFloors={floors}
      initialActiveFloorId={activeFloorId}
      onAgentSelect={onAgentSelect}
      onAddAgent={handleAddAgent}
      onRemoveAgent={handleRemoveAgent}
      onSaveFloors={saveFloors}
      onSwitchFloor={handleSwitchFloor}
      officeInstructions={officeInstructions}
      onSaveInstructions={handleSaveInstructions}
      onOpenInstructionsFile={handleOpenInstructionsFile}
      externalSelectedId={externalSelectedId}
      isEditMode={isEditMode}
      renderCanvas={ready ? ({ officeState: os, zoom, panRef, containerRef, onZoomChange, onAgentClick }) => (
        <Bulkhead name="office-canvas">
          <OfficeCanvas
            officeState={os}
            onClick={onAgentClick}
            zoom={zoom}
            onZoomChange={onZoomChange}
            panRef={panRef}
            editorState={isEditMode ? es : undefined}
            onLayoutChange={isEditMode ? handleLayoutChange : undefined}
            onPushUndo={isEditMode ? handlePushUndo : undefined}
          />
        </Bulkhead>
      ) : undefined}
      navRightExtra={
        <button
          data-testid="office-edit-btn"
          className="office-edit-btn"
          onClick={handleToggleEdit}
          style={{
            ...btnBase,
            fontSize: '12px',
            padding: '4px 8px',
            background: isEditMode ? 'rgba(255, 170, 50, 0.15)' : btnBase.background,
            border: isEditMode ? '2px solid rgba(255, 170, 50, 0.7)' : '2px solid transparent',
            color: isEditMode ? 'var(--text-bright)' : btnBase.color,
          }}
        >
          {isEditMode ? 'Exit Edit' : 'Edit'}
        </button>
      }
      floorNavExtra={
        <button
          onClick={handleOpenGenPanel}
          disabled={false}
          style={{
            ...btnBase,
            fontSize: '12px',
            padding: '4px 8px',
            background: 'var(--bg-hover)',
            border: '2px solid var(--accent-dim)',
            color: 'var(--text-bright)',
          }}
          title="Add a new floor"
        >
          + Floor
        </button>
      }
      agentCardExtra={(selectedAgent, selId) => (
        <>
          {selectedAgent && !selectedAgent.isPermanent && !selectedAgent.isSubagent && (
            <button
              onClick={() => setShowMakePermanentModal(true)}
              style={{
                ...btnBase,
                fontSize: '11px',
                padding: '3px 8px',
                color: '#f0c040',
                border: '2px solid rgba(240, 192, 64, 0.35)',
                background: 'rgba(240, 192, 64, 0.08)',
              }}
              title="Hire as a permanent employee that persists across sessions"
            >
              ★ Hire
            </button>
          )}
          {selectedAgent?.isPermanent && (
            <button
              onClick={() => setShowFireConfirmModal(true)}
              style={{
                ...btnBase,
                fontSize: '11px',
                padding: '3px 8px',
                color: 'var(--text-danger, rgba(220, 90, 90, 0.7))',
                border: '1px solid var(--border-danger, rgba(200, 60, 60, 0.28))',
                background: 'var(--bg-danger, rgba(200, 60, 60, 0.06))',
              }}
              data-testid="office-fire-employee-btn"
              title="Permanently remove this employee and delete all their data"
            >
              Fire Employee
            </button>
          )}
          {selId && (
            <OfficeModelPicker
              agentId={selId}
              currentModel={agentModels.get(selId) ?? selectedAgent?.model ?? 'sonnet'}
              availableModels={availableModels}
              onChangeModel={updateAgentModel}
            />
          )}
        </>
      )}
    >
      {/* Character picker popup */}
      {showCharPicker && !isEditMode && (
        <Bulkhead name="character-picker">
          <CharacterPicker
            onPick={handlePickCharacter}
            onClose={() => setShowCharPicker(false)}
          />
        </Bulkhead>
      )}

      {/* Floor generator panel */}
      {showGenPanel && (
        <Bulkhead name="floor-generator">
          <FloorGeneratorPanel
            onPreview={handleGenPreview}
            onApply={handleGenApply}
            onCancel={handleGenCancel}
            applyLabel={isInBuilding ? 'Add Floor' : 'Use This'}
            panelTitle={isInBuilding ? 'Add New Floor' : 'Generate Floor'}
          />
        </Bulkhead>
      )}

      {/* Editor toolbar */}
      {isEditMode && (
        <Bulkhead name="editor-toolbar">
          <EditorToolbar
            activeTool={es.activeTool}
            selectedTileType={es.selectedTileType}
            selectedFurnitureType={es.selectedFurnitureType}
            selectedFurnitureUid={es.selectedFurnitureUid}
            selectedFurnitureColor={selectedFurnitureColor}
            floorColor={es.floorColor}
            wallColor={es.wallColor}
            onToolChange={handleToolChange}
            onTileTypeChange={handleTileTypeChange}
            onFloorColorChange={handleFloorColorChange}
            onWallColorChange={handleWallColorChange}
            onSelectedFurnitureColorChange={handleSelectedFurnitureColorChange}
            onFurnitureTypeChange={handleFurnitureTypeChange}
            loadedAssets={loadedAssetsRef.current ?? undefined}
          />
        </Bulkhead>
      )}

      {/* Edit mode info card (bottom-right) */}
      {isEditMode && (
        <div style={{
          position: 'absolute', bottom: 10, right: 10, zIndex: 50,
          background: 'var(--bg-popup)', border: '2px solid var(--border)',
          borderRadius: 0, padding: '8px 12px', boxShadow: '2px 2px 0px var(--bg-deep)',
          color: 'var(--text)', fontSize: '14px', fontFamily: 'inherit',
        }}>
          <div style={{ color: 'rgba(255, 170, 50, 0.9)', fontWeight: 'bold', marginBottom: 4 }}>
            Edit Mode
          </div>
          <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
            {es.activeTool === EditTool.SELECT && 'Click furniture to select'}
            {es.activeTool === EditTool.TILE_PAINT && 'Click/drag to paint floor'}
            {es.activeTool === EditTool.WALL_PAINT && 'Click/drag to toggle walls'}
            {es.activeTool === EditTool.ERASE && 'Click/drag to erase tiles'}
            {es.activeTool === EditTool.FURNITURE_PLACE && 'Click to place furniture'}
            {es.activeTool === EditTool.FURNITURE_PICK && 'Click furniture to pick type'}
            {es.activeTool === EditTool.EYEDROPPER && 'Click floor to pick pattern'}
          </div>
          {es.selectedFurnitureUid && (
            <div style={{ marginTop: 4, fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
              R = rotate, Del = delete
            </div>
          )}
          <div style={{ marginTop: 4, fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>
            Ctrl+Z / Ctrl+Shift+Z
          </div>
        </div>
      )}

      {/* Make Permanent Modal */}
      {showMakePermanentModal && selectedCh && (
        <Bulkhead name="make-permanent-modal">
          <MakePermanentModal
            character={selectedCh}
            onConfirm={handleMakePermanent}
            onCancel={() => setShowMakePermanentModal(false)}
          />
        </Bulkhead>
      )}

      {/* Fire Confirm Modal */}
      {showFireConfirmModal && selectedCh && selectedCh.isPermanent && (
        <Bulkhead name="fire-confirm-modal">
          <FireConfirmModal
            character={selectedCh}
            onFire={handleFirePermanent}
            onCancel={() => setShowFireConfirmModal(false)}
          />
        </Bulkhead>
      )}

    </FullOfficeView>
  )
}

export default OfficeApp
