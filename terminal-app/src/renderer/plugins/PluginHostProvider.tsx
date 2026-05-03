// ── Plugin Host Provider ─────────────────────────────────────────────
// Builds a PluginHost instance from existing React contexts and exposes
// it via React context. Plugins receive PluginHost instead of accessing
// WorldContext/CityContext/OfficeContext directly.

import React, { createContext, useContext, useMemo, useCallback, useEffect } from 'react'
import { useWorldContext } from '../contexts/WorldContext.js'
import { useCityContext } from '../contexts/CityContext.js'
import { useOfficeContext } from '../contexts/OfficeContext.js'
import { PluginEventBus } from './eventBus.js'
import type { PluginHost } from './types.js'

const { ipcRenderer } = window.require('electron') as typeof import('electron')

// Singleton event bus — shared across all plugins
const eventBus = new PluginEventBus()

const PluginHostContext = createContext<PluginHost | null>(null)

// Module-level ref so non-React callers (mcpBridge dispatch) can reach the
// current host. Refreshed on every render of the provider.
let latestHost: PluginHost | null = null

export function getLatestPluginHost(): PluginHost | null {
  return latestHost
}

export function PluginHostProvider({ children }: { children: React.ReactNode }) {
  const { projectCwd, activeView, activePanelTab, setActivePanelTab } = useWorldContext()
  const { currentBuildingId, setOfficeViewTab } = useCityContext()
  const {
    agentIds, activeAgentId, setActiveAgentId,
    agentPalettes, agentNames, agentBuildingMap,
    agentPermanentIdMap,
    permanentEmployees,
    handleSpawnTempAgent, handleAgentSelect,
  } = useOfficeContext()

  const flatPermanentEmployees = useMemo(() => permanentEmployees.map(e => ({
    id: e.id,
    name: e.settings.name,
    palette: e.settings.palette,
    model: e.settings.model,
    officeId: e.settings.officeId,
    handle: (e.settings as { handle?: string }).handle,
  })), [permanentEmployees])

  // Scope agentIds to the current building so plugins only see their own office
  const buildingAgentIds = useMemo(() => {
    return currentBuildingId
      ? agentIds.filter(id => agentBuildingMap.get(id) === currentBuildingId)
      : agentIds.filter(id => !agentBuildingMap.has(id))
  }, [agentIds, agentBuildingMap, currentBuildingId])

  const spawnAgent = useCallback((model: string) => {
    const { key, name, palette } = handleSpawnTempAgent(model)
    const id = key.replace('agent:', '')
    return { id, name }
  }, [handleSpawnTempAgent])

  const selectAgent = useCallback((agentId: string) => {
    handleAgentSelect(agentId)
  }, [handleAgentSelect])

  const switchToPlugin = useCallback((pluginId: string) => {
    setOfficeViewTab(pluginId)
  }, [setOfficeViewTab])

  const switchToAgentTab = useCallback((tabId: string) => {
    setActivePanelTab(tabId)
  }, [setActivePanelTab])

  const showNotification = useCallback((msg: string, level?: 'info' | 'warn' | 'error') => {
    console.log(`[Plugin:${level ?? 'info'}]`, msg)
  }, [])

  const ipcInvoke = useCallback((channel: string, ...args: unknown[]) => {
    return ipcRenderer.invoke(channel, ...args)
  }, [])

  // TODO: read from WorldContext editorSettings when available
  const editorSettings = useMemo(() => ({
    fontSize: 13,
    tabSize: 2,
    wordWrap: false,
  }), [])

  const host = useMemo<PluginHost>(() => ({
    projectCwd,
    buildingId: currentBuildingId,
    agentIds: buildingAgentIds,
    agentNames,
    agentPalettes,
    activeAgentId,
    agentPermanentIds: agentPermanentIdMap,
    permanentEmployees: flatPermanentEmployees,
    spawnAgent,
    selectAgent,
    switchToPlugin,
    switchToAgentTab,
    showNotification,
    on: (event, callback) => eventBus.on(event, callback),
    emit: (event, ...args) => eventBus.emit(event, ...args),
    ipcInvoke,
    editorSettings,
  }), [
    projectCwd, currentBuildingId,
    buildingAgentIds, agentNames, agentPalettes, activeAgentId, agentPermanentIdMap, flatPermanentEmployees,
    spawnAgent, selectAgent, switchToPlugin, switchToAgentTab,
    showNotification, ipcInvoke, editorSettings,
  ])

  useEffect(() => {
    latestHost = host
    return () => { if (latestHost === host) latestHost = null }
  }, [host])

  return (
    <PluginHostContext.Provider value={host}>
      {children}
    </PluginHostContext.Provider>
  )
}

/** Access the PluginHost from within a plugin or host component. */
export function usePluginHost(): PluginHost {
  const ctx = useContext(PluginHostContext)
  if (!ctx) throw new Error('usePluginHost must be used within PluginHostProvider')
  return ctx
}

/** Access the shared event bus (for host-level event dispatching). */
export function getPluginEventBus(): PluginEventBus {
  return eventBus
}
