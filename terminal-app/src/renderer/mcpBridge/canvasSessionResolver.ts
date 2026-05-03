// Canvas Session Resolver — L2 helper.
//
// Maps each agentId to its currently-active sessionId for canvas storage.
// The MCP server itself doesn't know what session it's running under (it's
// a single shared process per agent), so the renderer holds this mapping
// and consults it when an MCP canvas tool call arrives.
//
// The map is populated by:
//   - claude-code spawns (one entry per (agentId, sessionId) at session start)
//   - the user clicking a different session in the session chooser
//
// Falls back to '_default' if nothing has registered an explicit session for
// the agent — handles brand-new agents and pre-session permanent employees.

const DEFAULT_SESSION = '_default'

/** agentId → currently-active sessionId. */
const activeByAgent = new Map<string, string>()

/** Resolve the session id to use for a canvas call from this agent. */
export function resolveActiveSession(agentId: string): string {
  return activeByAgent.get(agentId) ?? DEFAULT_SESSION
}

/** Set/replace the active session for an agent (claude-code spawn / UI switch). */
export function setActiveSessionForAgent(agentId: string, sessionId: string): void {
  if (!agentId || !sessionId) return
  activeByAgent.set(agentId, sessionId)
}

/** Forget the mapping for an agent (e.g. agent removed). */
export function clearActiveSessionForAgent(agentId: string): void {
  activeByAgent.delete(agentId)
}

/** Snapshot the current map — for debugging / diagnostics. */
export function getAllActiveSessions(): ReadonlyMap<string, string> {
  return new Map(activeByAgent)
}
