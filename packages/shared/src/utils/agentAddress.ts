const HANDLE_RE = /^[a-z][a-z0-9-]{2,19}$/

export type HandleValidation = { ok: true } | { ok: false, reason: string }

export function validateHandle(raw: string): HandleValidation {
  if (!raw) return { ok: false, reason: 'Handle is required' }
  if (raw.length < 3) return { ok: false, reason: 'Must be at least 3 characters' }
  if (raw.length > 20) return { ok: false, reason: 'Must be at most 20 characters' }
  if (!/^[a-z]/.test(raw)) return { ok: false, reason: 'Must start with a lowercase letter' }
  if (!HANDLE_RE.test(raw)) return { ok: false, reason: 'Only lowercase letters, numbers, and dashes' }
  return { ok: true }
}

/** Slugify an arbitrary string into a handle-shaped suggestion. May still fail validateHandle. */
export function slugifyHandle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20)
}

export interface AgentAddressParts {
  agentHandle?: string | null
  agentId?: string | null
  buildingHandle?: string | null
  buildingId?: string | null
  userHandle?: string | null
  uid?: string | null
}

/**
 * Build an email-style address like `bumblepebble@myproject.user1`.
 * Falls back per-part to raw IDs when a handle is missing, so entities created
 * before handles were introduced still produce a non-crashing address.
 */
export function buildAgentAddress(parts: AgentAddressParts): string {
  const agent = parts.agentHandle || parts.agentId || 'unknown'
  const building = parts.buildingHandle || parts.buildingId || 'default'
  const user = parts.userHandle || parts.uid || 'unknown'
  return `${agent}@${building}.${user}`
}

/**
 * Canonical MemPalace wing name for an agent. Prefer passing the employee's
 * `handle` when available — falls back to the raw employee/folder id for
 * pre-handle employees. Always produces `wing_<slug>` where <slug> is the
 * input lowercased with any non-alphanumeric char replaced by `_`, so it
 * stays stable across the renderer, main process, and MCP server.
 */
export function buildWingName(handleOrEmployeeId: string): string {
  const slug = handleOrEmployeeId.toLowerCase().replace(/[^a-z0-9]/g, '_')
  return `wing_${slug}`
}
