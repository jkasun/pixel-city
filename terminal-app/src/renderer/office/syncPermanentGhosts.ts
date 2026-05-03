/**
 * syncPermanentGhosts — Wake/Sleep Phase 1 (PR 1)
 *
 * Synthesizes a Character into OfficeState for every permanent employee on the
 * active floor that has no live session. The synthetic Character uses a stable
 * id of `synth-${permanentId}` so re-runs don't re-key and break in-flight
 * transitions (PR 2 landmine).
 *
 * Runs from the 100ms usePermanentEmployees poll. Idempotent.
 */
import type { Character } from '@pixel-city/shared/office/types'
import { CharacterState, Direction, TILE_SIZE } from '@pixel-city/shared/office/types'
import type { OfficeState } from '@pixel-city/shared/office/engine/officeState'
import { hashToUnit } from '@pixel-city/shared/office/engine/wakeAnimationQueue'
import { Z_GLYPH_PERIOD_SEC } from '@pixel-city/shared/constants'
import { officeRegistry } from './officeStateRefs.js'
import { isSynthGhostId, synthIdFor } from './synthGhostId.js'

export { isSynthGhostId, synthIdFor }

export function syncPermanentGhosts(
  os: OfficeState,
  buildingId: string | null,
  activeFloorId: string | null,
): void {
  if (!buildingId) {
    removeAllGhosts(os)
    return
  }
  const snap = officeRegistry.getBuilding(buildingId)
  if (!snap) {
    removeAllGhosts(os)
    return
  }

  const livePermIds = new Set<string>()
  for (const ch of os.characters.values()) {
    if (ch.isPermanent && ch.permanentId && !isSynthGhostId(ch.id)) {
      livePermIds.add(ch.permanentId)
    }
  }

  for (const [permId, emp] of snap.permanentEmployees) {
    if (livePermIds.has(permId)) continue
    const empFloor = emp.settings.floorId ?? 'floor-0'
    if (activeFloorId && empFloor !== activeFloorId) continue

    const synthId = synthIdFor(permId)
    if (os.characters.has(synthId)) continue

    const seatId = emp.settings.seatId ?? null
    const seat = seatId ? os.seats.get(seatId) ?? null : null
    const col = seat ? seat.seatCol : 1
    const row = seat ? seat.seatRow : 1

    const ghost: Character = {
      id: synthId,
      state: seat ? CharacterState.TYPE : CharacterState.IDLE,
      dir: seat ? seat.facingDir : Direction.DOWN,
      x: col * TILE_SIZE + TILE_SIZE / 2,
      y: row * TILE_SIZE + TILE_SIZE / 2,
      tileCol: col,
      tileRow: row,
      path: [],
      moveProgress: 0,
      currentTool: null,
      palette: emp.settings.palette ?? 0,
      hueShift: emp.settings.hueShift ?? 0,
      frame: 0,
      frameTimer: 0,
      wanderTimer: 0,
      wanderCount: 0,
      wanderLimit: 0,
      isActive: false,
      seatId,
      bubbleType: null,
      bubbleTimer: 0,
      seatTimer: 0,
      isSubagent: false,
      parentAgentId: null,
      matrixEffect: null,
      matrixEffectTimer: 0,
      matrixEffectSeeds: [],
      name: emp.settings.name,
      role: emp.settings.role,
      model: emp.settings.model ?? 'sonnet',
      isPermanent: true,
      permanentId: permId,
      floorId: empFloor,
      visualState: 'asleep',
      spawnReason: 'manual',
      visualStateTimer: 0,
      visualStateFrom: null,
      // Deterministic phase seed — stable across resyntheses since synthId is stable.
      glyphPhase: hashToUnit(synthId) * Z_GLYPH_PERIOD_SEC,
    }
    os.characters.set(synthId, ghost)
  }

  for (const id of Array.from(os.characters.keys())) {
    if (!isSynthGhostId(id)) continue
    const ch = os.characters.get(id)!
    const permId = ch.permanentId
    if (!permId) {
      os.characters.delete(id)
      continue
    }
    const emp = snap.permanentEmployees.get(permId)
    if (!emp) {
      os.characters.delete(id)
      continue
    }
    if (livePermIds.has(permId)) {
      os.characters.delete(id)
      continue
    }
    const empFloor = emp.settings.floorId ?? 'floor-0'
    if (activeFloorId && empFloor !== activeFloorId) {
      os.characters.delete(id)
    }
  }
}

function removeAllGhosts(os: OfficeState): void {
  for (const id of Array.from(os.characters.keys())) {
    if (isSynthGhostId(id)) os.characters.delete(id)
  }
}
