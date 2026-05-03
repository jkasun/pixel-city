import React from 'react'
import { useWorldContext } from './contexts/WorldContext.js'
import { useCityContext } from './contexts/CityContext.js'
import { ChevronLeftIcon, SidebarIcon, SettingsGearIcon } from './icons/index.js'

interface ToolbarProps {
  onOpenSettings: () => void
  sidebarVisible: boolean
  onToggleSidebar: () => void
}

export function Toolbar({ onOpenSettings, sidebarVisible, onToggleSidebar }: ToolbarProps) {
  const { projectCwd } = useWorldContext()
  const { currentRoute } = useCityContext()

  if (!projectCwd) return null

  const inBuilding = currentRoute !== 'city'

  return (
    <div
      id="toolbar"
      data-testid="app-toolbar"
      className="flex items-center justify-between h-[38px] min-h-[38px] px-3 bg-bg border-b border-border [-webkit-app-region:drag] select-none"
    >
      {/* toolbar-left */}
      <div className="flex items-center flex-1 min-w-0">
        {inBuilding && (
          <button
            data-testid="toolbar-back-btn"
            className="flex items-center gap-[3px] px-2 bg-none border-none text-text-dim font-ui text-[11px] cursor-pointer transition-colors duration-[120ms] ease-linear select-none shrink-0 hover:text-text-bright [-webkit-app-region:no-drag]"
            onClick={() => { window.location.hash = '#/' }}
          >
            <ChevronLeftIcon />
            City
          </button>
        )}
        {/* toolbar-drag-region */}
        <div className="flex-1 h-full [-webkit-app-region:drag]" />
      </div>

      {/* toolbar-right */}
      <div className="flex items-center gap-[6px] shrink-0 [-webkit-app-region:no-drag]">
        {inBuilding && (
          <button
            data-testid="toolbar-sidebar-btn"
            className={`inline-flex items-center justify-center w-7 h-7 border-none bg-transparent cursor-pointer rounded-[5px] transition-[background,color] duration-[120ms] ease-linear [-webkit-app-region:no-drag] hover:bg-bg-hover hover:text-text${sidebarVisible ? ' text-accent hover:text-accent' : ' text-text-dim'}`}
            onClick={onToggleSidebar}
            title={`Toggle Sidebar (${navigator.platform.includes('Mac') ? '⌘B' : 'Ctrl+B'})`}
          >
            <SidebarIcon />
          </button>
        )}
        <button
          data-testid="toolbar-settings-btn"
          className="inline-flex items-center justify-center w-7 h-7 border-none bg-transparent text-text-dim cursor-pointer rounded-[5px] transition-[background,color] duration-[120ms] ease-linear [-webkit-app-region:no-drag] hover:bg-bg-hover hover:text-text"
          onClick={onOpenSettings}
          title="Settings"
        >
          <SettingsGearIcon />
        </button>
      </div>
    </div>
  )
}
