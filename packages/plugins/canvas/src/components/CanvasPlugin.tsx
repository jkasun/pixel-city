// CanvasPlugin — L4 Component
// Main plugin view rendered in the PluginPanel sidebar.
// Shows per-agent tabs and the active agent's canvas iframe.
// Supports version history sidebar.

import { useState, useEffect } from 'react'
import { useCanvasStore } from '../useCanvasStore.js'
import { CanvasIframe } from './CanvasIframe.js'
import { VersionHistorySidebar } from './VersionHistorySidebar.js'
import { DrawTab } from './DrawTab.js'
import type { PluginProps } from '@pixel-city/core'

type CanvasMode = 'live' | 'draw'

const PALETTE_COLORS = [
  '#e8c89a', '#c8a878', '#a08060', '#6b4e35', '#4a3525', '#d4b896',
]

function agentColor(palette: number): string {
  return PALETTE_COLORS[palette % PALETTE_COLORS.length]
}

export function CanvasPlugin({ host, visible }: PluginProps) {
  const canvasMap = useCanvasStore()
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [versionSidebarOpen, setVersionSidebarOpen] = useState(false)
  const [mode, setMode] = useState<CanvasMode>('live')

  // Scope to the current building — host.agentIds is already filtered to the active building
  const buildingAgentSet = new Set(host.agentIds)
  const agentIds = Array.from(canvasMap.keys()).filter(id => buildingAgentSet.has(id))

  // Auto-select first agent if current selection is cleared or doesn't exist
  useEffect(() => {
    if (selectedAgentId && canvasMap.has(selectedAgentId)) return
    setSelectedAgentId(agentIds.length > 0 ? agentIds[0] : null)
  }, [agentIds.length, selectedAgentId, canvasMap])

  // Listen for focus-agent events from canvasCommands (L2)
  useEffect(() => {
    const handler = (e: Event) => {
      const { agentId } = (e as CustomEvent).detail
      if (agentId) {
        setSelectedAgentId(agentId)
        setMode('live')
      }
    }
    window.addEventListener('pixelcity:canvas-focus-agent', handler)
    return () => window.removeEventListener('pixelcity:canvas-focus-agent', handler)
  }, [])

  if (!visible) return null

  const selectedContent = selectedAgentId ? canvasMap.get(selectedAgentId) : undefined
  const selectedName = selectedAgentId
    ? (host.agentNames.get(selectedAgentId) ?? selectedAgentId)
    : ''

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Mode toggle: Live / Draw */}
      <div className="flex items-center border-b border-border bg-bg-card shrink-0">
        <button
          className={[
            'flex-1 text-[11px] py-1.5 border-0 cursor-pointer transition-colors',
            mode === 'live' ? 'bg-bg-hover text-text-bright font-semibold' : 'bg-transparent text-text-dim hover:text-text',
          ].join(' ')}
          onClick={() => setMode('live')}
        >
          Live
        </button>
        <button
          className={[
            'flex-1 text-[11px] py-1.5 border-0 cursor-pointer transition-colors',
            mode === 'draw' ? 'bg-bg-hover text-text-bright font-semibold' : 'bg-transparent text-text-dim hover:text-text',
          ].join(' ')}
          onClick={() => setMode('draw')}
        >
          Draw
        </button>
      </div>

      {mode === 'draw' ? (
        <DrawTab host={host} visible={visible && mode === 'draw'} />
      ) : (
        <>
          {agentIds.length === 0 ? (
            <div className="flex flex-col flex-1 items-center justify-center text-text-dim text-[13px] gap-2 select-none">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18" />
                <path d="M9 21V9" />
              </svg>
              <span>No canvas content</span>
              <span className="text-[11px] text-text-dim/60">Agents can use set_canvas to display HTML here</span>
            </div>
          ) : (
          <>
          {/* Per-agent tab bar */}
          <div className="flex items-center gap-0 border-b border-border bg-bg-card shrink-0 overflow-x-auto">
            {agentIds.map((id) => {
              const isActive = id === selectedAgentId
              const name = host.agentNames.get(id) ?? id
              const palette = host.agentPalettes.get(id) ?? 0
              const color = agentColor(palette)
              return (
                <button
                  key={id}
                  onClick={() => setSelectedAgentId(id)}
                  className={[
                    'flex items-center gap-1.5 px-3 py-1.5 border-0 cursor-pointer transition-[color,background] duration-100 text-[12px] shrink-0',
                    isActive
                      ? 'bg-bg-hover text-text-bright border-b-2 border-b-accent'
                      : 'bg-transparent text-text-dim hover:text-text hover:bg-white/[0.04]',
                  ].join(' ')}
                  style={isActive ? { borderBottomColor: color } : undefined}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  {name}
                </button>
              )
            })}
          </div>

          {/* Canvas area: iframe + version sidebar */}
          {selectedAgentId && selectedContent ? (
            <div className="flex flex-1 overflow-hidden">
              <CanvasIframe
                agentId={selectedAgentId}
                content={selectedContent}
                agentName={selectedName}
                host={host}
                onToggleHistory={() => setVersionSidebarOpen(prev => !prev)}
                isHistoryOpen={versionSidebarOpen}
              />
              <VersionHistorySidebar
                agentId={selectedAgentId}
                isOpen={versionSidebarOpen}
                onToggle={() => setVersionSidebarOpen(prev => !prev)}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center flex-1 text-text-dim text-[13px]">
              Select an agent tab above
            </div>
          )}
          </>
          )}
        </>
      )}
    </div>
  )
}
