/**
 * Atomic synth-ghost → live permanent handoff.
 *
 * Pure mutation helper: given an OfficeState and a permanent-employee snapshot,
 * deletes the synth ghost, inserts the real character on its assigned seat
 * with wake-transition visual fields, and transfers selection/camera to the
 * real id — all before any tick/frame observes the intermediate state.
 *
 * Callers:
 *  - Click handler (OfficeApp.handleGhostClick) — single-event, direct.
 *  - Queue-dispatched wake (mention) — via WakeAnimationQueue's
 *    buildAtomic closure to keep burst-event stagger intact.
 *
 * MUST be synchronous. Any async work would let ticks interleave and break
 * the no-gap invariant.
 */
import type { OfficeState } from '@pixel-city/shared/office/engine/officeState'
import type { Character } from '@pixel-city/shared/office/types'
import { synthIdFor } from './synthGhostId.js'

export interface WakeHandoffEmployeeData {
  palette: number
  hueShift?: number
  seatId?: string | null
  name: string
  model: string
  role?: string
  floorId: string
}

export interface WakeHandoffOptions {
  /** Skip the spawning transition — land directly in 'awake'. */
  reducedMotion?: boolean
}

export interface WakeHandoffResult {
  /** True if a synth ghost existed and was removed. */
  removedGhost: boolean
  /** True if a real character was newly added (false if it already existed). */
  addedCharacter: boolean
}

export function performWakeHandoff(
  os: OfficeState,
  permId: string,
  realAgentId: string,
  emp: WakeHandoffEmployeeData,
  opts: WakeHandoffOptions = {},
): WakeHandoffResult {
  const synthId = synthIdFor(permId)
  const removedGhost = os.characters.delete(synthId)
  const hadCharacter = os.characters.has(realAgentId)
  if (!hadCharacter) {
    os.addAgent(
      realAgentId,
      emp.palette,
      emp.hueShift,
      emp.seatId ?? undefined,
      true,
      undefined,
      emp.model,
    )
  }
  const ch: Character | undefined = os.characters.get(realAgentId)
  if (ch) {
    ch.isPermanent = true
    ch.permanentId = permId
    ch.name = emp.name
    ch.role = emp.role
    ch.model = emp.model
    ch.floorId = emp.floorId
    ch.hueShift = emp.hueShift ?? 0
    ch.spawnReason = 'manual'
    if (opts.reducedMotion) {
      ch.visualState = 'awake'
      ch.visualStateFrom = null
      ch.visualStateTimer = 0
    } else {
      ch.visualState = 'spawning'
      ch.visualStateFrom = 'asleep'
      ch.visualStateTimer = 0
    }
  }
  os.selectedAgentId = realAgentId
  os.cameraFollowId = realAgentId
  return { removedGhost, addedCharacter: !hadCharacter }
}
