import React, { useEffect, useRef, useReducer } from 'react'
import { OfficeRouter } from './OfficeRouter.js'
import { useCityContext } from './contexts/CityContext.js'
import { useOfficeContext } from './contexts/OfficeContext.js'
import { useWorldContext } from './contexts/WorldContext.js'
import { usePluginHost } from './plugins/PluginHostProvider.js'
import { pluginRegistry } from './plugins/registry.js'
import { useDynamicPlugins } from './plugins/dynamic/useDynamicPlugins.js'
import { OfficeBuildingIcon } from '@pixel-city/plugin-office'
import './office/officeStore.js' // eagerly wire the local SQLite-backed OfficeStore
import { platform } from './platform/index.js'
import { PluginErrorBoundary } from './PluginErrorBoundary.js'

interface PluginPanelProps {
  panelRef: React.RefObject<HTMLDivElement | null>
}

export function PluginPanel({ panelRef }: PluginPanelProps) {
  const { projectCwd } = useWorldContext()
  const { currentRoute, currentBuildingId, officeViewTab, setOfficeViewTab, setSidebarVisible } = useCityContext()
  const isCityView = currentRoute === 'city'
  const host = usePluginHost()

  // Subscribe to dynamic plugins for this building (RTDB → registry sync)
  useDynamicPlugins(currentBuildingId)

  // Re-render when registry changes (dynamic plugin added/removed)
  const [, forceRender] = useReducer((x: number) => x + 1, 0)
  useEffect(() => pluginRegistry.onChange(forceRender), [])

  const registeredPlugins = pluginRegistry.getOrdered()

  // Bounce back to the office view whenever the selected tab has no
  // corresponding view on screen — otherwise the office wrapper is hidden
  // (display:none) with nothing rendered in its place, producing a black
  // screen that strands the user.
  useEffect(() => {
    if (officeViewTab === 'office') return
    if (!projectCwd) { setOfficeViewTab('office'); return }
    const isKnownPlugin = registeredPlugins.some(p => p.manifest.id === officeViewTab)
    if (!isKnownPlugin) setOfficeViewTab('office')
  }, [officeViewTab, registeredPlugins, projectCwd, setOfficeViewTab])
  const {
    agentIds, activeAgentId,
    agentPalettes, agentNames, agentModels,
    agentStatusMap, agentWorkerStatusMap, agentBuildingMap,
    handleAddAgent, removeAgent, resetAgents,
    handleAgentSelect,
  } = useOfficeContext()

  // Listen for MCP browser_show command to switch to browser tab (+ optional tab select)
  useEffect(() => {
    const handleBrowserShow = (e: Event) => {
      const { tabId } = (e as CustomEvent).detail ?? {}
      setOfficeViewTab('browser')
      if (tabId) {
        window.dispatchEvent(new CustomEvent('pixelcity:browser-select-tab', { detail: { tabId } }))
      }
    }
    window.addEventListener('pixelcity:browser-show', handleBrowserShow)
    return () => window.removeEventListener('pixelcity:browser-show', handleBrowserShow)
  }, [setOfficeViewTab])

  // Listen for canvas-show command to switch to canvas tab (+ select agent sub-tab)
  useEffect(() => {
    const handleCanvasShow = (e: Event) => {
      const { agentId } = (e as CustomEvent).detail ?? {}
      setOfficeViewTab('canvas')
      if (agentId) {
        window.dispatchEvent(new CustomEvent('pixelcity:canvas-focus-agent', { detail: { agentId } }))
      }
    }
    window.addEventListener('pixelcity:canvas-show', handleCanvasShow)
    return () => window.removeEventListener('pixelcity:canvas-show', handleCanvasShow)
  }, [setOfficeViewTab])

  // Listen for open-file event to switch to files tab
  useEffect(() => {
    const handleOpenFile = () => setOfficeViewTab('files')
    window.addEventListener('pixelcity:open-file', handleOpenFile)
    return () => window.removeEventListener('pixelcity:open-file', handleOpenFile)
  }, [setOfficeViewTab])

  // When leaving the browser tab, blur all webviews and explicitly focus
  // the main window's webContents via IPC. This ensures Electron menu roles
  // (paste, copy, cut, undo, etc.) route to the main renderer, not a webview.
  useEffect(() => {
    if (officeViewTab !== 'browser') {
      const webviews = document.querySelectorAll('webview')
      webviews.forEach(wv => (wv as any).blur?.())
      // IPC to main process to focus the main webContents at the Electron level
      platform().app.focusMain()
    }
  }, [officeViewTab])

  // Cmd+/- zoom for the main window (when browser tab is NOT active).
  // When browser IS active, BrowserView handles its own zoom.
  const officeViewTabRef = useRef(officeViewTab)
  officeViewTabRef.current = officeViewTab
  useEffect(() => {
    const { webFrame } = window.require('electron') as typeof import('electron')
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (officeViewTabRef.current === 'browser') return // browser handles its own zoom
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        webFrame.setZoomLevel(webFrame.getZoomLevel() + 0.5)
      } else if (e.key === '-') {
        e.preventDefault()
        webFrame.setZoomLevel(webFrame.getZoomLevel() - 0.5)
      } else if (e.key === '0') {
        e.preventDefault()
        webFrame.setZoomLevel(0)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div id="office-panel" data-testid="app-sidebar" ref={panelRef} style={{ display: 'flex', flexDirection: 'row' }}>
      {!isCityView && projectCwd && (
        <div data-testid="app-sidebar-icons" className="flex flex-col items-center gap-0.5 py-1.5 bg-bg-card border-r border-border shrink-0 w-8">
          {/* Top group: Office + plugin tabs */}
          <div className="flex flex-col items-center gap-0.5 flex-1">
            {/* Office tab (not yet migrated — uses OfficeRouter with canvas) */}
            <button
              data-testid="sidebar-btn-office"
              onClick={() => setOfficeViewTab('office')}
              title="Office"
              className={[
                'relative w-7 h-7 flex items-center justify-center',
                'bg-transparent border-0 rounded cursor-pointer',
                'transition-[color,background] duration-[120ms]',
                '[-webkit-tap-highlight-color:transparent] [touch-action:manipulation] select-none',
                officeViewTab === 'office' ? 'text-text-bright' : 'text-text-dim hover:text-text hover:bg-white/[0.06]',
              ].join(' ')}
            >
              {officeViewTab === 'office' && (
                <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-accent rounded-r-[1px]" />
              )}
              <OfficeBuildingIcon size={16} />
            </button>
            {/* Plugin-registered tabs */}
            {registeredPlugins.map((plugin) => {
              const isActive = officeViewTab === plugin.manifest.id
              const Icon = plugin.manifest.icon
              return (
                <button
                  key={plugin.manifest.id}
                  data-testid={`sidebar-btn-${plugin.manifest.id}`}
                  onClick={() => setOfficeViewTab(plugin.manifest.id)}
                  title={plugin.manifest.name}
                  className={[
                    'relative w-7 h-7 flex items-center justify-center',
                    'bg-transparent border-0 rounded cursor-pointer',
                    'transition-[color,background] duration-[120ms]',
                    '[-webkit-tap-highlight-color:transparent] [touch-action:manipulation] select-none',
                    isActive ? 'text-text-bright' : 'text-text-dim hover:text-text hover:bg-white/[0.06]',
                  ].join(' ')}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-accent rounded-r-[1px]" />
                  )}
                  <Icon size={16} />
                </button>
              )
            })}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
      <div className="office-canvas-wrapper" style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: officeViewTab === 'office' ? 'block' : 'none', position: 'relative' }}>
        <OfficeRouter
          onAddAgent={handleAddAgent}
          onRemoveAgent={removeAgent}
          onResetAgents={resetAgents}
          externalSelectedId={activeAgentId}
          onAgentSelect={(id) => { handleAgentSelect(id); setSidebarVisible(true) }}
          agentStatusMap={agentStatusMap}
          agentWorkerStatusMap={agentWorkerStatusMap}
          projectCwd={projectCwd}
          existingAgents={{ ids: agentIds, palettes: agentPalettes, names: agentNames, models: agentModels, buildingMap: agentBuildingMap }}
          agentIds={agentIds}
        />
      </div>
      {/* Plugin-registered views (Board, Files, Browser, Git, Assets, Messages) */}
      {projectCwd && registeredPlugins.map((plugin) => (
        <div key={plugin.manifest.id} style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: officeViewTab === plugin.manifest.id ? 'flex' : 'none' }}>
          <PluginErrorBoundary pluginName={plugin.manifest.name}>
            <plugin.Component host={host} visible={officeViewTab === plugin.manifest.id} />
          </PluginErrorBoundary>
        </div>
      ))}
      </div>
    </div>
  )
}
