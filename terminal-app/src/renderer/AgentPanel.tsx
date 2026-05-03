import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { StatusDisplay, AgentIcon, DmSidebar, type InactiveFloorGroup } from '@pixel-city/ui'
import { getPermanentIdForAgent } from './OfficeApp.js'
import { projectBasename } from './settings.js'
import { MiniMapOverview } from './office/components/MiniMap.js'
import { useWorldContext } from './contexts/WorldContext.js'
import { useCityContext } from './contexts/CityContext.js'
import { useOfficeContext } from './contexts/OfficeContext.js'
import { getDraggedFilePath, setDraggedFilePath, onFileDragChange } from '@pixel-city/plugin-files/components'
import { TerminalSearchBar } from './components/TerminalSearchBar.js'
import { usePluginHost } from './plugins/PluginHostProvider.js'
import { pluginRegistry } from './plugins/registry.js'
import { StatusHistoryPanel } from './StatusHistoryPanel.js'
import { AgentSettingsPanel } from './AgentSettingsPanel.js'
import { TerminalPromptIcon } from './icons/index.js'
import { ChatView } from './ChatView.js'
import { Bulkhead } from './Bulkhead.js'
import { rendererRegistry } from './llm/renderers/rendererRegistry.js'
import { llmRegistry } from './llm/index.js'
import { SessionChooser, type SessionChooserBinding } from './llm/SessionChooser.js'
import { claudeCodeChooserBinding } from './llm/providers/claude-code/index.js'
import { codexCliChooserBinding } from './llm/providers/codex-cli/index.js'

const CHOOSER_BINDINGS: Record<string, SessionChooserBinding> = {
  'claude-code': claudeCodeChooserBinding,
  'codex-cli': codexCliChooserBinding,
}

function resolveProviderForModelId(modelId: string) {
  return llmRegistry.resolveProviderForModel(modelId)
}
import type { UseProjectFilesReturn } from './hooks/useProjectFiles.js'
import type { ModelPickerEntry } from '@pixel-city/core/session'

import { platform } from './platform/index.js'

const EMPTY_TOKENS_MAP: Map<string, number> = new Map()

// Extracted constant styles to avoid per-render object allocation
const PANEL_VISIBLE: React.CSSProperties = { display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }
const PANEL_HIDDEN: React.CSSProperties = { display: 'none', flexDirection: 'column', flex: 1, overflow: 'hidden' }

interface AgentPanelProps {
  terminalPanelRef: React.RefObject<HTMLDivElement | null>
  dmSidebarRef: React.RefObject<HTMLDivElement | null>
  terminalMainRef: React.RefObject<HTMLDivElement | null>
  terminalAreaRef: React.RefObject<HTMLDivElement | null>
  projectFiles: UseProjectFilesReturn
}

export function AgentPanel({
  terminalPanelRef, dmSidebarRef, terminalMainRef,
  terminalAreaRef, projectFiles,
}: AgentPanelProps) {
  const {
    projectCwd, handleChangeFolder,
    shellIds, activeShellId, setActiveShellId, shellTerminalsRef, shellNames, shellBuildingMap,
    initShellTerminal, addShellTerminal: addShellTerminalRaw, removeShellTerminal,
    activeView, setActiveView,
    activePanelTab, setActivePanelTab,
    shellsCollapsed, setShellsCollapsed,
  } = useWorldContext()

  const { currentBuildingId, officeViewTab, setOfficeViewTab, toggleSidebar } = useCityContext()

  const {
    agentIds, activeAgentId, setActiveAgentId,
    agentPalettes, agentNames, agentModels,
    agentStatusMap, agentStatusStartMap, agentStatusHistory,
    agentBuildingMap, agentNotes, editingNoteId,
    setEditingNoteId, setAgentNotes,
    agentTerminalsRef, initTerminal, cleanupTerminal,
    pendingPromptsRef,
    removeAgent, endAgentSession,
    quickActions, addQuickAction, removeQuickAction, updateQuickAction, runQuickAction,
    handleSpawnTempAgent, handleAddAgent, updateAgentModel,
    permanentEmployees, agentPermanentIdMap,
    currentFloors, officeReady,
    wakePermanentEmployee,
  } = useOfficeContext()

  const host = usePluginHost()
  const pluginAgentTabs = pluginRegistry.getAgentTabs()

  // ── Building-scoped agents & shell terminals ───────────────────
  const buildingAgentIds = useMemo(() => {
    return currentBuildingId
      ? agentIds.filter(id => agentBuildingMap.get(id) === currentBuildingId)
      : agentIds.filter(id => !agentBuildingMap.has(id))
  }, [agentIds, agentBuildingMap, currentBuildingId])

  const buildingShellIds = useMemo(() => {
    return currentBuildingId
      ? shellIds.filter(id => shellBuildingMap.get(id) === currentBuildingId)
      : shellIds.filter(id => !shellBuildingMap.has(id))
  }, [shellIds, shellBuildingMap, currentBuildingId])

  // ── Offline permanent employees grouped by floor ──────────────
  const inactiveEmployeesByFloor = useMemo((): InactiveFloorGroup[] => {
    const activePermanentIds = new Set(agentPermanentIdMap.values())
    const inactive = permanentEmployees.filter(emp => {
      if (activePermanentIds.has(emp.id)) return false
      const empBuilding = emp.settings.officeId ?? null
      return currentBuildingId ? empBuilding === currentBuildingId : empBuilding === null
    })
    const floorMap = new Map<string, InactiveFloorGroup['employees']>()
    for (const emp of inactive) {
      const floorId = emp.settings.floorId ?? 'floor-0'
      let arr = floorMap.get(floorId)
      if (!arr) { arr = []; floorMap.set(floorId, arr) }
      const model = emp.settings.model
      arr.push({ id: emp.id, name: emp.settings.name, palette: emp.settings.palette ?? 0, hueShift: emp.settings.hueShift, model })
    }
    return Array.from(floorMap.entries())
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([floorId, employees]) => {
        const floor = currentFloors.find(f => f.id === floorId)
        const floorLabel = floor?.name ?? `Floor ${floorId.replace(/^floor-/, '')}`
        return { floorLabel, employees }
      })
  }, [permanentEmployees, agentPermanentIdMap, currentBuildingId, currentFloors])

  const handleStartEmployee = useCallback((employeeId: string) => {
    // Single wake path: synth-ghost click on canvas and DM Start button both
    // funnel through wakePermanentEmployee, which handles the atomic ghost→real
    // swap, agentId reuse from the registry, and React state population.
    wakePermanentEmployee(employeeId)
  }, [wakePermanentEmployee])

  const agentHueShiftMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const [agentId, permId] of agentPermanentIdMap.entries()) {
      const emp = permanentEmployees.find(e => e.id === permId)
      const hueShift = emp?.settings.hueShift
      if (hueShift) map.set(agentId, hueShift)
    }
    return map
  }, [agentPermanentIdMap, permanentEmployees])

  // Convert llmRegistry models to ModelPickerEntry[] for shared DmSidebar
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

  const addShellTerminal = useCallback(() => {
    addShellTerminalRaw(currentBuildingId)
  }, [addShellTerminalRaw, currentBuildingId])

  // ── Terminal quick action handler ──────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const action = (e as CustomEvent).detail as { title: string; command?: string }
      if (!action.command) return
      const shellId = addShellTerminalRaw(currentBuildingId)
      setActiveView('shell')
      setActiveShellId(shellId)
      // Write the command once the PTY is initialized
      const cmd = action.command
      const checkAndWrite = () => {
        const shell = shellTerminalsRef.current.get(shellId)
        if (shell && shell.ptyId >= 0) {
          platform().pty.input(shell.ptyId, cmd + '\r')
        } else {
          setTimeout(checkAndWrite, 100)
        }
      }
      // Small delay for PTY initialization
      setTimeout(checkAndWrite, 200)
    }
    window.addEventListener('pixelcity:run-terminal-action', handler)
    return () => window.removeEventListener('pixelcity:run-terminal-action', handler)
  }, [addShellTerminalRaw, currentBuildingId, setActiveView, setActiveShellId, shellTerminalsRef])

  // ── Terminal search (Ctrl/Cmd+F) ────────────────────────────────
  const [searchVisible, setSearchVisible] = useState(false)

  // ── Session chooser state ───────────────────────────────────────
  // Map<agentId, 'new' | sessionId>. Once an agent has a choice, the
  // terminal renders. Clearing the entry re-shows the chooser.
  const [chooserChoices, setChooserChoices] = useState<Map<string, 'new' | string>>(new Map())

  // When a permanent agent's PTY exits (e.g. user typed /exit), drop the
  // agent from agentIds so the canvas re-materializes them as an asleep
  // synth ghost and the offline-list filter picks them up. Re-waking is
  // routed through ghost-click or the DM sidebar's Start button, which
  // both end up at handleAddAgent → fresh SessionChooser.
  useEffect(() => {
    const { ipcRenderer } = window.require('electron') as typeof import('electron')
    const handler = (_e: unknown, payload: { id: number; exitCode: number }) => {
      void payload.exitCode
      for (const [agentId, data] of agentTerminalsRef.current.entries()) {
        if (data.ptyId !== payload.id) continue
        const modelId = agentModels.get(agentId) ?? ''
        const provider = modelId ? resolveProviderForModelId(modelId) : undefined
        const hasChooser = !!provider && !!CHOOSER_BINDINGS[provider.id]
        const isPermanent = getPermanentIdForAgent(agentId) !== null
        if (!hasChooser || !isPermanent) break
        setChooserChoices(prev => {
          if (!prev.has(agentId)) return prev
          const next = new Map(prev)
          next.delete(agentId)
          return next
        })
        endAgentSession(agentId)
        break
      }
    }
    ipcRenderer.on('pty-exit', handler)
    return () => { ipcRenderer.removeListener('pty-exit', handler) }
  }, [agentTerminalsRef, agentModels, endAgentSession, getPermanentIdForAgent])

  const activeSearchAddon = useMemo(() => {
    if (activeView === 'agent' && activeAgentId !== null) {
      return agentTerminalsRef.current.get(activeAgentId)?.searchAddon ?? null
    }
    if (activeView === 'shell' && activeShellId !== null) {
      return shellTerminalsRef.current.get(activeShellId)?.searchAddon ?? null
    }
    return null
  }, [activeView, activeAgentId, activeShellId, agentTerminalsRef, shellTerminalsRef])

  // Ctrl/Cmd+F to open search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        // Only intercept when terminal area is visible AND focus is inside it
        // (let Monaco editor handle its own Cmd+F for find-in-file)
        const termArea = terminalAreaRef.current
        if (!termArea || termArea.style.display === 'none') return
        if (!termArea.contains(document.activeElement)) return
        e.preventDefault()
        e.stopPropagation()
        setSearchVisible(true)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [terminalAreaRef])

  // Ctrl/Cmd+B to toggle sidebar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault()
        e.stopPropagation()
        toggleSidebar()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [toggleSidebar])

  // Track whether a file is being dragged over the terminal area.
  const [fileDragging, setFileDragging] = useState(false)
  const [terminalDragOver, setTerminalDragOver] = useState(false)

  // Use refs so window-level listeners always see current values
  const activeViewRef = useRef(activeView)
  activeViewRef.current = activeView
  const activeAgentIdRef = useRef(activeAgentId)
  activeAgentIdRef.current = activeAgentId
  const activeShellIdRef = useRef(activeShellId)
  activeShellIdRef.current = activeShellId

  // Shared helper: send an escaped file path to the active terminal/agent PTY
  const sendFileToTerminal = useCallback((filePath: string) => {
    const escaped = filePath.replace(/([ '"\\$`!#&|;(){}[\]<>?*~^])/g, '\\$1')


    if (activeViewRef.current === 'agent' && activeAgentIdRef.current !== null) {
      const agent = agentTerminalsRef.current.get(activeAgentIdRef.current)

      if (agent) {
        if (agent.session) agent.session.sendInput(escaped)
        else platform().pty.input(agent.ptyId, escaped)
        agent.terminal?.focus()
      }
    } else if (activeViewRef.current === 'shell' && activeShellIdRef.current !== null) {
      const shell = shellTerminalsRef.current.get(activeShellIdRef.current)

      if (shell) {
        platform().pty.input(shell.ptyId, escaped)
        shell.terminal.focus()
      }
    }
  }, [agentTerminalsRef, shellTerminalsRef])
  const sendFileRef = useRef(sendFileToTerminal)
  sendFileRef.current = sendFileToTerminal

  // Track whether the pointer was recently over the terminal area.
  // This ref is set by dragover and cleared with a 1s delay so it survives
  // the gap between dragleave and the file tree's onDragEnd.
  const wasOverTerminalRef = useRef(false)
  const wasOverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Subscribe to drag state changes from file tree (internal drags).
  // When an internal drag ends while the pointer was recently over the terminal, send the file path.
  useEffect(() => {
    return onFileDragChange((dragging, path) => {

      if (!dragging && path && wasOverTerminalRef.current) {
        // Internal drag ended over terminal — send the file path
        sendFileRef.current(path)
      }
      setFileDragging(dragging)
      if (!dragging) {
        setTerminalDragOver(false)
        wasOverTerminalRef.current = false
      }
    })
  }, [])

  // Window-level drag/drop listeners for visual feedback + OS file drops.
  // Internal file-tree drops are handled by onFileDragChange above.
  useEffect(() => {
    const isInTerminalArea = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null
      if (!el) return false
      const area = document.getElementById('terminal-area')
      return !!area && area.contains(el)
    }

    const onDragOver = (e: DragEvent) => {
      if (!isInTerminalArea(e.target)) return
      const hasFiles = e.dataTransfer?.types?.includes('Files')
      const hasJson = e.dataTransfer?.types?.includes('application/json')
      const hasDragPath = getDraggedFilePath()
      if (hasFiles || hasJson || hasDragPath) {
        e.preventDefault()
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
        // Mark as over terminal — clear any pending reset timer
        wasOverTerminalRef.current = true
        if (wasOverTimerRef.current) { clearTimeout(wasOverTimerRef.current); wasOverTimerRef.current = null }
        setFileDragging(true)
        setTerminalDragOver(true)
      }
    }

    const onDragLeave = (e: DragEvent) => {
      const area = document.getElementById('terminal-area')
      if (!area) return
      const related = e.relatedTarget as HTMLElement | null
      if (!related || !area.contains(related)) {
        // Delay clearing wasOverTerminal so it survives the dragleave→dragend gap
        if (wasOverTimerRef.current) clearTimeout(wasOverTimerRef.current)
        wasOverTimerRef.current = setTimeout(() => { wasOverTerminalRef.current = false }, 1000)
        setTerminalDragOver(false)
        if (!getDraggedFilePath()) setFileDragging(false)
      }
    }

    // OS file drops (Finder → terminal) fire 'drop'
    const onDrop = (e: DragEvent) => {
      if (!isInTerminalArea(e.target)) return
      e.preventDefault()
      e.stopPropagation()

      let filePath = getDraggedFilePath()
      if (!filePath && e.dataTransfer?.files?.length) {
        filePath = (e.dataTransfer.files[0] as File & { path?: string }).path ?? e.dataTransfer.files[0].name
      }
      setDraggedFilePath(null)
      setFileDragging(false)
      setTerminalDragOver(false)
      if (!filePath) return

      sendFileRef.current(filePath)
    }

    window.addEventListener('dragover', onDragOver, true)
    window.addEventListener('dragleave', onDragLeave, true)
    window.addEventListener('drop', onDrop, true)
    return () => {
      window.removeEventListener('dragover', onDragOver, true)
      window.removeEventListener('dragleave', onDragLeave, true)
      window.removeEventListener('drop', onDrop, true)
    }
  }, [])

  if (!projectCwd) return null

  return (
    <div id="terminal-panel" data-testid="agent-panel" ref={terminalPanelRef}>

      {/* ── DM sidebar ─────────────────────────────────── */}
      <div id="dm-sidebar" data-testid="dm-sidebar" ref={dmSidebarRef}>
        <Bulkhead name="dm-sidebar">
        <DmSidebar
          projectBasename={projectBasename(projectCwd)}
          shellIds={buildingShellIds}
          activeView={activeView}
          activeShellId={activeShellId}
          shellsCollapsed={shellsCollapsed}
          shellNames={shellNames}
          onShellsCollapsedToggle={() => setShellsCollapsed(v => !v)}
          onAddShell={addShellTerminal}
          onRemoveShell={removeShellTerminal}
          onSelectShell={(id) => { setActiveShellId(id); setActiveView('shell') }}
          agentIds={agentIds}
          activeAgentId={activeAgentId}
          agentPalettes={agentPalettes}
          agentHueShiftMap={agentHueShiftMap}
          agentNames={agentNames}
          agentModels={agentModels}
          agentStatusMap={agentStatusMap}
          agentStatusStartMap={agentStatusStartMap}
          agentTokensMap={EMPTY_TOKENS_MAP}
          agentBuildingMap={agentBuildingMap}
          agentNotes={agentNotes}
          editingNoteId={editingNoteId}
          currentBuildingId={currentBuildingId}
          onSelectAgent={(id) => {
            setActiveAgentId(id)
            setActiveView('agent')
            if (officeViewTab === 'browser') {
              // When on browser view, switch to the agent's browser tab instead of board
              const tabId = `agent-${id}`
              window.dispatchEvent(new CustomEvent('pixelcity:browser-select-tab', {
                detail: { tabId },
              }))
            } else if (officeViewTab === 'board') {
              const agentKey = `agent:${id}`
              const pid = getPermanentIdForAgent(id)
              const employeeKey = pid ? `emp:${pid}` : null
              window.dispatchEvent(new CustomEvent('pixelcity:select-agent-task', {
                detail: { agentKey, employeeKey, buildingId: currentBuildingId },
              }))
            }
          }}
          onRemoveAgent={removeAgent}
          onSetEditingNoteId={setEditingNoteId}
          onSetAgentNotes={setAgentNotes}
          quickActions={quickActions}
          onAddQuickAction={addQuickAction}
          onRemoveQuickAction={removeQuickAction}
          onUpdateQuickAction={updateQuickAction}
          onRunQuickAction={runQuickAction}
          availableModels={availableModels}
          getChipDescriptor={(modelId) => llmRegistry.getChipDescriptorForModel(modelId)}
          onAddAgent={(model) => {
            const { key } = handleSpawnTempAgent(model)
            const agentId = key.replace('agent:', '')
            setActiveAgentId(agentId)
            setActiveView('agent')
          }}
          onChangeFolder={handleChangeFolder}
          renderMiniMap={() => <MiniMapOverview maxWidth={140} maxHeight={90} />}
          inactiveEmployeesByFloor={inactiveEmployeesByFloor}
          onStartEmployee={handleStartEmployee}
          officeReady={officeReady}
        />

        </Bulkhead>
      </div>

      {/* ── Terminal main area ─────────────────────────── */}
      <div id="terminal-main" ref={terminalMainRef}>
        <Bulkhead name="terminal-panel">

        {/* ── Panel tab bar (agent-scoped, hidden for plain shells) ── */}
        {activeView === 'agent' && activeAgentId !== null && buildingAgentIds.includes(activeAgentId) && (
          <div
            id="panel-tab-bar"
            data-testid="agent-tabs"
            className="flex flex-row flex-shrink-0 border-b border-border px-2"
          >
            {/* Hardcoded host tabs */}
            {(['message', 'status', 'settings'] as const).map(tab => {
              const labels: Record<string, string> = { message: 'Message', status: 'Status', settings: 'Settings' }
              return (
                <button
                  key={tab}
                  data-testid={`agent-tab-${tab}`}
                  className={[
                    'bg-transparent border-0 border-b-2 font-ui text-[0.7rem] font-medium',
                    'px-3 pt-[7px] pb-[5px] cursor-pointer transition-[color,border-color] duration-[120ms]',
                    'whitespace-nowrap tracking-[0.01em]',
                    activePanelTab === tab
                      ? 'text-accent border-b-accent'
                      : 'text-text-muted border-b-transparent hover:text-text',
                  ].join(' ')}
                  onClick={() => setActivePanelTab(tab)}
                >
                  {labels[tab]}
                </button>
              )
            })}
            {/* Plugin-registered agent tabs (Inbox, and future migrated tabs) */}
            {pluginAgentTabs.map(tab => (
              <button
                key={tab.id}
                className={[
                  'bg-transparent border-0 border-b-2 font-ui text-[0.7rem] font-medium',
                  'px-3 pt-[7px] pb-[5px] cursor-pointer transition-[color,border-color] duration-[120ms]',
                  'whitespace-nowrap tracking-[0.01em]',
                  activePanelTab === tab.id
                    ? 'text-accent border-b-accent'
                    : 'text-text-muted border-b-transparent hover:text-text',
                ].join(' ')}
                onClick={() => setActivePanelTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}


        {/* ── Plugin agent tabs (Inbox, and future migrated tabs) ── */}
        {pluginAgentTabs.map(tab => (
          <div key={tab.id} style={activePanelTab === tab.id && activeView === 'agent' ? PANEL_VISIBLE : PANEL_HIDDEN}>
            <tab.Component
              host={host}
              agentId={activeAgentId !== null && buildingAgentIds.includes(activeAgentId) ? activeAgentId : ''}
              agentName={activeAgentId !== null ? (agentNames.get(activeAgentId) ?? '') : ''}
              agentPalette={activeAgentId !== null ? (agentPalettes.get(activeAgentId) ?? 0) : 0}
              visible={activePanelTab === tab.id && activeView === 'agent'}
            />
          </div>
        ))}

        {/* ── Status History panel (agent-scoped) ── */}
        <div style={activePanelTab === 'status' && activeView === 'agent' ? PANEL_VISIBLE : PANEL_HIDDEN}>
          <StatusHistoryPanel
            history={agentStatusHistory}
            selectedAgentId={activeAgentId !== null && buildingAgentIds.includes(activeAgentId) ? activeAgentId : null}
            agentIds={buildingAgentIds}
            agentNames={agentNames}
            agentPalettes={agentPalettes}
          />
        </div>

        {/* ── Settings panel (agent-scoped) ── */}
        <div style={activePanelTab === 'settings' && activeView === 'agent' ? PANEL_VISIBLE : PANEL_HIDDEN}>
          <AgentSettingsPanel
            agentId={activeAgentId !== null && buildingAgentIds.includes(activeAgentId) ? activeAgentId : null}
            agentName={activeAgentId !== null ? (agentNames.get(activeAgentId) ?? `Agent ${activeAgentId}`) : ''}
            currentModel={activeAgentId !== null ? (agentModels.get(activeAgentId) ?? 'sonnet') : 'sonnet'}
            availableModels={availableModels}
            onChangeModel={updateAgentModel}
          />
        </div>

        <div
          id="terminal-area"
          data-testid="terminal-area"
          ref={terminalAreaRef}
          style={{ display: (activeView === 'shell' || activePanelTab === 'message') ? undefined : 'none', position: 'relative' }}
        >
          {/* Visual drop indicator — pointer-events:none so it never blocks xterm;
              the actual drop is handled by window-level capture listeners above. */}
          {fileDragging && (
            <div
              className={[
                'absolute inset-0 z-[100] pointer-events-none bg-transparent transition-[background] duration-[120ms]',
                terminalDragOver ? 'bg-[rgba(92,154,125,0.1)] outline-2 outline-accent -outline-offset-2' : '',
              ].join(' ')}
            />
          )}
          {activeView === 'agent' && activeAgentId !== null && buildingAgentIds.includes(activeAgentId) && (
            <div
              id="terminal-header"
              className="flex items-center gap-[7px] h-[34px] px-3.5 bg-bg-card border-b border-border flex-shrink-0 overflow-hidden"
            >
              <AgentIcon palette={agentPalettes.get(activeAgentId) ?? 0} />
              <span className="text-[0.82rem] font-medium text-text-bright whitespace-nowrap">
                {agentNames.get(activeAgentId) ?? `Agent ${activeAgentId}`}
              </span>
              {agentStatusMap.get(activeAgentId) && (
                <>
                  <span className="text-text-dim text-[0.82rem] flex-shrink-0">·</span>
                  <span className="text-[0.72rem] text-text-dim whitespace-nowrap overflow-hidden text-ellipsis min-w-0"><StatusDisplay text={agentStatusMap.get(activeAgentId)!} startedAt={agentStatusStartMap.get(activeAgentId)} /></span>
                </>
              )}
              {getPermanentIdForAgent(activeAgentId) === null ? (
                <>
                  <span
                    className="flex-1 min-w-0 text-[0.65rem] text-text-dim italic whitespace-nowrap overflow-hidden text-ellipsis"
                    title="You are working with a temporary agent — they don't have memories and don't appear in the office automatically. Hire them to make them a permanent employee."
                  >
                    You are working with a temporary agent — they don't have memories and don't appear in the office automatically
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('pixelcity:hire-agent', { detail: { agentId: activeAgentId } }))
                    }}
                    className="text-[0.7rem] px-1.5 py-0.5 rounded transition-colors flex-shrink-0 hover:bg-[rgba(240,192,64,0.15)]"
                    style={{ color: '#f0c040', border: '1px solid rgba(240, 192, 64, 0.35)', background: 'rgba(240, 192, 64, 0.08)' }}
                    title="Hire as a permanent employee that persists across sessions"
                  >
                    ★ Hire
                  </button>
                </>
              ) : (
                <>
                  <div style={{ flex: 1 }} />
                  {(() => {
                    const modelId = agentModels.get(activeAgentId) ?? ''
                    const provider = modelId ? resolveProviderForModelId(modelId) : undefined
                    if (!provider || !CHOOSER_BINDINGS[provider.id]) return null
                    const data = agentTerminalsRef.current.get(activeAgentId)
                    const sessionAlive = !!data?.session && !data.exited
                    return (
                      <button
                        type="button"
                        onClick={() => {
                          cleanupTerminal(activeAgentId)
                          setChooserChoices(prev => {
                            if (!prev.has(activeAgentId)) return prev
                            const next = new Map(prev)
                            next.delete(activeAgentId)
                            return next
                          })
                        }}
                        className="text-[0.7rem] text-text-muted hover:text-text-bright transition-colors px-1.5 py-0.5 rounded hover:bg-white/[0.04]"
                        title={sessionAlive ? 'End session and pick another' : 'Pick a different session'}
                      >
                        ← Sessions
                      </button>
                    )
                  })()}
                </>
              )}
            </div>
          )}
          {activeView === 'shell' && activeShellId !== null && buildingShellIds.includes(activeShellId) && (
            <div
              id="terminal-header"
              className="flex items-center gap-[7px] h-[34px] px-3.5 bg-bg-card border-b border-border flex-shrink-0 overflow-hidden"
            >
              <TerminalPromptIcon style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <span className="text-[0.82rem] font-medium text-text-bright whitespace-nowrap">
                {shellNames[activeShellId] ?? `Terminal ${activeShellId + 1}`}
              </span>
              <div style={{ flex: 1 }} />
            </div>
          )}
          {searchVisible && (
            <div data-testid="terminal-search-bar">
              <TerminalSearchBar
                searchAddon={activeSearchAddon}
                onClose={() => setSearchVisible(false)}
              />
            </div>
          )}
          <div
            id="terminals"
            className="flex-1 relative overflow-hidden"
          >
            {agentIds.map(id => {
              const isVisible = activeView === 'agent' && id === activeAgentId && buildingAgentIds.includes(id)
              const agentData = agentTerminalsRef.current.get(id)
              const session = agentData?.session

              // Only resolve renderer when we have a session (avoids chicken-and-egg:
              // session is created by initTerminal, which needs the ref callback below)
              if (session) {
                const preferredRenderer = session.capabilities?.preferredRenderer
                const renderer = rendererRegistry.resolve(preferredRenderer)
                if (renderer && renderer.id !== 'terminal') {
                  // Non-terminal renderer → use the renderer's React component
                  const RendererComponent = renderer.Component
                  return (
                    <div
                      key={`agent-${id}`}
                      className="absolute inset-0 overflow-hidden"
                      style={{ display: isVisible ? 'flex' : 'none', width: '100%' }}
                    >
                      <RendererComponent
                        session={session}
                        agentName={agentNames.get(id) ?? `Agent ${id}`}
                        agentId={id}
                        modelId={agentModels.get(id) ?? ''}
                        projectCwd={projectCwd}
                        projectFiles={projectFiles}
                      />
                    </div>
                  )
                }
              }

              // Terminal renderer OR session not yet initialized → render ref-based
              // container (initTerminal creates the session & decides terminal vs API)
              const agentModelId = agentModels.get(id) ?? ''
              const provider = agentModelId ? resolveProviderForModelId(agentModelId) : undefined
              const chooserBinding = provider ? CHOOSER_BINDINGS[provider.id] : undefined
              const isPermanentAgent = getPermanentIdForAgent(id) !== null
              const choice = chooserChoices.get(id)
              // Auto-start (e.g. moving a task to TODO) seeds pendingPromptsRef
              // and expects a fresh session. Skip the chooser so initTerminal
              // runs immediately and consumes the prompt.
              const hasPendingPrompt = pendingPromptsRef.current.has(id)

              if (!session && !choice && !hasPendingPrompt && chooserBinding && isPermanentAgent && projectCwd) {
                return (
                  <div
                    key={`agent-${id}`}
                    className="absolute inset-0 overflow-hidden"
                    style={{ display: isVisible ? 'flex' : 'none' }}
                  >
                    <SessionChooser
                      agentName={agentNames.get(id) ?? `Agent ${id}`}
                      cwd={projectCwd}
                      binding={chooserBinding}
                      onNewChat={() => setChooserChoices(prev => {
                        const next = new Map(prev)
                        next.set(id, 'new')
                        return next
                      })}
                      onResume={(sessionId) => setChooserChoices(prev => {
                        const next = new Map(prev)
                        next.set(id, sessionId)
                        return next
                      })}
                    />
                  </div>
                )
              }

              return (
                <div
                  key={`agent-${id}`}
                  className="absolute inset-0 overflow-hidden"
                  style={{ display: isVisible ? 'block' : 'none' }}
                  ref={(el) => {
                    if (el && !agentTerminalsRef.current.has(id)) {
                      const resumeSessionId = !hasPendingPrompt && choice && choice !== 'new' ? choice : undefined
                      initTerminal(id, el, resumeSessionId ? { resumeSessionId } : undefined)
                    }
                  }}
                />
              )
            })}
            {shellIds.map(id => (
              <div
                key={`shell-${id}`}
                className="absolute inset-0 overflow-hidden"
                style={{ display: activeView === 'shell' && id === activeShellId && buildingShellIds.includes(id) ? 'block' : 'none' }}
                ref={(el) => {
                  if (el) initShellTerminal(id, el)
                }}
              />
            ))}
          </div>
        </div>
        </Bulkhead>
      </div>

    </div>
  )
}
