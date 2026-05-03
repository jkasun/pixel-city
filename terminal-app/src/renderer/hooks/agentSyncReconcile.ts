import { isSynthGhostId } from '../office/synthGhostId.js'

/**
 * Pure removal-reconciliation for useAgentSync.
 *
 * Given the current character map and the set of live agentIds, returns the
 * ids that must be removed from OfficeState.
 *
 * Rules (kept in sync with the useAgentSync removal loop):
 *   - Subagents are owned by their parent lifecycle — never remove here.
 *   - Characters in a despawn matrix-effect transition — let the effect finish.
 *   - Synth ghosts are owned by syncPermanentGhosts — never touch.
 *   - Everything else not in activeSet is stale and must be removed, including
 *     permanents whose session just ended (syncPermanentGhosts will re-ghost).
 */
export function computeStaleCharacterIds(
  characters: ReadonlyMap<string, { isSubagent?: boolean; matrixEffect?: string | null }>,
  agentIds: ReadonlyArray<string>,
): string[] {
  const activeSet = new Set(agentIds)
  const stale: string[] = []
  for (const [id, ch] of characters) {
    if (ch.isSubagent) continue
    if (ch.matrixEffect === 'despawn') continue
    if (isSynthGhostId(id)) continue
    if (!activeSet.has(id)) stale.push(id)
  }
  return stale
}
