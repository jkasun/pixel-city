/**
 * FullOfficeView — THE single shared office component for both desktop and web.
 *
 * Canvas, minimap, agent labels, zoom, floor tabs, agent card, instructions —
 * all built in. Platform-specific features (editor, floor generator, permanent
 * employees, character picker) are plugged in via slot props + callbacks.
 *
 * Internal state is exposed via a forwarded ref so consuming apps can drive
 * advanced features (editor mode, permanent employee logic, etc.).
 */

import React, { useRef, useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'
import { getOfficeStore } from '../office/index.js'
import type { OfficeAgent, FloorEntry } from '../office/types.js'
import { OfficeState } from '@pixel-city/shared/office/engine/officeState'
import { startGameLoop } from '@pixel-city/shared/office/engine/gameLoop'
import { renderFrame } from '@pixel-city/shared/office/engine/renderer'
import type { SelectionRenderState } from '@pixel-city/shared/office/engine/renderer'
import { TILE_SIZE } from '@pixel-city/shared/office/types'
import type { OfficeLayout, Character } from '@pixel-city/shared/office/types'
import { loadAllAssets } from '@pixel-city/shared/assetLoader'
import { buildDynamicCatalog } from '@pixel-city/shared/office/layout/furnitureCatalog'
import {
  setupCanvas,
  scalePanDelta,
} from '@pixel-city/shared/office/canvas/canvasUtils'
import {
  handleOfficeWheel,
  handleOfficeClick,
  handleOfficeContextMenu,
  handleOfficeHover,
  handleOfficeMouseDown,
  handleOfficeMouseLeave,
  type InteractionRefs,
  type PanState,
} from '@pixel-city/shared/office/canvas/interactionHandlers'
import {
  CAMERA_FOLLOW_LERP,
  CAMERA_FOLLOW_SNAP_THRESHOLD,
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_DEFAULT_DPR_FACTOR,
  PAN_MARGIN_FRACTION,
  PULSE_ANIMATION_DURATION_SEC,
} from '@pixel-city/shared/constants'

import { MiniMap } from './MiniMap.js'
import { AgentLabels } from './AgentLabels.js'
import { ZoomControls } from './ZoomControls.js'
import { OfficeInstructionsDialog } from './OfficeInstructionsDialog.js'
import { OfficeSettingsDialog, DEFAULT_PLUGIN_SETTINGS, type OfficePluginSettings } from './OfficeSettingsDialog.js'

// ── Helpers ─────────────────────────────────────────────────────

export function normalizeLayout(data: any): OfficeLayout {
  if (!data || typeof data !== 'object') return data
  const len = (data.cols ?? 0) * (data.rows ?? 0)
  if (!Array.isArray(data.tiles)) data.tiles = []
  if (data.tiles.length < len) {
    const padded = new Array(len).fill(0)
    for (let i = 0; i < data.tiles.length; i++) padded[i] = data.tiles[i] ?? 0
    data.tiles = padded
  }
  return data as OfficeLayout
}

const RE_READING = /^Reading/i
const RE_SEARCHING = /^Searching|^Fetching web|^Searching the web/i

function detectTool(status: string): 'Read' | 'Grep' | 'Write' {
  if (RE_READING.test(status)) return 'Read'
  if (RE_SEARCHING.test(status)) return 'Grep'
  return 'Write'
}

// ── Styles ──────────────────────────────────────────────────────

export const btnBase: React.CSSProperties = {
  padding: '5px 10px',
  fontSize: '14px',
  color: 'var(--text)',
  background: 'var(--bg-hover)',
  border: '2px solid transparent',
  borderRadius: 0,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const btnAgent: React.CSSProperties = {
  ...btnBase,
  background: 'rgba(90, 200, 140, 0.15)',
  border: '2px solid #5ac88c',
  color: 'var(--text-bright)',
}

const agentInfoStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 10,
  right: 10,
  zIndex: 50,
  background: 'var(--bg-popup)',
  border: '2px solid var(--border)',
  borderRadius: 0,
  padding: '8px 12px',
  boxShadow: '2px 2px 0px var(--bg-deep)',
  color: 'var(--text)',
  fontSize: '14px',
  fontFamily: 'inherit',
  minWidth: 180,
}

// ── Ref handle ──────────────────────────────────────────────────

/** Exposed to consuming apps via React ref for advanced features. */
export interface FullOfficeViewHandle {
  /** The live OfficeState instance. null until ready. */
  officeState: OfficeState | null
  /** Current zoom level */
  zoom: number
  /** Set zoom level */
  setZoom: (z: number) => void
  /** Mutable pan offset */
  panRef: React.MutableRefObject<{ x: number; y: number }>
  /** The outer container div */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** Currently selected agent ID */
  selectedId: string | null
  /** Current floor list */
  floors: FloorEntry[]
  /** Active floor ID */
  activeFloorId: string
  /** Update floors */
  setFloors: (floors: FloorEntry[]) => void
  /** Switch active floor ID (state only — does NOT load layout) */
  setActiveFloorId: (id: string) => void
  /** Update selection */
  setSelectedId: (id: string | null) => void
  /** Force re-render */
  forceUpdate: () => void
}

// ── Props ───────────────────────────────────────────────────────

export interface FullOfficeViewProps {
  buildingId: string
  buildingName?: string
  agents: OfficeAgent[]
  /** Map of agentId → current status text */
  agentStatusMap?: Map<string, string>
  /** Map of agentId → worker status (idle/working/tool) */
  agentWorkerStatusMap?: Map<string, 'idle' | 'working' | 'tool'>

  // ── Externally managed state (optional) ─────────────────────
  /**
   * When provided, FullOfficeView uses this OfficeState instead of creating
   * its own. The consumer is responsible for init, agent sync, floor stash, etc.
   * Implies `ready=true` — no internal loading/init runs.
   */
  officeState?: OfficeState | null
  /** Initial floor list when using external officeState */
  initialFloors?: FloorEntry[]
  /** Initial active floor ID when using external officeState */
  initialActiveFloorId?: string

  // ── Core callbacks ──────────────────────────────────────────
  /** Called when an agent is clicked in the canvas */
  onAgentSelect?: (agentId: string | null) => void
  /** Called when "+ Agent" button is clicked */
  onAddAgent?: () => void
  /** Called when "Remove" button is clicked for an agent */
  onRemoveAgent?: (agentId: string) => void

  // ── Floor callbacks ─────────────────────────────────────────
  /** Load floor list for this building. If not provided, single default floor. */
  onLoadFloors?: (buildingId: string) => Promise<FloorEntry[]>
  /** Load layout for a specific floor. If not provided, floor switching is disabled. */
  onLoadFloorLayout?: (buildingId: string, floorId: string) => Promise<OfficeLayout | null>
  /** Save updated floor list (e.g. after rename). */
  onSaveFloors?: (buildingId: string, floors: FloorEntry[]) => Promise<void>
  /**
   * Custom floor switch handler. When provided, replaces the default floor
   * switch logic entirely (stash/restore characters, permanent employees, etc.).
   * Must call the provided setActiveFloorId when done.
   */
  onSwitchFloor?: (floorId: string, setActiveFloorId: (id: string) => void) => Promise<void>

  // ── Instructions ────────────────────────────────────────────
  /** Current office instructions text */
  officeInstructions?: string
  /** Called when instructions are saved. If provided, shows the config button. */
  onSaveInstructions?: (text: string) => void
  /** Called when the user wants to edit the .md file directly in their OS editor. */
  onOpenInstructionsFile?: () => void

  // ── Plugin toggles ──────────────────────────────────────────
  /** Current per-office plugin enable/disable state. */
  pluginSettings?: OfficePluginSettings
  /** Called when plugin settings are saved. If provided, shows the settings gear button. */
  onSavePluginSettings?: (settings: OfficePluginSettings) => void

  /** Externally-driven selection (e.g. from agent sidebar) */
  externalSelectedId?: string | null

  // ── Canvas override ─────────────────────────────────────────
  /**
   * Replace the default canvas with a custom component (e.g. OfficeCanvas with
   * editor support). Receives officeState, zoom, panRef, and containerRef.
   */
  renderCanvas?: (props: {
    officeState: OfficeState
    zoom: number
    panRef: React.MutableRefObject<{ x: number; y: number }>
    containerRef: React.RefObject<HTMLDivElement | null>
    onZoomChange: (z: number) => void
    onAgentClick: (agentId: string) => void
  }) => React.ReactNode

  // ── Slot props — plug in platform-specific UI ───────────────

  /** Extra buttons injected into the top-right nav group (e.g. Edit, ?, Tutorial) */
  navRightExtra?: React.ReactNode
  /** Extra items after floor tabs (e.g. "+ Floor" button) */
  floorNavExtra?: React.ReactNode
  /** Extra actions in the agent info card (e.g. Hire, Fire buttons) */
  agentCardExtra?: (selectedAgent: Character | null, selectedId: string | null) => React.ReactNode
  /** Replace the default agent info card entirely */
  agentCardOverride?: (selectedAgent: Character | null, selectedId: string | null, agentCount: number) => React.ReactNode
  /** Overlays rendered inside the container (modals, editor toolbar, character picker, etc.) */
  children?: React.ReactNode

  /** When true, hides agent labels, minimap, vignette, agent card (editor mode) */
  isEditMode?: boolean
}

// ── Component ───────────────────────────────────────────────────

export const FullOfficeView = forwardRef<FullOfficeViewHandle, FullOfficeViewProps>(
  function FullOfficeView(props, ref) {
    const {
      buildingId,
      buildingName,
      agents,
      agentStatusMap,
      agentWorkerStatusMap,
      officeState: externalOfficeState,
      initialFloors: initialFloorsProp,
      initialActiveFloorId: initialActiveFloorIdProp,
      onAgentSelect,
      onAddAgent,
      onRemoveAgent,
      onLoadFloors,
      onLoadFloorLayout,
      onSaveFloors,
      onSwitchFloor,
      officeInstructions: instructionsProp = '',
      onSaveInstructions,
      onOpenInstructionsFile,
      pluginSettings,
      onSavePluginSettings,
      externalSelectedId,
      renderCanvas,
      navRightExtra,
      floorNavExtra,
      agentCardExtra,
      agentCardOverride,
      children,
      isEditMode = false,
    } = props

    const isExternallyManaged = externalOfficeState !== undefined

    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const officeRef = useRef<OfficeState | null>(null)
    const offsetRef = useRef({ x: 0, y: 0 })
    const panRef = useRef({ x: 0, y: 0 })
    const isPanningRef = useRef(false)
    const panStartRef = useRef({ mouseX: 0, mouseY: 0, panX: 0, panY: 0 })
    const panStateRef = useRef<PanState | null>(null)
    const didDragRef = useRef(false)
    const zoomAccRef = useRef(0)

    const [zoom, setZoom] = useState(() => Math.round(ZOOM_DEFAULT_DPR_FACTOR * (window.devicePixelRatio || 1)))
    const [ready, setReady] = useState(isExternallyManaged && externalOfficeState !== null)
    const [error, setError] = useState<string | null>(null)
    const [, setTick] = useState(0)

    // Selection
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const lastExternalIdRef = useRef<string | null | undefined>(undefined)

    // Floors
    const [floors, setFloors] = useState<FloorEntry[]>(initialFloorsProp ?? [])
    const [activeFloorId, setActiveFloorId] = useState(initialActiveFloorIdProp ?? 'floor-0')
    const [switching, setSwitching] = useState(false)
    const [renamingFloorId, setRenamingFloorId] = useState<string | null>(null)
    const [renameValue, setRenameValue] = useState('')

    // Office instructions
    const [showOfficeConfig, setShowOfficeConfig] = useState(false)
    const [showOfficeSettings, setShowOfficeSettings] = useState(false)

    // Sync external officeState into officeRef
    useEffect(() => {
      if (isExternallyManaged) {
        officeRef.current = externalOfficeState ?? null
        if (externalOfficeState && !ready) setReady(true)
      }
    }, [externalOfficeState, isExternallyManaged])

    // Sync initial floors/activeFloorId when externally managed
    useEffect(() => {
      if (isExternallyManaged && initialFloorsProp) setFloors(initialFloorsProp)
    }, [isExternallyManaged, initialFloorsProp])

    useEffect(() => {
      if (isExternallyManaged && initialActiveFloorIdProp) setActiveFloorId(initialActiveFloorIdProp)
    }, [isExternallyManaged, initialActiveFloorIdProp])

    // ── Expose handle via ref ─────────────────────────────────

    useImperativeHandle(ref, () => ({
      get officeState() { return officeRef.current },
      get zoom() { return zoom },
      setZoom,
      panRef,
      containerRef,
      get selectedId() { return selectedId },
      get floors() { return floors },
      get activeFloorId() { return activeFloorId },
      setFloors,
      setActiveFloorId,
      setSelectedId,
      forceUpdate: () => setTick(n => n + 1),
    }))

    // ── Load assets + layout (only for self-managed mode) ─────

    useEffect(() => {
      if (isExternallyManaged) return
      let cancelled = false

      async function init() {
        try {
          const furnitureData = await loadAllAssets()
          if (furnitureData) buildDynamicCatalog(furnitureData)

          let layout: OfficeLayout | null = null
          try {
            const store = getOfficeStore()
            layout = await store.loadLayout(buildingId)
            if (layout) layout = normalizeLayout(layout)
          } catch (err) {
            console.warn('[FullOfficeView] Failed to load layout:', err)
          }

          // Load floors
          let loadedFloors: FloorEntry[] = [{ id: 'floor-0', name: 'Floor 1' }]
          if (onLoadFloors) {
            try {
              const result = await onLoadFloors(buildingId)
              if (result.length > 0) loadedFloors = result
            } catch { /* ignore */ }
          }

          if (cancelled) return

          const os = layout ? new OfficeState(layout) : new OfficeState()
          officeRef.current = os
          setFloors(loadedFloors)
          setActiveFloorId(loadedFloors[0].id)
          setReady(true)
        } catch (err: any) {
          console.error('[FullOfficeView] Init failed:', err)
          if (!cancelled) setError(err.message ?? 'Failed to initialize office')
        }
      }

      init()
      return () => { cancelled = true }
    }, [buildingId])

    // ── Sync agents → office characters (self-managed only) ───

    useEffect(() => {
      if (isExternallyManaged) return
      const os = officeRef.current
      if (!os || !ready) return

      const currentIds = new Set(os.characters.keys())
      const remoteIds = new Set(agents.filter(a => a.active).map(a => a.agentId))

      for (const agent of agents) {
        if (!agent.active) continue
        if (!currentIds.has(agent.agentId)) {
          os.addAgent(agent.agentId, undefined, undefined, undefined, true, undefined, agent.model, agent.name)
        }
        if (agent.status) {
          os.setAgentStatusText(agent.agentId, agent.status)
          os.setAgentActive(agent.agentId, true)
          os.setAgentTool(agent.agentId, detectTool(agent.status))
        } else {
          os.setAgentActive(agent.agentId, false)
          os.setAgentTool(agent.agentId, null)
          os.setAgentStatusText(agent.agentId, null)
        }
      }

      for (const id of currentIds) {
        if (!remoteIds.has(id)) {
          os.removeAgent(id)
        }
      }
    }, [agents, ready, isExternallyManaged])

    // ── Sync agent status from maps (self-managed only) ──────

    useEffect(() => {
      if (isExternallyManaged) return
      if (!ready || !agentStatusMap) return
      const os = officeRef.current
      if (!os) return

      for (const [id, ch] of os.characters) {
        const status = agentStatusMap.get(id)
        const workerStatus = agentWorkerStatusMap?.get(id)
        os.setAgentStatusText(id, status ?? null)
        if (status) {
          os.setAgentActive(id, true)
          os.setAgentTool(id, detectTool(status))
        }
        if (workerStatus) {
          ch.workerStatus = workerStatus
        }
      }
    }, [agentStatusMap, agentWorkerStatusMap, ready, isExternallyManaged])

    // ── External selection sync ──────────────────────────────

    useEffect(() => {
      if (externalSelectedId === undefined) return
      const id = externalSelectedId ?? null
      lastExternalIdRef.current = id
      const os = officeRef.current
      if (!os) return
      os.selectedAgentId = id
      os.cameraFollowId = id
      setSelectedId(id)
    }, [externalSelectedId])

    // ── Poll for selection changes ───────────────────────────

    useEffect(() => {
      if (!ready) return
      const interval = setInterval(() => {
        const os = officeRef.current
        if (!os) return
        const id = os.selectedAgentId
        setSelectedId(prev => prev !== id ? id : prev)
        if (id !== lastExternalIdRef.current) {
          lastExternalIdRef.current = id
          onAgentSelect?.(id)
        }
      }, 100)
      return () => clearInterval(interval)
    }, [ready, onAgentSelect])

    // ── Canvas resize ─────────────────────────────────────────

    const resizeCanvas = useCallback(() => {
      const canvas = canvasRef.current
      const container = containerRef.current
      if (!canvas || !container) return
      setupCanvas(canvas, container)
    }, [])

    // ── Pan clamping ──────────────────────────────────────────

    const clampPan = useCallback((px: number, py: number) => {
      const canvas = canvasRef.current
      const os = officeRef.current
      if (!canvas || !os) return { x: px, y: py }
      const layout = os.getLayout()
      const mapW = layout.cols * TILE_SIZE * zoom
      const mapH = layout.rows * TILE_SIZE * zoom
      const mX = canvas.width * PAN_MARGIN_FRACTION
      const mY = canvas.height * PAN_MARGIN_FRACTION
      const maxX = (mapW / 2) + canvas.width / 2 - mX
      const maxY = (mapH / 2) + canvas.height / 2 - mY
      return {
        x: Math.max(-maxX, Math.min(maxX, px)),
        y: Math.max(-maxY, Math.min(maxY, py)),
      }
    }, [zoom])

    // ── Game loop (only when using built-in canvas) ────────────

    useEffect(() => {
      if (renderCanvas) return // Custom canvas handles its own game loop
      const canvas = canvasRef.current
      const os = officeRef.current
      if (!canvas || !os || !ready) return

      resizeCanvas()
      const observer = new ResizeObserver(() => resizeCanvas())
      if (containerRef.current) observer.observe(containerRef.current)

      const stop = startGameLoop(canvas, {
        update: (dt) => os.update(dt),
        render: (ctx) => {
          const w = canvas.width
          const h = canvas.height

          if (os.cameraFollowId !== null) {
            const ch = os.characters.get(os.cameraFollowId)
            if (ch) {
              const layout = os.getLayout()
              const mapW = layout.cols * TILE_SIZE * zoom
              const mapH = layout.rows * TILE_SIZE * zoom
              const tX = mapW / 2 - ch.x * zoom
              const tY = mapH / 2 - ch.y * zoom
              const dx = tX - panRef.current.x
              const dy = tY - panRef.current.y
              if (Math.abs(dx) < CAMERA_FOLLOW_SNAP_THRESHOLD && Math.abs(dy) < CAMERA_FOLLOW_SNAP_THRESHOLD) {
                panRef.current = { x: tX, y: tY }
              } else {
                panRef.current = {
                  x: panRef.current.x + dx * CAMERA_FOLLOW_LERP,
                  y: panRef.current.y + dy * CAMERA_FOLLOW_LERP,
                }
              }
            }
          }

          const selectionRender: SelectionRenderState = {
            selectedAgentId: os.selectedAgentId,
            hoveredAgentId: os.hoveredAgentId,
            hoveredTile: os.hoveredTile,
            seats: os.seats,
            characters: os.characters,
          }

          const { offsetX, offsetY } = renderFrame(
            ctx, w, h,
            os.tileMap,
            os.furniture,
            os.getCharacters(),
            zoom,
            panRef.current.x,
            panRef.current.y,
            selectionRender,
            undefined,
            os.getLayout().tileColors,
            os.getLayout().cols,
            os.getLayout().rows,
          )
          offsetRef.current = { x: offsetX, y: offsetY }
        },
      })

      return () => {
        stop()
        observer.disconnect()
      }
    }, [ready, zoom, resizeCanvas])

    // ── Interaction refs helper ─────────────────────────────────

    const getInteractionRefs = useCallback((): InteractionRefs | null => {
      const canvas = canvasRef.current
      const os = officeRef.current
      if (!canvas || !os) return null
      return { canvas, offset: offsetRef.current, pan: panRef.current, zoom }
    }, [zoom])

    // ── Mouse handlers (shared normal-mode behaviour) ──────────

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
      const os = officeRef.current
      const refs = getInteractionRefs()
      if (!os || !refs) return

      // Middle-click: start panning
      const ps = handleOfficeMouseDown(e.button, e.clientX, e.clientY, refs, os)
      if (ps) {
        e.preventDefault()
        isPanningRef.current = true
        panStateRef.current = ps
        return
      }

      // Left-click: track for click vs drag detection
      if (e.button === 0) {
        didDragRef.current = false
        panStartRef.current = { mouseX: e.clientX, mouseY: e.clientY, panX: 0, panY: 0 }
      }
    }, [getInteractionRefs])

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
      // Middle-button panning
      if (isPanningRef.current && panStateRef.current) {
        const dx = scalePanDelta(e.clientX - panStateRef.current.mouseX)
        const dy = scalePanDelta(e.clientY - panStateRef.current.mouseY)
        panRef.current = clampPan(panStateRef.current.panX + dx, panStateRef.current.panY + dy)
        return
      }

      // Track drag distance for left-click
      if (panStartRef.current.mouseX !== 0 || panStartRef.current.mouseY !== 0) {
        const dx = Math.abs(e.clientX - panStartRef.current.mouseX)
        const dy = Math.abs(e.clientY - panStartRef.current.mouseY)
        if (dx > 4 || dy > 4) didDragRef.current = true
      }

      // Hover detection via shared handler
      const os = officeRef.current
      const refs = getInteractionRefs()
      if (!os || !refs) return
      handleOfficeHover(e.clientX, e.clientY, refs, os)
    }, [clampPan, getInteractionRefs])

    const handleMouseUp = useCallback((e: React.MouseEvent) => {
      // End middle-button panning
      if (e.button === 1 && isPanningRef.current) {
        isPanningRef.current = false
        panStateRef.current = null
        const canvas = canvasRef.current
        if (canvas) canvas.style.cursor = 'default'
        return
      }

      if (e.button !== 0) return

      // Skip if we dragged
      if (didDragRef.current) {
        didDragRef.current = false
        panStartRef.current = { mouseX: 0, mouseY: 0, panX: 0, panY: 0 }
        return
      }
      panStartRef.current = { mouseX: 0, mouseY: 0, panX: 0, panY: 0 }

      // Delegate to shared click handler
      const os = officeRef.current
      const refs = getInteractionRefs()
      if (!os || !refs) return
      handleOfficeClick(e.clientX, e.clientY, refs, os, {
        onAgentClick: (id) => { onAgentSelect?.(id); setTick(n => n + 1) },
      })
      setTick(n => n + 1) // force re-render for deselection too
    }, [getInteractionRefs, onAgentSelect])

    const handleContextMenu = useCallback((e: React.MouseEvent) => {
      e.preventDefault()
      const os = officeRef.current
      const refs = getInteractionRefs()
      if (!os || !refs) return
      handleOfficeContextMenu(e.clientX, e.clientY, refs, os)
    }, [getInteractionRefs])

    const handleWheel = useCallback((e: React.WheelEvent) => {
      if (e.cancelable) e.preventDefault()
      const os = officeRef.current
      const refs = getInteractionRefs()
      if (!os || !refs) return
      handleOfficeWheel(
        e.deltaX, e.deltaY, e.ctrlKey || e.metaKey,
        refs, os, zoomAccRef,
        clampPan,
        (newZoom) => setZoom(newZoom),
      )
    }, [getInteractionRefs, clampPan])

    const handleMouseLeave = useCallback(() => {
      isPanningRef.current = false
      panStateRef.current = null
      const os = officeRef.current
      if (os) handleOfficeMouseLeave(os)
    }, [])

    // ── Zoom ──────────────────────────────────────────────────

    const handleZoomChange = useCallback((z: number) => {
      setZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)))
    }, [])

    // ── MiniMap pan ───────────────────────────────────────────

    const handleMiniMapPan = useCallback((px: number, py: number) => {
      panRef.current = { x: px, y: py }
    }, [])

    // ── Floor switching ───────────────────────────────────────

    const handleSwitchFloor = useCallback(async (floorId: string) => {
      if (floorId === activeFloorId || switching) return
      setSwitching(true)

      if (onSwitchFloor) {
        // Custom floor switch — consumer handles stash/restore, layout loading, etc.
        await onSwitchFloor(floorId, setActiveFloorId)
      } else if (onLoadFloorLayout) {
        // Default floor switch — just load the layout
        try {
          const layout = await onLoadFloorLayout(buildingId, floorId)
          if (layout) {
            const os = officeRef.current
            if (os) os.rebuildFromLayout(normalizeLayout(layout))
          }
        } catch (err) {
          console.warn('[FullOfficeView] Failed to load floor layout:', err)
        }
        setActiveFloorId(floorId)
      }

      panRef.current = { x: 0, y: 0 }
      setSelectedId(null)
      setSwitching(false)
      setTick(n => n + 1)
    }, [activeFloorId, buildingId, switching, onLoadFloorLayout, onSwitchFloor])

    // ── Floor rename ──────────────────────────────────────────

    const handleStartRename = useCallback((floor: FloorEntry) => {
      setRenamingFloorId(floor.id)
      setRenameValue(floor.name)
    }, [])

    const handleCommitRename = useCallback(async () => {
      if (!renamingFloorId) return
      const trimmed = renameValue.trim()
      if (!trimmed) { setRenamingFloorId(null); return }
      const updatedFloors = floors.map(f => f.id === renamingFloorId ? { ...f, name: trimmed } : f)
      setFloors(updatedFloors)
      setRenamingFloorId(null)
      try {
        await onSaveFloors?.(buildingId, updatedFloors)
      } catch { /* ignore */ }
    }, [renamingFloorId, renameValue, floors, buildingId, onSaveFloors])

    // ── Agent actions ─────────────────────────────────────────

    const handleRemoveAgent = useCallback(() => {
      if (selectedId === null) return
      const os = officeRef.current
      if (!os) return
      os.removeAgent(selectedId)
      onRemoveAgent?.(selectedId)
      os.selectedAgentId = null
      os.cameraFollowId = null
      setSelectedId(null)
      setTick(n => n + 1)
    }, [selectedId, onRemoveAgent])

    // ── Instructions ──────────────────────────────────────────

    const handleSaveInstructions = useCallback((text: string) => {
      onSaveInstructions?.(text)
      setShowOfficeConfig(false)
    }, [onSaveInstructions])

    // ── Render ────────────────────────────────────────────────

    if (error) {
      return (
        <div style={{
          width: '100%', height: '100%', display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: 'var(--text-dim)', fontSize: 12,
        }}>
          <span>Failed to load office: {error}</span>
        </div>
      )
    }

    if (!ready) {
      return (
        <div style={{
          width: '100%', height: '100%', display: 'flex', alignItems: 'center',
          justifyContent: 'center',
        }}>
          <div className="pc-loader">
            <div className="pc-loader-dots">
              <div className="pc-loader-dot" />
              <div className="pc-loader-dot" />
              <div className="pc-loader-dot" />
            </div>
            <span className="pc-loader-text">loading office</span>
          </div>
        </div>
      )
    }

    const os = officeRef.current!
    const selectedCh = selectedId !== null ? os.characters.get(selectedId) ?? null : null
    const agentCount = os.characters.size
    const displayName = buildingName ?? buildingId

    return (
      <div data-testid="office-view" ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
        <style>{`
          @keyframes pixel-agents-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
          }
          .pixel-agents-pulse { animation: pixel-agents-pulse ${PULSE_ANIMATION_DURATION_SEC}s ease-in-out infinite; }
          @keyframes pc-floor-spin {
            to { transform: rotate(360deg); }
          }
        `}</style>

        {/* Floor-switching overlay */}
        {switching && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 80,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 10, pointerEvents: 'none',
          }}>
            <div style={{
              width: 28, height: 28, border: '3px solid rgba(255,255,255,0.15)',
              borderTopColor: 'var(--accent, #5ac8e8)',
              borderRadius: '50%',
              animation: 'pc-floor-spin 0.7s linear infinite',
            }} />
            <span style={{ fontSize: '12px', color: 'var(--text-dim, rgba(255,255,255,0.5))', letterSpacing: '0.05em' }}>
              switching floor…
            </span>
          </div>
        )}

        {/* Canvas — custom or built-in */}
        {renderCanvas ? (
          renderCanvas({
            officeState: os,
            zoom,
            panRef,
            containerRef,
            onZoomChange: handleZoomChange,
            onAgentClick: (id) => { setTick(n => n + 1) },
          })
        ) : (
          <canvas
            data-testid="office-canvas"
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            onContextMenu={handleContextMenu}
            onWheel={handleWheel}
            style={{ width: '100%', height: '100%', display: 'block' }}
          />
        )}

        {/* Zoom controls */}
        <ZoomControls zoom={zoom} onZoomChange={handleZoomChange} />

        {/* Agent status labels (hidden in edit mode) */}
        {!isEditMode && (
          <AgentLabels
            officeState={os}
            agentStatusMap={agentStatusMap ?? new Map()}
            agentWorkerStatusMap={agentWorkerStatusMap ?? new Map()}
            containerRef={containerRef}
            zoom={zoom}
            panRef={panRef}
          />
        )}

        {/* Top navigation bar */}
        <div style={{
          position: 'absolute', top: 8, left: 8, right: 8, zIndex: 50,
          display: 'flex', alignItems: 'center', gap: 4, pointerEvents: 'none',
        }}>
          {/* Left: building name + floor tabs + floorNavExtra */}
          <div data-testid="office-floor-nav" style={{ display: 'flex', alignItems: 'center', gap: 4, pointerEvents: 'auto' }}>
            <div style={{
              fontSize: '12px', padding: '4px 8px',
              color: 'var(--text-dim)', fontFamily: 'inherit', userSelect: 'none',
            }}>
              {displayName}
            </div>

            {floors.length > 0 && (
              <>
                <div style={{ width: 1, height: 18, background: 'var(--border)', flexShrink: 0 }} />
                {floors.map(floor => (
                  renamingFloorId === floor.id ? (
                    <input
                      key={floor.id}
                      autoFocus
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={handleCommitRename}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleCommitRename()
                        if (e.key === 'Escape') setRenamingFloorId(null)
                      }}
                      style={{
                        fontSize: '12px', padding: '3px 7px',
                        background: 'var(--bg-card)', border: '2px solid var(--accent)',
                        color: 'var(--text-bright)', fontFamily: 'inherit', outline: 'none',
                        width: Math.max(60, renameValue.length * 8) + 'px', minWidth: 60,
                      }}
                    />
                  ) : (
                    <button
                      key={floor.id}
                      data-testid={`office-floor-tab-${floor.id}`}
                      onClick={() => handleSwitchFloor(floor.id)}
                      onDoubleClick={() => handleStartRename(floor)}
                      disabled={switching}
                      style={{
                        ...btnBase,
                        fontSize: '12px', padding: '4px 8px',
                        background: activeFloorId === floor.id ? 'var(--bg-card)' : 'var(--bg-hover)',
                        border: activeFloorId === floor.id ? '2px solid var(--accent)' : '2px solid var(--border)',
                        color: activeFloorId === floor.id ? 'var(--text-bright)' : 'var(--text-muted)',
                        opacity: switching ? 0.5 : 1,
                      }}
                      title="Double-click to rename"
                    >
                      {floor.name}
                    </button>
                  )
                ))}
                {floorNavExtra}
              </>
            )}
          </div>

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Right: config button + navRightExtra */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, pointerEvents: 'auto' }}>
            {!isEditMode && onSaveInstructions && (
              <button
                data-testid="office-instructions-btn"
                title="Office Instructions"
                onClick={() => setShowOfficeConfig(true)}
                style={{
                  ...btnBase,
                  width: 32, height: 32, padding: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '2px solid var(--border)',
                }}
              >
                <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="2" y1="4" x2="14" y2="4" />
                  <line x1="2" y1="8" x2="14" y2="8" />
                  <line x1="2" y1="12" x2="14" y2="12" />
                </svg>
              </button>
            )}
            {!isEditMode && onSavePluginSettings && (
              <button
                data-testid="office-settings-btn"
                title="Office Settings"
                onClick={() => setShowOfficeSettings(true)}
                style={{
                  ...btnBase,
                  width: 32, height: 32, padding: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '2px solid var(--border)',
                }}
              >
                <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="6" y1="1.5" x2="6" y2="5" />
                  <line x1="10" y1="1.5" x2="10" y2="5" />
                  <rect x="3.5" y="5" width="9" height="5.5" rx="1" />
                  <path d="M8 10.5 V 14.5" />
                </svg>
              </button>
            )}
            {navRightExtra}
          </div>
        </div>

        {/* Vignette overlay (hidden in edit mode) */}
        {!isEditMode && (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'radial-gradient(ellipse at center, transparent 50%, rgba(0, 0, 0, 0.6) 100%)',
            pointerEvents: 'none', zIndex: 40,
          }} />
        )}

        {/* Mini map (hidden in edit mode) */}
        {!isEditMode && (
          <MiniMap
            officeState={os}
            zoom={zoom}
            panRef={panRef}
            containerRef={containerRef}
            onPanTo={handleMiniMapPan}
          />
        )}

        {/* Agent info card (bottom-right, hidden in edit mode) */}
        {!isEditMode && (
          agentCardOverride ? (
            <div data-testid="office-agent-card" style={agentInfoStyle}>
              {agentCardOverride(selectedCh, selectedId, agentCount)}
            </div>
          ) : (
            <div data-testid="office-agent-card" style={agentInfoStyle}>
              {selectedCh ? (
                <>
                  {selectedCh.isPermanent && (
                    <div style={{ color: 'var(--accent-warn, #f0c040)', fontSize: '11px', marginBottom: 4, letterSpacing: '0.03em' }}>
                      ★ Permanent Employee
                    </div>
                  )}
                  <div style={{ marginBottom: 4, color: 'var(--text-bright)', fontWeight: 'bold' }}>
                    {selectedCh.name ?? `Agent #${selectedId}`}
                  </div>
                  {selectedCh.role && (
                    <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginBottom: 4 }}>
                      {selectedCh.role}
                    </div>
                  )}
                  <div>Status: {selectedCh.isActive ? 'Working' : 'Idle'}</div>
                  {selectedCh.model && (
                    <div style={{ color: selectedCh.model === 'opus' ? '#c87aff' : '#5ac8e8', fontSize: '12px' }}>
                      {selectedCh.model === 'opus' ? 'Opus' : 'Sonnet'}
                    </div>
                  )}
                  {selectedCh.currentTool && <div>Tool: {selectedCh.currentTool}</div>}
                  <div style={{ marginTop: 6, fontSize: '12px', color: 'var(--text-dim)' }}>
                    Right-click a tile to move
                  </div>
                  {/* Default agent actions + extras */}
                  <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                    {agentCardExtra?.(selectedCh, selectedId)}
                    {onRemoveAgent && !selectedCh.isPermanent && (
                      <button
                        data-testid="office-agent-remove-btn"
                        onClick={handleRemoveAgent}
                        style={{ ...btnBase, fontSize: '11px', padding: '3px 8px', color: '#e55' }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div>{agentCount} agent{agentCount !== 1 ? 's' : ''}</div>
                  <div style={{ marginTop: 4, fontSize: '12px', color: 'var(--text-dim)' }}>
                    Click an agent to select
                  </div>
                </>
              )}
              {/* Always-visible agent controls */}
              {onAddAgent && (
                <div style={{ display: 'flex', gap: 4, marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  <button data-testid="office-add-agent-btn" onClick={onAddAgent} style={{ ...btnAgent, fontSize: '12px', padding: '3px 8px' }}>+ Agent</button>
                </div>
              )}
            </div>
          )
        )}

        {/* Office instructions dialog */}
        {showOfficeConfig && onSaveInstructions && (
          <OfficeInstructionsDialog
            buildingName={displayName}
            instructions={instructionsProp}
            onSave={handleSaveInstructions}
            onClose={() => setShowOfficeConfig(false)}
            onOpenFile={onOpenInstructionsFile}
          />
        )}

        {/* Office plugin settings dialog */}
        {showOfficeSettings && onSavePluginSettings && (
          <OfficeSettingsDialog
            buildingName={displayName}
            settings={pluginSettings ?? DEFAULT_PLUGIN_SETTINGS}
            onSave={(next) => {
              onSavePluginSettings(next)
              setShowOfficeSettings(false)
            }}
            onClose={() => setShowOfficeSettings(false)}
          />
        )}

        {/* Slot for platform-specific overlays (modals, editor toolbar, etc.) */}
        {children}
      </div>
    )
  },
)
