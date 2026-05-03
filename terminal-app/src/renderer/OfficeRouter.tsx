import React, { useState, useEffect, lazy, Suspense } from 'react'
import OfficeApp from './OfficeApp.js'
import { useCityContext } from './contexts/CityContext.js'

const CityApp = lazy(() => import('./city/CityApp.js').then(m => ({ default: m.CityApp })))

/** ErrorBoundary that resets activeCityId on crash so users don't get stuck on a black screen. */
class CityErrorBoundary extends React.Component<
  { children: React.ReactNode; onReset: () => void },
  { hasError: boolean }
> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch(err: Error) { console.error('[CityApp] Crashed, reloading:', err) }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#ccc', background: '#1E1E2E', fontFamily: 'inherit' }}>
          <span style={{ fontSize: '0.85rem' }}>City failed to load</span>
          <button
            onClick={() => { this.setState({ hasError: false }); this.props.onReset() }}
            style={{ padding: '6px 16px', borderRadius: 6, border: '1px solid #555', background: '#2a2a3e', color: '#ccc', cursor: 'pointer', fontSize: '0.78rem' }}
          >
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

interface Route {
  view: 'city' | 'building'
  buildingId?: string
}

function parseRoute(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '')
  const buildingMatch = hash.match(/^building\/(.+)$/)
  if (buildingMatch) return { view: 'building', buildingId: buildingMatch[1] }
  return { view: 'city' }
}

export interface ExistingAgentsData {
  ids: string[]
  palettes: Map<string, number>
  names: Map<string, string>
  models: Map<string, string>
  buildingMap: Map<string, string>
}

interface OfficeRouterProps {
  onAddAgent?: (agentId: string, palette: number, name: string, model: string, buildingId: string | null, initialMessage?: string, permanentId?: string) => void
  onRemoveAgent?: (agentId: string) => void
  onResetAgents?: () => void
  externalSelectedId?: string | null
  onAgentSelect?: (agentId: string | null) => void
  agentStatusMap?: Map<string, string>
  agentWorkerStatusMap?: Map<string, 'idle' | 'working' | 'tool'>
  projectCwd?: string | null
  existingAgents?: ExistingAgentsData
  /** Current list of active agent IDs — used to detect when agents are removed from the sidebar */
  agentIds?: string[]
}

export function OfficeRouter({ onAddAgent, onRemoveAgent, onResetAgents, externalSelectedId, onAgentSelect, agentStatusMap, agentWorkerStatusMap, projectCwd, existingAgents, agentIds }: OfficeRouterProps) {
  const [route, setRoute] = useState<Route>(parseRoute)
  const { activeCityId, setActiveCityId } = useCityContext()

  useEffect(() => {
    const handler = () => setRoute(parseRoute())
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  const loading = (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ccc', background: '#1E1E2E', fontFamily: 'inherit' }}>
      Loading...
    </div>
  )

  // No active city yet — initializing (auto-created on first launch)
  if (!activeCityId) {
    return loading
  }

  if (route.view === 'building' && route.buildingId) {
    return (
      <OfficeApp
        key={`building-${route.buildingId}`}
        buildingId={route.buildingId}
        onAddAgent={onAddAgent}
        onRemoveAgent={onRemoveAgent}
        onResetAgents={onResetAgents}
        externalSelectedId={externalSelectedId}
        onAgentSelect={onAgentSelect}
        agentStatusMap={agentStatusMap}
        agentWorkerStatusMap={agentWorkerStatusMap}
        projectCwd={projectCwd}
        existingAgents={existingAgents}
        agentIds={agentIds}
      />
    )
  }

  return (
    <CityErrorBoundary onReset={() => setActiveCityId(null)}>
      <Suspense fallback={loading}>
        <CityApp key={`city-${activeCityId}`} projectCwd={projectCwd ?? null} />
      </Suspense>
    </CityErrorBoundary>
  )
}
