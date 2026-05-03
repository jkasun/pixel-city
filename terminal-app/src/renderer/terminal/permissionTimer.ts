// ── Permission timer (mirrors original pixel-agents timerManager.ts) ──────────
// Extracted from App.tsx — tracks active tools per agent and fires a permission
// timer after ~7s for non-exempt tools.

/** Set of tool names that should NOT trigger the permission timer. */
export const PERMISSION_EXEMPT_TOOLS = new Set(['Task', 'AskUserQuestion'])

/** Delay before the permission timer fires (milliseconds). */
export const PERMISSION_TIMER_MS = 7000

/** Per-agent tracking state for active tools and permission timer. */
export interface AgentTrack {
  activeToolIds: Set<string>
  activeToolNames: Map<string, string>
  permissionTimer: ReturnType<typeof setTimeout> | null
  hadToolsInTurn: boolean
}

/** Get or create an AgentTrack entry from the map. */
export function getTrack(map: Map<number, AgentTrack>, id: number): AgentTrack {
  let t = map.get(id)
  if (!t) {
    t = { activeToolIds: new Set(), activeToolNames: new Map(), permissionTimer: null, hadToolsInTurn: false }
    map.set(id, t)
  }
  return t
}

/** Cancel any pending permission timer on a track. */
export function cancelPermTimer(track: AgentTrack): void {
  if (track.permissionTimer) { clearTimeout(track.permissionTimer); track.permissionTimer = null }
}
