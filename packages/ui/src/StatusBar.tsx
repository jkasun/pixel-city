/**
 * StatusBar — rich shared status bar with breadcrumbs, agent badges, and usage pills.
 *
 * Platform seams replaced with props:
 *   useWorldContext()   → projectName, activeView, bottomPanel, etc.
 *   useCityContext()    → currentRoute, currentBuildingId
 *   useOfficeContext()  → agentIds, agentPalettes, agentNames, agentStatusMap, etc.
 *   platform().usage    → planUsage prop
 *   platform().app      → appVersion prop
 */

import React, { useState, useCallback, useEffect, useRef } from 'react'
import { AgentIcon } from './AgentIcon.js'
import { FolderIcon, CityBreadcrumbIcon, BuildingBreadcrumbIcon, GitBranchIcon, RefreshIcon } from './icons/index.js'
import type { ActiveView, BottomPanelKind } from '@pixel-city/core/session'

export interface UsageBucket {
  utilization: number
  resets_at: string
}

export interface PlanUsage {
  five_hour: UsageBucket | null
  seven_day: UsageBucket | null
  seven_day_sonnet: UsageBucket | null
  seven_day_opus: UsageBucket | null
}

const STATUS_BAR_SPIN_STYLE = `@keyframes status-bar-spin { to { transform: rotate(360deg) } }`

const MAX_VISIBLE_AGENTS = 4

export interface StatusBarProps {
  // Breadcrumb data
  projectName: string
  currentRoute?: 'city' | 'building' | null
  currentBuildingId?: string | null
  appVersion?: string

  // Git info (optional — terminal-app uses this in place of city/office breadcrumb)
  gitBranch?: string | null
  gitStatus?: string | null

  // Agent state
  agentIds: string[]
  activeAgentId: string | null
  agentPalettes: Map<string, number>
  agentNames: Map<string, string>
  agentStatusMap: Map<string, string>

  // View state
  activeView: ActiveView
  onSelectAgent: (id: string) => void

  // Usage
  planUsage?: PlanUsage | null
  usageLoading?: boolean
  onRefreshUsage?: () => void
  bottomPanel?: BottomPanelKind
  onSetBottomPanel?: (v: BottomPanelKind) => void

  // Compat: simple mode for web (falls back to simple layout if only label+agents+connected provided)
  label?: string
  agents?: Array<{ agentId: string; name: string; status: string | null; active: boolean }>
  connected?: boolean
  platformLabel?: string
}

function UsagePill({ label, pct }: { label: string; pct: number }) {
  const normalized = pct > 0 && pct <= 1 ? pct * 100 : pct
  const clamped = Math.min(Math.max(Math.round(normalized), 0), 100)
  const isHigh = clamped >= 80
  const color = isHigh ? '#c87a5a' : undefined
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`text-[10px] font-ui min-w-[16px] ${isHigh ? '' : 'text-text-dim'}`} style={color ? { color } : undefined}>{label}</span>
      <span className="block w-8 h-[4px] bg-white/[0.06] rounded-[2px] overflow-hidden shrink-0">
        <span
          className={`block h-full min-w-[2px] rounded-[2px] transition-[width] duration-300 ease-out ${isHigh ? '' : 'bg-accent'}`}
          style={{ width: `${clamped}%`, backgroundColor: color }}
        />
      </span>
      <span className={`text-[10px] font-ui tabular-nums min-w-[26px] text-right ${isHigh ? '' : 'text-text-muted'}`} style={color ? { color } : undefined}>{clamped}%</span>
    </span>
  )
}

export function StatusBar(props: StatusBarProps) {
  const {
    projectName, currentRoute, currentBuildingId, appVersion,
    gitBranch, gitStatus,
    agentIds = [], activeAgentId = null, agentPalettes = new Map(), agentNames = new Map(),
    agentStatusMap = new Map(),
    activeView = 'agent', onSelectAgent,
    planUsage, usageLoading, onRefreshUsage, bottomPanel, onSetBottomPanel,
    // Compat props for simple mode
    label, agents, connected, platformLabel,
  } = props

  // If using simple compat mode (only label+agents+connected provided), render simple bar
  if (label !== undefined && agents !== undefined && connected !== undefined && !onSelectAgent) {
    return <SimpleStatusBar label={label} agents={agents} connected={connected} platformLabel={platformLabel} />
  }

  const [overflowOpen, setOverflowOpen] = useState(false)
  const overflowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!overflowOpen) return
    const handler = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setOverflowOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [overflowOpen])

  const workingAgentIds = agentIds.filter(id => agentStatusMap.has(id))
  const visibleAgents = workingAgentIds.slice(0, MAX_VISIBLE_AGENTS)
  const overflowAgents = workingAgentIds.slice(MAX_VISIBLE_AGENTS)

  const handleAgentClick = useCallback((id: string) => {
    onSelectAgent?.(id)
    setOverflowOpen(false)
  }, [onSelectAgent])

  // Build breadcrumb
  const breadcrumbParts: { label: string; icon?: React.ReactNode }[] = []
  breadcrumbParts.push({ label: projectName, icon: <FolderIcon size={12} style={{ flexShrink: 0 }} /> })

  if (currentRoute === 'city') {
    breadcrumbParts.push({ label: 'City', icon: <CityBreadcrumbIcon /> })
  } else if (currentRoute === 'building' && currentBuildingId) {
    breadcrumbParts.push({ label: 'City', icon: <CityBreadcrumbIcon /> })
    breadcrumbParts.push({ label: currentBuildingId.replace(/^cb-/, 'Office '), icon: <BuildingBreadcrumbIcon /> })
  }

  return (
    <div data-testid="app-status-bar" className="flex items-center justify-between h-[30px] min-h-[30px] px-3 bg-bg-card border-t border-border font-ui text-[10px] text-text-muted select-none gap-3">
      <style dangerouslySetInnerHTML={{ __html: STATUS_BAR_SPIN_STYLE }} />
      {/* Left: Breadcrumb */}
      <div data-testid="status-bar-branch" className="flex items-center gap-2 min-w-0 shrink">
        <div className="flex items-center gap-[5px] min-w-0">
          {breadcrumbParts.map((part, i) => (
            <React.Fragment key={i}>
              {i > 0 && (
                <span className="text-text-dim opacity-50 text-[10.5px] mx-px">/</span>
              )}
              <span className={`inline-flex items-center gap-1 whitespace-nowrap ${i === breadcrumbParts.length - 1 ? 'text-text' : 'text-text-muted'}`}>
                {part.icon}
                <span>{part.label}</span>
              </span>
            </React.Fragment>
          ))}
        </div>
        {gitBranch && (
          <>
            <span className="w-px h-3 bg-border shrink-0" />
            <span className="inline-flex items-center gap-1 min-w-0 text-text-muted whitespace-nowrap text-[10.5px]">
              <GitBranchIcon size={11} style={{ flexShrink: 0 }} />
              <span className="text-text">{gitBranch}</span>
              {gitStatus && (
                <>
                  <span className="text-text-dim opacity-50 mx-px">|</span>
                  <span className="text-text-dim overflow-hidden text-ellipsis max-w-[280px]">{gitStatus}</span>
                </>
              )}
            </span>
          </>
        )}
        {appVersion && (
          <>
            <span className="w-px h-3 bg-border shrink-0" />
            <span className="text-text-dim text-[10px] whitespace-nowrap">v{appVersion}</span>
          </>
        )}
      </div>

      {/* Right: Usage + Active agents */}
      <div className="flex items-center gap-1.5 shrink-0">
        {planUsage && (planUsage.five_hour || planUsage.seven_day) && (
          <button
            data-testid="status-bar-usage-btn"
            className={`inline-flex items-center gap-1.5 py-px px-1 border-none cursor-pointer rounded-[3px] font-[inherit] transition-colors duration-[120ms] ease-out ${bottomPanel === 'usage' ? 'bg-accent/10' : 'bg-transparent hover:bg-bg-hover'}`}
            onClick={() => onSetBottomPanel?.(bottomPanel === 'usage' ? null : 'usage')}
            title="Toggle usage panel"
          >
            {usageLoading && (
              <span className="inline-block w-[10px] h-[10px] border border-text-dim border-t-accent rounded-full shrink-0" style={{ animation: 'status-bar-spin 0.8s linear infinite' }} />
            )}
            {planUsage.five_hour && <UsagePill label="5h" pct={planUsage.five_hour.utilization} />}
            {planUsage.seven_day && <UsagePill label="1w" pct={planUsage.seven_day.utilization} />}
          </button>
        )}
        {!planUsage && usageLoading && (
          <span className="inline-flex items-center gap-1 text-[10px] text-text-dim">
            <span className="inline-block w-[10px] h-[10px] border border-text-dim border-t-accent rounded-full shrink-0" style={{ animation: 'status-bar-spin 0.8s linear infinite' }} />
          </span>
        )}
        {onRefreshUsage && (
          <button
            data-testid="status-bar-refresh-usage"
            className="inline-flex items-center p-0.5 border-none bg-transparent text-text-dim cursor-pointer rounded-[3px] transition-colors duration-[120ms] ease-out hover:text-accent hover:bg-bg-hover disabled:opacity-40 disabled:cursor-default"
            onClick={(e) => { e.stopPropagation(); onRefreshUsage() }}
            disabled={usageLoading}
            title="Refresh usage"
          >
            <RefreshIcon size={10} style={usageLoading ? { animation: 'status-bar-spin 0.8s linear infinite' } : undefined} />
          </button>
        )}
        <span className="w-px h-3 bg-border shrink-0" />
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {workingAgentIds.length > 0 && (
          <div className="flex items-center gap-1">
            {visibleAgents.map(id => (
              <button
                key={id}
                data-testid={`status-bar-agent-${id}`}
                className={`inline-flex items-center gap-1 py-[2px] pr-2 pl-1 border-none font-[inherit] text-[11px] cursor-pointer rounded-[4px] transition-[background,color] duration-[120ms] ease-out whitespace-nowrap ${activeAgentId === id && activeView === 'agent' ? 'bg-accent/[0.12] text-accent' : 'bg-transparent text-text-muted hover:bg-bg-hover hover:text-text'}`}
                onClick={() => handleAgentClick(id)}
                title={`${agentNames.get(id) ?? `Agent ${id}`}: ${agentStatusMap.get(id) ?? 'working'}`}
              >
                <AgentIcon palette={agentPalettes.get(id) ?? 0} />
                <span className="overflow-hidden text-ellipsis">{agentStatusMap.get(id) ?? 'Working...'}</span>
                <span className="status-bar-agent-indicator" />
              </button>
            ))}
            {overflowAgents.length > 0 && (
              <div className="relative" ref={overflowRef}>
                <button
                  className="inline-flex items-center py-px px-1.5 border-none bg-accent/10 text-accent font-[inherit] text-[10px] cursor-pointer rounded-[3px] transition-colors duration-[120ms] ease-out hover:bg-accent/20"
                  onClick={() => setOverflowOpen(v => !v)}
                  title={`${overflowAgents.length} more active agent${overflowAgents.length > 1 ? 's' : ''}`}
                >
                  +{overflowAgents.length}
                </button>
                {overflowOpen && (
                  <div className="absolute bottom-[calc(100%+6px)] right-0 bg-bg-card border border-border rounded-[6px] p-1 min-w-[200px] shadow-[0_4px_16px_rgba(0,0,0,0.4)] z-[100]">
                    {overflowAgents.map(id => (
                      <button
                        key={id}
                        className="flex items-center gap-1.5 w-full py-[5px] px-2 border-none bg-transparent text-text font-[inherit] text-[11px] cursor-pointer rounded-[4px] text-left transition-colors duration-[120ms] ease-out hover:bg-bg-hover"
                        onClick={() => handleAgentClick(id)}
                      >
                        <AgentIcon palette={agentPalettes.get(id) ?? 0} />
                        <span>{agentNames.get(id) ?? `Agent ${id}`}</span>
                        <span className="ml-auto text-text-dim text-[10px] overflow-hidden text-ellipsis whitespace-nowrap">{agentStatusMap.get(id) ?? 'Working...'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Simple fallback StatusBar (backward compat for web-app's simple usage) ──

function SimpleStatusBar({ label, agents, connected, platformLabel = 'Web' }: {
  label: string
  agents: Array<{ agentId: string; name: string; status: string | null; active: boolean }>
  connected: boolean
  platformLabel?: string
}) {
  const activeAgents = agents.filter(a => a.active)
  return (
    <div style={{
      height: 30, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 12px', borderTop: '1px solid var(--border)', flexShrink: 0,
      fontSize: 10, color: 'var(--text-dim)', background: 'var(--bg)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600 }}>Pixel City</span>
        <span style={{ color: 'var(--border)' }}>/</span>
        <span>{label}</span>
        <span style={{ color: 'var(--border)' }}>·</span>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          color: connected ? '#5ac88c' : '#ef4444',
        }}>
          <span style={{
            width: 5, height: 5, borderRadius: '50%',
            background: connected ? '#5ac88c' : '#ef4444',
          }} />
          {connected ? 'Connected' : 'Disconnected'}
        </span>
        <span style={{ color: 'var(--text-dim)', fontSize: 9, marginLeft: 4 }}>{platformLabel}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {activeAgents.slice(0, 4).map(a => (
          <span key={a.agentId} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 8px', borderRadius: 3, background: 'var(--bg-hover)', fontSize: 9,
          }}>
            <span style={{
              width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 6, color: '#fff', fontWeight: 700,
            }}>
              {a.name.charAt(0).toUpperCase()}
            </span>
            <span style={{ color: 'var(--text-muted)', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {a.status || a.name}
            </span>
          </span>
        ))}
        {activeAgents.length > 4 && <span style={{ fontSize: 9 }}>+{activeAgents.length - 4}</span>}
        {activeAgents.length === 0 && <span>No active agents</span>}
      </div>
    </div>
  )
}
