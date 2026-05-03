/**
 * Synth-ghost id contract — single source of truth.
 *
 * Pure module: no Electron/DOM imports so it's usable from unit tests and
 * any layer that needs to recognise/produce synth ghost ids without pulling
 * in the full syncPermanentGhosts dependency graph.
 */
export const SYNTH_PREFIX = 'synth-'

export function isSynthGhostId(id: string): boolean {
  return id.startsWith(SYNTH_PREFIX)
}

export function synthIdFor(permId: string): string {
  return `${SYNTH_PREFIX}${permId}`
}
