import React, { useState, useEffect, useCallback, useRef } from 'react'
import { CityEditorCanvas } from './editor/CityEditorCanvas.js'
import { CityEditorToolbar } from './editor/CityEditorToolbar.js'
import { CityEditorState } from './editor/cityEditorState.js'
import { CityEditTool } from '@pixel-city/shared/city/editor/cityLayoutTypes'
import type { CityLayout, CityBuildingCatalog, VehicleDirection } from '@pixel-city/shared/city/editor/cityLayoutTypes'
import { createDefaultCityLayout, deserializeCityLayout } from '@pixel-city/shared/city/editor/cityLayoutSerializer'
import { placeBuilding } from '@pixel-city/shared/city/editor/cityEditorActions'
import { CityBuildingInfoDialog } from './editor/CityBuildingInfoDialog.js'
import { CityVehicleSimulation } from '@pixel-city/shared/city/cityVehicleSimulation'
import { CityFolderSidebar } from './CityFolderSidebar.js'
import { loadCityLayout, saveCityLayout, subscribeToCityCatalogUpdates } from './cityLayoutDbLocal'
import { useWorldContext } from '../contexts/WorldContext.js'
import { useCityContext } from '../contexts/CityContext.js'
import { MenuIcon } from '../icons/index.js'
import { platform } from '../platform/index.js'
import { useBuildingAgentSummaries } from './hooks/useBuildingAgentSummaries.js'

// ── Asset loading helpers ──────────────────────────────────────

const _fs = window.require('fs')
const _path = window.require('path')

function loadFromDisk(filePath: string): HTMLImageElement | null {
  try {
    if (!_fs.existsSync(filePath)) return null
    const data = _fs.readFileSync(filePath)
    const base64 = data.toString('base64')
    const img = new Image()
    img.src = `data:image/png;base64,${base64}`
    return img
  } catch { return null }
}

interface BuildingMeta {
  name: string
  type: string
  footprintW: number
  footprintH: number
  pixelW: number
  pixelH: number
  category?: string
}

function writeBuildingMeta(cachePath: string, def: BuildingMeta): void {
  try {
    const metaPath = `${cachePath}.meta.json`
    const meta: BuildingMeta = {
      name: def.name,
      type: def.type,
      footprintW: def.footprintW,
      footprintH: def.footprintH,
      pixelW: def.pixelW,
      pixelH: def.pixelH,
      ...(def.category ? { category: def.category } : {}),
    }
    _fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8')
  } catch { /* non-fatal */ }
}

interface CityAppProps {
  projectCwd: string | null
}

// ── CityApp ────────────────────────────────────────────────────

export function CityApp({ projectCwd }: CityAppProps) {
  const { handleOpenProject } = useWorldContext()
  const { activeCityId } = useCityContext()
  const { summaryMap: buildingAgentSummaries, transientTagsRef } = useBuildingAgentSummaries()
  // Editor state
  const [cityLayout, setCityLayout] = useState<CityLayout | null>(null)
  const [cityCatalog, setCityCatalog] = useState<CityBuildingCatalog>({ buildings: [] })
  const [buildingImages, setBuildingImages] = useState<Record<string, HTMLImageElement>>({})
  const [vehicleImages, setVehicleImages] = useState<Record<string, Record<string, HTMLImageElement>>>({})
  const vehicleSimRef = useRef(new CityVehicleSimulation())
  const zoomKey = activeCityId ? `pixelcity-zoom-${activeCityId}` : 'pixelcity-zoom'
  const scrollKey = activeCityId ? `pixelcity-scroll-${activeCityId}` : 'pixelcity-scroll'
  const [zoom, setZoom] = useState(() => {
    try { const v = localStorage.getItem(zoomKey); return v ? Number(v) : 3 } catch { return 3 }
  })
  const [initialScroll] = useState<{ x: number; y: number } | undefined>(() => {
    try {
      const v = localStorage.getItem(scrollKey)
      return v ? JSON.parse(v) : undefined
    } catch { return undefined }
  })
  const [showGrid, setShowGrid] = useState(true)
  const editorStateRef = useRef(new CityEditorState())
  // React state mirrors for toolbar re-renders (editorStateRef is mutable, won't trigger renders)
  const [activeTool, setActiveTool] = useState<string>(CityEditTool.SELECT)
  const [selectedTileType, setSelectedTileType] = useState<number>(0)
  const [selectedBuildingDefId, setSelectedBuildingDefId] = useState<string | null>(null)
  const [pendingPlacement, setPendingPlacement] = useState<{ defId: string; col: number; row: number } | null>(null)
  const [pendingEnterUid, setPendingEnterUid] = useState<string | null>(null)
  const [pendingEnterMode, setPendingEnterMode] = useState<'assign' | 'not-found'>('assign')
  const buildingUidCounterRef = useRef(Date.now())

  // Local building directory mappings (machine-local, not synced via RTDB)
  const [buildingDirs, setBuildingDirs] = useState<Record<string, string>>({})
  const [buildingDirsLoaded, setBuildingDirsLoaded] = useState(false)

  // Folder sidebar
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // City instructions config
  const [showCityConfig, setShowCityConfig] = useState(false)
  const [cityInstructions, setCityInstructions] = useState('')
  const [canvasPreferences, setCanvasPreferences] = useState('')
  const cityConfigLoadedRef = useRef(false)

  // Load local building directory mappings on mount
  useEffect(() => {
    platform().building.loadDirs().then((result: any) => {
      if (result.success && result.dirs) {
        setBuildingDirs(result.dirs)
      }
      setBuildingDirsLoaded(true)
    })
  }, [])

  // Load city config + canvas preferences from ~/.pixelcity/*.md files.
  // Single source of truth — no per-city SQLite copy, no config.json mirror.
  useEffect(() => {
    Promise.all([
      platform().config.loadCityConfiguration(),
      platform().config.loadCanvasPreferences(),
    ]).then(([city, canvas]) => {
      setCityInstructions(city.content || '')
      setCanvasPreferences(canvas.content || '')
      cityConfigLoadedRef.current = true
    })
  }, [])

  const handleSaveCityConfig = useCallback((instructions: string, canvasPrefs: string) => {
    setCityInstructions(instructions)
    setCanvasPreferences(canvasPrefs)
    platform().config.saveCityConfiguration(instructions)
    platform().config.saveCanvasPreferences(canvasPrefs)
    setShowCityConfig(false)
  }, [])

  // Load city layout on mount from RTDB
  useEffect(() => {
    if (!activeCityId) return
    loadCityLayout(activeCityId).then((result) => {
      if (result.found && result.data) {
        setCityLayout(deserializeCityLayout(JSON.stringify(result.data)))
      } else {
        setCityLayout(createDefaultCityLayout())
      }
    })
  }, [projectCwd, activeCityId])

  // Subscribe to global catalog (read-only, managed by city-builder)
  // onValue fires immediately with current data, so no separate initial load needed
  useEffect(() => {
    const unsub = subscribeToCityCatalogUpdates((catalog) => {
      if (catalog) setCityCatalog(catalog)
    })
    return unsub
  }, [])

  // Load building images when catalog changes
  useEffect(() => {
    const os = window.require('os')
    const newImages: Record<string, HTMLImageElement> = {}
    let cancelled = false
    const cityDir = projectCwd
      ? _path.join(projectCwd, '.pixelcity', 'city', 'buildings')
      : _path.join(os.homedir(), '.pixelcity', 'city', 'buildings')

    function loadImg(src: string): Promise<HTMLImageElement> {
      return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = reject
        img.src = src
      })
    }

    Promise.all(
      cityCatalog.buildings.map(
        (def) =>
          new Promise<void>(async (resolve) => {
            const cachePath = _path.join(cityDir, def.file)

            // 1. User-imported file in .pixelcity/city/buildings/
            const localImg = loadFromDisk(cachePath)
            if (localImg) {
              writeBuildingMeta(cachePath, def)
              localImg.onload = () => { if (!cancelled) newImages[def.id] = localImg; resolve() }
              if (localImg.complete) { if (!cancelled) newImages[def.id] = localImg; resolve() }
              return
            }
            // 2. Bundled asset — load via URL (no disk I/O needed)
            try {
              const img = await loadImg(`./buildings/${def.file}`)
              if (!cancelled) newImages[def.id] = img
            } catch { /* not in bundle either */ }
            resolve()
          }),
      ),
    ).then(() => {
      if (!cancelled) setBuildingImages(newImages)
    })

    return () => { cancelled = true }
  }, [cityCatalog, projectCwd])

  // Load vehicle images when catalog changes
  useEffect(() => {
    const os = window.require('os')
    const vehicleDefs = cityCatalog.vehicles || []
    if (vehicleDefs.length === 0) { setVehicleImages({}); return }

    let cancelled = false
    const vehicleDir = projectCwd
      ? _path.join(projectCwd, '.pixelcity', 'city', 'vehicles')
      : _path.join(os.homedir(), '.pixelcity', 'city', 'vehicles')

    const newImages: Record<string, Record<string, HTMLImageElement>> = {}
    const directions: VehicleDirection[] = ['down', 'up', 'left', 'right']

    function loadImg(src: string): Promise<HTMLImageElement> {
      return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = reject
        img.src = src
      })
    }

    Promise.all(
      vehicleDefs.flatMap((def) =>
        directions.map(
          (dir) =>
            new Promise<void>(async (resolve) => {
              const cachePath = _path.join(vehicleDir, def.files[dir])

              const setImg = (img: HTMLImageElement) => {
                if (!cancelled) {
                  if (!newImages[def.id]) newImages[def.id] = {}
                  newImages[def.id][dir] = img
                }
              }

              // 1. User-imported file in .pixelcity/city/vehicles/
              const localImg = loadFromDisk(cachePath)
              if (localImg) {
                localImg.onload = () => { setImg(localImg); resolve() }
                if (localImg.complete) { setImg(localImg); resolve() }
                return
              }
              // 2. Bundled asset — load via URL
              try {
                const img = await loadImg(`./vehicles/${def.files[dir]}`)
                setImg(img)
              } catch { /* not in bundle either */ }
              resolve()
            }),
        ),
      ),
    ).then(() => {
      if (!cancelled) setVehicleImages(newImages)
    })

    return () => { cancelled = true }
  }, [cityCatalog, projectCwd])

  // Vehicle simulation — reset when no layout
  useEffect(() => {
    if (!cityLayout) {
      vehicleSimRef.current.reset()
    }
  }, [cityLayout])

  // Auto-save layout on change (debounced) — catalog is read-only (managed by city-builder)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipCountRef = useRef(0)
  useEffect(() => {
    // Skip initial load
    if (skipCountRef.current < 1) {
      skipCountRef.current++
      return
    }
    if (!cityLayout || !activeCityId) return
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      saveCityLayout(cityLayout, activeCityId)
    }, 500)
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }
  }, [cityLayout, projectCwd, activeCityId])

  const handleEnterBuilding = useCallback(async (buildingUid: string) => {
    if (!cityLayout) return
    const placed = cityLayout.buildings.find(b => b.uid === buildingUid)
    if (!placed) return

    const localDir = buildingDirs[buildingUid]
    if (!localDir) {
      // No folder assigned — prompt user to assign one
      setPendingEnterMode('assign')
      setPendingEnterUid(buildingUid)
      return
    }
    // Check if the assigned folder still exists on disk
    const { exists } = await platform().building.dirExists(localDir) as any
    if (!exists) {
      // Folder was assigned but no longer exists
      setPendingEnterMode('not-found')
      setPendingEnterUid(buildingUid)
      return
    }
    handleOpenProject(localDir)
    window.location.hash = `#/building/${buildingUid}`
  }, [cityLayout, handleOpenProject, buildingDirs])

  const handleAssignDirConfirm = useCallback((workingDir: string) => {
    if (!pendingEnterUid || !cityLayout) { setPendingEnterUid(null); return }
    // Save directory mapping locally (machine-specific)
    const newDirs = { ...buildingDirs, [pendingEnterUid]: workingDir }
    setBuildingDirs(newDirs)
    platform().building.setDir(pendingEnterUid, workingDir)
    handleOpenProject(workingDir)
    setPendingEnterUid(null)
    window.location.hash = `#/building/${pendingEnterUid}`
  }, [pendingEnterUid, cityLayout, handleOpenProject, buildingDirs])

  // Persist zoom to localStorage (scoped per city)
  const handleZoomChange = useCallback((newZoom: number) => {
    setZoom(newZoom)
    try { localStorage.setItem(zoomKey, String(newZoom)) } catch {}
  }, [zoomKey])

  // Persist scroll position to localStorage (scoped per city)
  const handleScrollChange = useCallback((scroll: { x: number; y: number }) => {
    try { localStorage.setItem(scrollKey, JSON.stringify(scroll)) } catch {}
  }, [scrollKey])

  // Rename a building title (persisted in city layout → RTDB)
  const handleRenameBuilding = useCallback((buildingUid: string, newTitle: string) => {
    if (!cityLayout) return
    const newLayout: CityLayout = {
      ...cityLayout,
      buildings: cityLayout.buildings.map(b =>
        b.uid === buildingUid ? { ...b, title: newTitle } : b
      ),
    }
    setCityLayout(newLayout)
  }, [cityLayout])

  // Reassign folder — opens the assign directory dialog
  const handleReassignFolder = useCallback((buildingUid: string) => {
    setPendingEnterMode('assign')
    setPendingEnterUid(buildingUid)
  }, [])

  // Unassign folder — removes local directory mapping
  const handleUnassignFolder = useCallback((buildingUid: string) => {
    const newDirs = { ...buildingDirs }
    delete newDirs[buildingUid]
    setBuildingDirs(newDirs)
    platform().building.removeDir(buildingUid)
  }, [buildingDirs])

  // Remove an unassigned building from the city layout
  const handleRemoveBuilding = useCallback((buildingUid: string) => {
    if (!cityLayout) return
    if (cityLayout) editorStateRef.current.pushUndo(cityLayout)
    editorStateRef.current.clearRedo()
    const newLayout: CityLayout = {
      ...cityLayout,
      buildings: cityLayout.buildings.filter(b => b.uid !== buildingUid),
    }
    setCityLayout(newLayout)
    // Also clean up any local dir mapping
    const newDirs = { ...buildingDirs }
    delete newDirs[buildingUid]
    setBuildingDirs(newDirs)
    platform().building.removeDir(buildingUid)
  }, [cityLayout, buildingDirs])

  // Change a building's definition (swap its image/type)
  const handleChangeBuildingDef = useCallback((buildingUid: string, newDefId: string) => {
    if (!cityLayout) return
    editorStateRef.current.pushUndo(cityLayout)
    editorStateRef.current.clearRedo()
    const newLayout: CityLayout = {
      ...cityLayout,
      buildings: cityLayout.buildings.map(b =>
        b.uid === buildingUid ? { ...b, buildingDefId: newDefId } : b
      ),
    }
    setCityLayout(newLayout)
  }, [cityLayout])

  const handleRequestPlaceBuilding = useCallback((defId: string, col: number, row: number) => {
    setPendingPlacement({ defId, col, row })
  }, [])

  const handleConfirmPlacement = useCallback((title: string, description: string, workingDir: string, handle: string) => {
    if (!pendingPlacement || !cityLayout) { setPendingPlacement(null); return }
    const uid = `cb-${buildingUidCounterRef.current++}`
    // Place building without workingDir (metadata goes to RTDB, dir stays local)
    const newLayout = placeBuilding(cityLayout, uid, pendingPlacement.defId, pendingPlacement.col, pendingPlacement.row, title, description || undefined, undefined, handle || undefined)
    if (cityLayout) editorStateRef.current.pushUndo(cityLayout)
    editorStateRef.current.clearRedo()
    setCityLayout(newLayout)

    // Save directory mapping locally (machine-specific)
    if (workingDir) {
      const newDirs = { ...buildingDirs, [uid]: workingDir }
      setBuildingDirs(newDirs)
      platform().building.setDir(uid, workingDir)
    }

    setPendingPlacement(null)
  }, [pendingPlacement, cityLayout, buildingDirs])

  const handleCancelPlacement = useCallback(() => {
    setPendingPlacement(null)
  }, [])

  // Editor callbacks
  const handleLayoutChange = useCallback((newLayout: CityLayout) => {
    setCityLayout(newLayout)

  }, [])

  const handlePushUndo = useCallback(() => {
    if (cityLayout) {
      editorStateRef.current.pushUndo(cityLayout)
      editorStateRef.current.clearRedo()
    }
  }, [cityLayout])

  const handleToolChange = useCallback((tool: string) => {
    editorStateRef.current.activeTool = tool as any
    editorStateRef.current.clearGhost()
    editorStateRef.current.clearSelection()
    setActiveTool(tool)
  }, [])

  const handleTileTypeChange = useCallback((type: number) => {
    editorStateRef.current.selectedTileType = type as any
    setSelectedTileType(type)
  }, [])

  const handleBuildingDefChange = useCallback((defId: string) => {
    editorStateRef.current.selectedBuildingDefId = defId
    setSelectedBuildingDefId(defId)
  }, [])

  const es = editorStateRef.current

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', background: 'var(--bg)' }}>

      {cityLayout && (
        <>
          <CityEditorCanvas
            layout={cityLayout}
            catalog={cityCatalog}
            buildingImages={buildingImages}
            buildingDirs={buildingDirs}
            vehicleImages={vehicleImages}
            vehicleSim={vehicleSimRef.current}
            editorState={es}
            onLayoutChange={handleLayoutChange}
            onPushUndo={handlePushUndo}
            onEnterBuilding={handleEnterBuilding}
            onRequestPlaceBuilding={handleRequestPlaceBuilding}
            onRenameBuilding={handleRenameBuilding}
            onReassignFolder={handleReassignFolder}
            onUnassignFolder={handleUnassignFolder}
            onRemoveBuilding={handleRemoveBuilding}
            onChangeBuildingDef={handleChangeBuildingDef}
            zoom={zoom}
            onZoomChange={handleZoomChange}
            showGrid={showGrid}
            initialScroll={initialScroll}
            onScrollChange={handleScrollChange}
            buildingAgentSummaries={buildingAgentSummaries}
            transientStatusTagsRef={transientTagsRef}
          />
          <CityFolderSidebar
            layout={cityLayout}
            catalog={cityCatalog}
            buildingDirs={buildingDirs}
            buildingImages={buildingImages}
            onEnterBuilding={handleEnterBuilding}
            onRenameBuilding={handleRenameBuilding}
            onReassignFolder={handleReassignFolder}
            onUnassignFolder={handleUnassignFolder}
            onRemoveBuilding={handleRemoveBuilding}
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed(v => !v)}
          />
          <CityEditorToolbar
            activeTool={activeTool as any}
            selectedTileType={selectedTileType as any}
            selectedBuildingDefId={selectedBuildingDefId}
            catalog={cityCatalog}
            buildingImages={buildingImages}
            zoom={zoom}
            onZoomChange={handleZoomChange}
            onToolChange={handleToolChange}
            onTileTypeChange={handleTileTypeChange}
            onBuildingDefChange={handleBuildingDefChange}
            showGrid={showGrid}
            onToggleGrid={() => setShowGrid(v => !v)}
          />
          {pendingPlacement && (
            <CityBuildingInfoDialog
              buildingDefName={cityCatalog.buildings.find(b => b.id === pendingPlacement.defId)?.name || 'Building'}
              takenHandles={new Set((cityLayout.buildings ?? []).map(b => b.handle).filter((h): h is string => !!h))}
              onConfirm={handleConfirmPlacement}
              onCancel={handleCancelPlacement}
            />
          )}
          {pendingEnterUid && (
            <AssignDirectoryDialog
              buildingName={cityLayout.buildings.find(b => b.uid === pendingEnterUid)?.title || 'Building'}
              mode={pendingEnterMode}
              previousPath={pendingEnterMode === 'not-found' ? buildingDirs[pendingEnterUid] : undefined}
              onConfirm={handleAssignDirConfirm}
              onCancel={() => setPendingEnterUid(null)}
            />
          )}
        </>
      )}

      {/* Empty-state banner: no building has an assigned directory yet */}
      {cityLayout && buildingDirsLoaded && Object.keys(buildingDirs).length === 0 && (
        <div className="absolute top-[18px] left-1/2 -translate-x-1/2 z-[100] pointer-events-none">
          <div className="bg-bg-popup border-2 border-[#5ac88c] shadow-[3px_3px_0px_var(--bg-deep)] px-5 py-3 text-center font-ui text-text-bright">
            <div className="text-[15px] font-bold tracking-[0.02em] text-[rgba(200,255,220,0.95)]">
              Click on a building and assign a directory to get started
            </div>
          </div>
        </div>
      )}

      {/* Top-right controls: config */}
      <div className="absolute top-[10px] right-[10px] z-[50] flex items-center gap-[6px]">
        <button
          className="w-[32px] h-[32px] flex items-center justify-center bg-bg-popup border-2 border-border rounded-none text-text-muted cursor-pointer shadow-[2px_2px_0px_var(--bg-deep)] font-[inherit] hover:text-text-bright hover:border-[#6a6a8a]"
          title="City Instructions"
          onClick={() => setShowCityConfig(true)}
        >
          <MenuIcon />
        </button>
      </div>

      {/* City instructions dialog */}
      {showCityConfig && (
        <CityInstructionsDialog
          instructions={cityInstructions}
          canvasPreferences={canvasPreferences}
          onSave={handleSaveCityConfig}
          onClose={() => setShowCityConfig(false)}
        />
      )}
    </div>
  )
}

// ── Assign Directory Dialog ───────────────────────────────────

function AssignDirectoryDialog({ buildingName, mode, previousPath, onConfirm, onCancel }: {
  buildingName: string
  mode: 'assign' | 'not-found'
  previousPath?: string
  onConfirm: (workingDir: string) => void
  onCancel: () => void
}) {
  const [workingDir, setWorkingDir] = useState('')

  const handleBrowse = async () => {
    const folder = await platform().dialog.openFolder()
    if (folder) setWorkingDir(folder)
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onCancel])

  return (
    <div className="absolute inset-0 z-[200] bg-black/60 flex items-center justify-center" onClick={onCancel}>
      <div className="bg-bg-popup border-2 border-border shadow-[4px_4px_0px_var(--bg-deep)] w-[480px] max-w-[90%] max-w-[400px] font-ui text-text-bright animate-[instructions-dialog-in_0.1s_ease-out]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-white/8 text-[13px] font-bold tracking-[0.02em]">
          <span>{mode === 'not-found' ? 'Folder Not Found' : 'Assign Project Folder'}</span>
          <button className="bg-transparent border-none text-white/40 cursor-pointer text-sm px-1.5 py-0.5 font-ui hover:text-white/80" onClick={onCancel}>✕</button>
        </div>
        {mode === 'not-found' ? (
          <p className="px-3.5 pt-2.5 pb-0 m-0 text-[11px] text-white/45 leading-snug">
            The folder previously assigned to <strong>{buildingName}</strong> was not found:<br />
            <code style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', wordBreak: 'break-all' }}>{previousPath}</code><br />
            Please select a new directory for agents in this building.
          </p>
        ) : (
          <p className="px-3.5 pt-2.5 pb-0 m-0 text-[11px] text-white/45 leading-snug">
            <strong>{buildingName}</strong> doesn't have a project folder on this machine yet. Select the directory where agents in this building will work.
          </p>
        )}
        <div className="flex gap-[6px] items-center mx-3.5 my-2.5">
          <input
            className="flex-1 bg-bg-input border border-border text-text-bright px-[8px] py-[4px] text-[13px] outline-none"
            value={workingDir}
            readOnly
            placeholder="Select a folder..."
          />
          <button className="py-[5px] px-4 text-xs font-ui border-2 cursor-pointer bg-white/6 text-text-muted border-white/12 hover:bg-white/10 hover:text-white/80" onClick={handleBrowse}>Browse</button>
        </div>
        <div className="flex justify-end gap-2 px-3.5 py-2.5 border-t border-white/8">
          <button className="py-[5px] px-4 text-xs font-ui border-2 cursor-pointer bg-white/6 text-text-muted border-white/12 hover:bg-white/10 hover:text-white/80" onClick={onCancel}>Cancel</button>
          <button
            className="py-[5px] px-4 text-xs font-ui border-2 cursor-pointer bg-[rgba(90,200,140,0.15)] text-[rgba(200,255,220,0.95)] border-[#5ac88c] hover:bg-[rgba(90,200,140,0.25)] disabled:opacity-50"
            disabled={!workingDir.trim()}
            onClick={() => onConfirm(workingDir.trim())}
          >
            {mode === 'not-found' ? 'Reassign & Enter' : 'Assign & Enter'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── City Instructions Dialog ──────────────────────────────────

function CityInstructionsDialog({ instructions, canvasPreferences, onSave, onClose }: {
  instructions: string
  canvasPreferences: string
  onSave: (instructions: string, canvasPreferences: string) => void
  onClose: () => void
}) {
  const [text, setText] = useState(instructions)
  const [canvasPrefs, setCanvasPrefs] = useState(canvasPreferences)
  const cityRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    cityRef.current?.focus()
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const fieldClass = "block w-[calc(100%-28px)] mx-3.5 my-2.5 px-2.5 py-2 bg-bg-input border border-border text-text font-ui text-xs leading-relaxed resize-y min-h-[80px] focus:outline-none focus:border-accent placeholder:text-text-muted"

  return (
    <div className="absolute inset-0 z-[200] bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="bg-bg-popup border-2 border-border shadow-[4px_4px_0px_var(--bg-deep)] w-[480px] max-w-[90%] font-ui text-text-bright animate-[instructions-dialog-in_0.1s_ease-out]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-white/8 text-[13px] font-bold tracking-[0.02em]">
          <span>City Configuration</span>
          <button className="bg-transparent border-none text-white/40 cursor-pointer text-sm px-1.5 py-0.5 font-ui hover:text-white/80" onClick={onClose}>✕</button>
        </div>

        <p className="px-3.5 pt-2.5 pb-0 m-0 text-[11px] text-white/45 leading-snug">
          These instructions are included in the system prompt of every agent spawned in any office.
        </p>
        <textarea
          ref={cityRef}
          className={fieldClass}
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Enter city-wide instructions for all agents..."
          rows={5}
        />

        <div className="px-3.5 pt-3 pb-0 text-[12px] font-bold text-white/75 tracking-[0.02em] border-t border-white/8 mt-[4px]">
          Canvas Preferences <span className="font-normal text-white/30 text-[11px]">(optional)</span>
        </div>
        <p className="px-3.5 pt-2.5 pb-0 m-0 text-[11px] text-white/45 leading-snug">
          Design preferences for canvas rendering. Agents must read these before using set_canvas.
        </p>
        <textarea
          className={fieldClass}
          value={canvasPrefs}
          onChange={e => setCanvasPrefs(e.target.value)}
          placeholder="e.g. Use dark theme, rounded corners, Inter font, minimal design..."
          rows={4}
        />

        <div className="flex justify-end gap-2 px-3.5 py-2.5 border-t border-white/8">
          <button className="py-[5px] px-4 text-xs font-ui border-2 cursor-pointer bg-white/6 text-text-muted border-white/12 hover:bg-white/10 hover:text-white/80" onClick={onClose}>Cancel</button>
          <button className="py-[5px] px-4 text-xs font-ui border-2 cursor-pointer bg-[rgba(90,200,140,0.15)] text-[rgba(200,255,220,0.95)] border-[#5ac88c] hover:bg-[rgba(90,200,140,0.25)]" onClick={() => onSave(text, canvasPrefs)}>Save</button>
        </div>
      </div>
    </div>
  )
}
