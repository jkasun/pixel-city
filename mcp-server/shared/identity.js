// Live identity helper for MCP servers.
//
// MCP servers are child processes spawned by a Claude Code session and
// historically captured PIXEL_CITY_EMPLOYEE_ID / PIXEL_CITY_BUILDING_ID /
// etc. from process.env at startup. That means any mutation to the agent's
// identity after spawn (e.g. hiring a temp agent into a permanent employee)
// stays invisible to the MCP tools — every "permanent only" gate keeps
// rejecting them until the whole session is restarted.
//
// This helper replaces those captured env vars with a lazy `whoami(agentId)`
// round-trip to the host renderer, which owns the live identity state. A
// short TTL cache (~500ms) keeps tool calls cheap without introducing stale
// reads during normal use.

export function createIdentityHelper(sendCommand, selfAgentId) {
  const TTL_MS = 500
  let cache = null
  let cachedAt = 0

  const envFallback = () => ({
    agentId: selfAgentId,
    name: process.env.PIXEL_CITY_AGENT_NAME || null,
    employeeId: process.env.PIXEL_CITY_EMPLOYEE_ID || null,
    buildingId: process.env.PIXEL_CITY_BUILDING_ID || null,
    isPermanent: !!process.env.PIXEL_CITY_EMPLOYEE_ID,
  })

  async function fetchFresh() {
    if (!selfAgentId) return envFallback()
    try {
      const result = await sendCommand('whoami', { agentId: selfAgentId })
      cache = result
      cachedAt = Date.now()
      return result
    } catch {
      // Host unreachable — fall back to whatever env said at spawn time.
      return envFallback()
    }
  }

  async function getSelfIdentity({ bypassCache = false } = {}) {
    if (!bypassCache && cache && Date.now() - cachedAt < TTL_MS) {
      return cache
    }
    return fetchFresh()
  }

  // Gate helper: returns employeeId or throws. Retries once with a fresh
  // lookup if the cached value says "no employee" — this is the hot path
  // right after hire, where the cache may be <TTL old but stale.
  async function requireEmployeeId(errorMessage) {
    let { employeeId } = await getSelfIdentity()
    if (!employeeId) {
      ({ employeeId } = await getSelfIdentity({ bypassCache: true }))
    }
    if (!employeeId) throw new Error(errorMessage)
    return employeeId
  }

  return { getSelfIdentity, requireEmployeeId }
}
