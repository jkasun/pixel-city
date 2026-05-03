// ── Permission timer (mirrors original pixel-agents timerManager.ts) ──────────

export const PERMISSION_EXEMPT_TOOLS = new Set(['Task', 'AskUserQuestion'])
export const PERMISSION_TIMER_MS = 7000

export interface AgentTrack {
  activeToolIds: Set<string>
  activeToolNames: Map<string, string>
  permissionTimer: ReturnType<typeof setTimeout> | null
  hadToolsInTurn: boolean
}

export function getTrack(map: Map<string, AgentTrack>, id: string): AgentTrack {
  let t = map.get(id)
  if (!t) {
    t = { activeToolIds: new Set(), activeToolNames: new Map(), permissionTimer: null, hadToolsInTurn: false }
    map.set(id, t)
  }
  return t
}

export function cancelPermTimer(track: AgentTrack) {
  if (track.permissionTimer) { clearTimeout(track.permissionTimer); track.permissionTimer = null }
}
