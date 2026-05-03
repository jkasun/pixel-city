import React, { useState, useEffect, useCallback } from 'react'
import { Toolbar } from './Toolbar.js'
import { QuickMenu } from './QuickMenu.js'
import { PluginPanel } from './PluginPanel.js'
import { AgentPanel } from './AgentPanel.js'
import { StatusBar } from './StatusBar.js'
import { UpdateBanner } from './UpdateBanner.js'
import { SettingsModal } from './SettingsModal.js'
import { WorldContextProvider, useWorldContext } from './contexts/WorldContext.js'
import { CityContextProvider, useCityContext } from './contexts/CityContext.js'
import { PluginHostProvider } from './plugins/PluginHostProvider.js'
import { registerBuiltinPlugins } from './plugins/builtin/index.js'
import { OfficeContextProvider, useOfficeContext } from './contexts/OfficeContext.js'
import { OfflineOverlay } from './OfflineOverlay.js'
import { useAppLayout } from './hooks/useAppLayout.js'
import { useQuickMenuItems } from './hooks/useQuickMenuItems.js'
import { useBuildingPickerItems } from './hooks/useBuildingPickerItems.js'
import { ErrorBoundary } from './ErrorBoundary.js'
import { ThemePicker } from './ThemePicker.js'
import { useUserTheme } from './hooks/useUserTheme.js'
import { ConfirmProvider } from './components/ConfirmDialog.js'

// Register execution backends for desktop environment
import './backend/register-desktop.js'

// Initialize platform bridge for desktop (Electron IPC)
import { initPlatform, electronBridge } from './platform/index.js'
initPlatform(electronBridge)

// Register built-in plugins once at module load
registerBuiltinPlugins()

// ── Main App (with providers) ────────────────────────────────────

export default function App() {
  return (
    <ErrorBoundary>
      <OfflineOverlay />
      <ThemeGate />
    </ErrorBoundary>
  )
}

function ThemeGate() {
  const { theme, loading, setTheme } = useUserTheme()

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-bg text-text-dim text-[0.76rem]">
        <div className="pc-loader">
          <div className="pc-loader-dots">
            <div className="pc-loader-dot" />
            <div className="pc-loader-dot" />
            <div className="pc-loader-dot" />
          </div>
          <span className="pc-loader-text">loading pixel city</span>
        </div>
      </div>
    )
  }

  if (!theme) {
    return <ThemePicker onSelect={setTheme} />
  }

  return (
    <ConfirmProvider>
      <WorldContextProvider>
        <CityContextProvider>
          <OfficeContextProvider>
            <PluginHostProvider>
              <AppInner />
            </PluginHostProvider>
          </OfficeContextProvider>
        </CityContextProvider>
      </WorldContextProvider>
    </ConfirmProvider>
  )
}

// ── Inner App (consumes contexts) ────────────────────────────────

function AppInner() {
  const {
    projectCwd, handleOpenProject,
    quickMenuOpen, setQuickMenuOpen,
    buildingPickerOpen, setBuildingPickerOpen,
    shellIds, activeShellId, setActiveShellId, shellTerminalsRef, shellNames, shellBuildingMap,
    addShellTerminal: addShellTerminalRaw,
    activeView, setActiveView, activeViewRef, activeShellIdRef,
    activePanelTab,
  } = useWorldContext()

  const { currentRoute, currentBuildingId, buildings, sidebarVisible, toggleSidebar } = useCityContext()

  const addShellTerminal = useCallback(() => {
    addShellTerminalRaw(currentBuildingId)
  }, [addShellTerminalRaw, currentBuildingId])

  const {
    agentIds, activeAgentId, setActiveAgentId, activeAgentIdRef,
    agentPalettes, agentNames, agentStatusMap,
    agentPermanentIdMap, agentBuildingMap,
    agentTerminalsRef,
    handleAddAgent,
    permanentEmployees,
  } = useOfficeContext()

  // Layout management (Split.js, resize, canvas events)
  const {
    officePanelRef, terminalPanelRef,
    dmSidebarRef, terminalMainRef,
    terminalAreaRef,
  } = useAppLayout({
    activeViewRef, activeAgentIdRef, activeShellIdRef,
    agentTerminalsRef, shellTerminalsRef,
    activeAgentId, activeShellId, activeView,
    currentRoute,
    sidebarVisible, hasProject: !!projectCwd,
    activePanelTab,
  })

  // Quick menu items
  const { items: quickMenuItems, searchPhase: quickMenuSearchPhase, nestedRepoName: quickMenuNestedRepo, projectFiles } = useQuickMenuItems({
    agentIds, agentPermanentIdMap, agentTerminalsRef, agentStatusMap,
    agentPalettes, agentNames, agentBuildingMap, permanentEmployees,
    currentRoute, currentBuildingId,
    shellIds, shellBuildingMap, shellTerminalsRef, shellNames, projectCwd,
    setActiveAgentId, setActiveView, setActiveShellId,
    handleAddAgent, addShellTerminal, quickMenuOpen,
  })

  // Load local building→directory mappings for building picker navigation.
  // Refresh whenever the picker opens so newly-registered buildings are visible.
  const [buildingDirs, setBuildingDirs] = useState<Record<string, string>>({})
  useEffect(() => {
    const { ipcRenderer } = window.require('electron') as typeof import('electron')
    ipcRenderer.invoke('building-dirs-load').then((result: any) => {
      if (result.success && result.dirs) setBuildingDirs(result.dirs)
    })
  }, [buildingPickerOpen])

  // Auto-open project directory when restoring a building from session
  useEffect(() => {
    if (currentRoute === 'building' && currentBuildingId && !projectCwd) {
      const dir = buildingDirs[currentBuildingId]
      if (dir) {
        handleOpenProject(dir)
      } else if (Object.keys(buildingDirs).length > 0) {
        // buildingDirs loaded but no mapping for this building — go back to city
        window.location.hash = '#/'
      }
    }
  }, [currentRoute, currentBuildingId, buildingDirs, projectCwd, handleOpenProject])

  // Building picker items (Cmd+R)
  const buildingPickerItems = useBuildingPickerItems({
    buildings, currentBuildingId, currentRoute, buildingDirs, handleOpenProject,
  })

  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div id="app-wrapper" data-testid="app-root">
      <UpdateBanner />
      <Toolbar onOpenSettings={() => setSettingsOpen(true)} sidebarVisible={sidebarVisible} onToggleSidebar={toggleSidebar} />
      <div id="app" data-testid="app-body">
        <PluginPanel panelRef={officePanelRef} />
        <AgentPanel
          terminalPanelRef={terminalPanelRef}
          dmSidebarRef={dmSidebarRef}
          terminalMainRef={terminalMainRef}
          terminalAreaRef={terminalAreaRef}
          projectFiles={projectFiles}
        />
      </div>
      <StatusBar />

      <QuickMenu
        open={quickMenuOpen}
        onClose={() => setQuickMenuOpen(false)}
        items={quickMenuItems}
        searchPhase={quickMenuSearchPhase}
        nestedRepoName={quickMenuNestedRepo}
      />

      <QuickMenu
        open={buildingPickerOpen}
        onClose={() => setBuildingPickerOpen(false)}
        items={buildingPickerItems}
      />

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
