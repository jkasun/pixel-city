import { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshIcon } from './icons/index.js'
import { platform } from './platform/index.js'
import { loadPixelCitySettings } from './settings.js'

// ── Types ──────────────────────────────────────────────────────

interface PlanUsageBucket {
  utilization: number
  resets_at: string
}

interface PlanUsageData {
  five_hour: PlanUsageBucket | null
  seven_day: PlanUsageBucket | null
  seven_day_sonnet: PlanUsageBucket | null
  seven_day_opus: PlanUsageBucket | null
  extra_usage: { is_enabled: boolean; used_credits: number | null; monthly_limit: number | null; utilization: number | null } | null
}

interface StatsCache {
  hourCounts?: Record<string, number>
}

// ── Helpers ────────────────────────────────────────────────────

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.floor(hr / 24)
  return `${days}d ago`
}

function formatResetTime(isoStr: string): string {
  const diff = new Date(isoStr).getTime() - Date.now()
  if (diff <= 0) return 'now'
  const totalMin = Math.floor(diff / 60000)
  if (totalMin < 60) return `${totalMin} min`
  const hr = Math.floor(totalMin / 60)
  const rm = totalMin % 60
  if (hr < 24) return rm > 0 ? `${hr} hr ${rm} min` : `${hr} hr`
  const d = new Date(isoStr)
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const hh = d.getHours()
  const mm = d.getMinutes()
  const ampm = hh >= 12 ? 'PM' : 'AM'
  const h12 = hh % 12 || 12
  return `${days[d.getDay()]} ${h12}:${String(mm).padStart(2, '0')} ${ampm}`
}

// ── Plan Usage Bars ────────────────────────────────────────────

function UsageBar({ label, bucket, color }: { label: string; bucket: PlanUsageBucket; color: string }) {
  const pct = Math.min(Math.max(bucket.utilization, 0), 100)
  const isHigh = pct >= 80
  const resetLabel = `Resets in ${formatResetTime(bucket.resets_at)}`

  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-baseline justify-between mb-1.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-[0.78rem] text-text font-medium">{label}</span>
          <span className="text-[0.65rem] text-text-dim">{resetLabel}</span>
        </div>
        <span className={`text-[0.78rem] tabular-nums shrink-0 ${isHigh ? 'text-[#c97b7b]' : 'text-text-muted'}`}>{pct}% used</span>
      </div>
      <div className="h-1.5 bg-bg border border-border rounded-[3px] overflow-hidden">
        <div
          className={`h-full rounded-[2px] transition-[width] duration-400 ease-out min-w-[2px]${isHigh ? ' !bg-[#c97b7b]' : ''}`}
          style={{ width: `${pct}%`, background: isHigh ? undefined : color }}
        />
      </div>
    </div>
  )
}

function PlanUsageCard({ plan, lastUpdated }: { plan: PlanUsageData; lastUpdated: Date | null }) {
  const hasWeekly = plan.seven_day || plan.seven_day_sonnet || plan.seven_day_opus

  return (
    <div className="bg-bg-card border border-border rounded-[6px] px-3.5 py-3 mb-2">
      <div className="text-[0.82rem] font-semibold text-text-bright mb-2.5">Plan usage limits</div>

      {plan.five_hour && (
        <UsageBar label="Current session" bucket={plan.five_hour} color="#5c9a7d" />
      )}

      {hasWeekly && (
        <>
          <div className="h-px bg-border my-3" />
          <div className="text-[0.82rem] font-semibold text-text-bright mb-2.5">Weekly limits</div>

          {plan.seven_day && (
            <UsageBar label="All models" bucket={plan.seven_day} color="#5c9a7d" />
          )}
          {plan.seven_day_sonnet && (
            <UsageBar label="Sonnet only" bucket={plan.seven_day_sonnet} color="#4a8a6d" />
          )}
          {plan.seven_day_opus && (
            <UsageBar label="Opus only" bucket={plan.seven_day_opus} color="#3d7a60" />
          )}
        </>
      )}

      {lastUpdated && (
        <div className="text-[0.62rem] text-text-dim mt-2.5 pt-2 border-t border-border">
          Last updated: {relativeTime(lastUpdated.getTime())}
        </div>
      )}

      {plan.extra_usage && (
        <>
          <div className="h-px bg-border my-3" />
          <div className="flex items-center justify-between text-[0.78rem] text-text">
            <span>Extra usage</span>
            <span className={`text-[0.62rem] uppercase tracking-[0.06em] px-1.5 py-0.5 rounded-[3px] font-semibold border ${
              plan.extra_usage.is_enabled
                ? 'text-accent border-accent-dim bg-[rgba(92,154,125,0.1)]'
                : 'text-text-dim bg-bg border-border'
            }`}>
              {plan.extra_usage.is_enabled ? 'On' : 'Off'}
            </span>
          </div>
        </>
      )}
    </div>
  )
}

function PlanUnavailableCard({ onRetry, loading }: { onRetry: () => void; loading: boolean }) {
  return (
    <div className="bg-bg-card border border-border rounded-[6px] px-3.5 py-3 mb-2">
      <div className="text-[0.82rem] font-semibold text-text-bright mb-2.5">Plan usage limits</div>
      <div className="flex flex-col gap-2.5">
        <span className="text-[0.72rem] text-text-dim leading-[1.4]">
          Couldn't read <code className="font-mono text-[0.68rem]">/usage</code> from Claude Code. Make sure the <code className="font-mono text-[0.68rem]">claude</code> CLI is on your PATH and signed in.
        </span>
        <button
          className="self-start bg-transparent border border-accent-dim text-accent font-ui text-[0.72rem] px-3.5 py-1.5 cursor-pointer tracking-[0.02em] transition-[background,border-color] duration-[0.12s] hover:bg-[rgba(92,154,125,0.08)] hover:border-accent disabled:opacity-50"
          onClick={onRetry}
          disabled={loading}
        >{loading ? 'Checking…' : 'Retry'}</button>
      </div>
    </div>
  )
}

// ── Hour heatmap ───────────────────────────────────────────────

function HourHeatmap({ hourCounts }: { hourCounts: Record<string, number> }) {
  const max = Math.max(...Object.values(hourCounts), 1)
  const hours = Array.from({ length: 24 }, (_, i) => i)

  return (
    <div className="flex gap-0.5 flex-nowrap">
      {hours.map(h => {
        const count = hourCounts[String(h)] || 0
        const intensity = count / max
        return (
          <div
            key={h}
            className="flex-1 h-4 rounded-[2px] border border-border relative min-w-0"
            title={`${h}:00 - ${count} sessions`}
            style={{
              background: count > 0
                ? `rgba(92, 154, 125, ${0.15 + intensity * 0.7})`
                : 'var(--bg)',
            }}
          >
            {h % 6 === 0 ? (
              <span className="absolute bottom-[-12px] left-1/2 -translate-x-1/2 text-[7px] text-text-dim">{h}</span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

// ── Persistence ───────────────────────────────────────────────

const USAGE_STORAGE_PREFIX = 'pixel-city-usage:'

function usageCacheKey(configDir: string | undefined): string {
  return `${USAGE_STORAGE_PREFIX}${configDir || '__default__'}`
}

function loadCachedUsage(configDir: string | undefined): { plan: PlanUsageData; updatedAt: number } | null {
  try {
    const raw = localStorage.getItem(usageCacheKey(configDir))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?.plan && typeof parsed.updatedAt === 'number') return parsed
  } catch { /* noop */ }
  return null
}

function saveCachedUsage(configDir: string | undefined, plan: PlanUsageData): void {
  try {
    localStorage.setItem(usageCacheKey(configDir), JSON.stringify({ plan, updatedAt: Date.now() }))
  } catch { /* noop */ }
}

// ── Main Panel ─────────────────────────────────────────────────

const POLL_INTERVAL_MS = 600_000 // 10 minutes

interface UsagePanelProps {
  projectCwd: string | null
  projectClaudeConfigDir?: string | null
}

export function UsagePanel({ projectCwd: _projectCwd, projectClaudeConfigDir }: UsagePanelProps) {
  const [stats, setStats] = useState<StatsCache | null>(null)
  const [plan, setPlan] = useState<PlanUsageData | null>(null)
  const [planUpdated, setPlanUpdated] = useState<Date | null>(null)
  const [planUnavailable, setPlanUnavailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  // Resolve the CLAUDE_CONFIG_DIR to scrape /usage against:
  // per-project override > global.
  const resolveConfigDir = useCallback((): string | undefined => {
    if (projectClaudeConfigDir) return projectClaudeConfigDir
    return loadPixelCitySettings().claudeConfigDir || undefined
  }, [projectClaudeConfigDir])

  // Restore persisted usage on mount so the panel is instant.
  useEffect(() => {
    const configDir = resolveConfigDir()
    const cached = loadCachedUsage(configDir)
    if (cached) {
      setPlan(cached.plan)
      setPlanUpdated(new Date(cached.updatedAt))
      setPlanUnavailable(false)
    }
  }, [resolveConfigDir])

  // Use a ref to read current plan without adding it as a dependency
  const planRef = useRef(plan)
  planRef.current = plan

  const loadData = useCallback(async (opts?: { force?: boolean }) => {
    setLoading(true)
    const configDir = resolveConfigDir()
    const [statsRes, planRes] = await Promise.all([
      platform().usage.getStats() as any,
      platform().usage.getPlan({ configDir, force: opts?.force }) as any,
    ])
    if (statsRes.success && statsRes.stats) setStats(statsRes.stats)
    if (planRes.success && planRes.data) {
      setPlan(planRes.data)
      setPlanUpdated(new Date())
      setPlanUnavailable(false)
      saveCachedUsage(configDir, planRes.data)
    } else if (!planRef.current) {
      // Only mark unavailable if we have no cached data to show
      setPlan(null)
      setPlanUnavailable(true)
    }
    setLoading(false)
  }, [resolveConfigDir])

  useEffect(() => {
    loadData()
    refreshTimer.current = setInterval(() => loadData(), POLL_INTERVAL_MS)
    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current)
    }
  }, [loadData])

  const handleRefresh = useCallback(() => {
    loadData({ force: true })
  }, [loadData])

  if (loading) {
    return (
      <div className="flex flex-col h-full text-text">
        <div className="flex-1 flex flex-col items-center justify-center text-text-dim text-[0.82rem] gap-1">Loading usage data...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full text-text">
      <div className="flex items-center gap-0.5 px-2 border-b border-border shrink-0">
        <span className="bg-transparent border-0 border-b-2 border-b-accent text-accent font-inherit text-[0.72rem] font-medium px-2.5 pt-1.5 pb-1 cursor-pointer transition-[color,border-color] duration-[0.12s] whitespace-nowrap">Usage</span>
        <button
          className="ml-auto bg-transparent border-0 text-text-dim cursor-pointer p-1 rounded-[3px] flex items-center transition-colors duration-[0.12s] hover:text-accent disabled:opacity-40"
          onClick={handleRefresh}
          disabled={loading}
          title="Refresh /usage from Claude Code"
        >
          <RefreshIcon />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 py-2 [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:rounded-[2px]">
        {/* Plan usage limits */}
        {plan ? (
          <PlanUsageCard plan={plan} lastUpdated={planUpdated} />
        ) : planUnavailable ? (
          <PlanUnavailableCard onRetry={handleRefresh} loading={loading} />
        ) : null}

        {/* Active hours heatmap */}
        {stats?.hourCounts && Object.keys(stats.hourCounts).length > 0 && (
          <div className="mt-3">
            <div className="text-[0.62rem] uppercase tracking-[0.12em] text-text-dim mb-1.5 font-semibold">Active Hours</div>
            <HourHeatmap hourCounts={stats.hourCounts} />
          </div>
        )}
      </div>
    </div>
  )
}
