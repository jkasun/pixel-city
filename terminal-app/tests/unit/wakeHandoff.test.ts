import { describe, expect, it } from 'vitest'
import { OfficeState } from '@pixel-city/shared/office/engine/officeState'
import { performWakeHandoff, type WakeHandoffEmployeeData } from '../../src/renderer/office/wakeHandoff'
import { synthIdFor } from '../../src/renderer/office/synthGhostId'

const PERM = 'nova'
const SYNTH = synthIdFor(PERM)
const REAL = 'agent-real-1'

const emp: WakeHandoffEmployeeData = {
  palette: 3,
  hueShift: 0,
  seatId: null,
  name: 'Nova',
  model: 'sonnet',
  role: 'engineer',
  floorId: 'floor-0',
}

function seedSynth(os: OfficeState) {
  os.addAgent(SYNTH, 3, 0, undefined, true, undefined, 'sonnet')
  const ch = os.characters.get(SYNTH)!
  ch.isPermanent = true
  ch.permanentId = PERM
  ch.visualState = 'asleep'
  ch.visualStateFrom = null
}

describe('performWakeHandoff', () => {
  it('(a) single click: removes synth, adds real char in spawning state, transfers selection', () => {
    const os = new OfficeState()
    seedSynth(os)

    const result = performWakeHandoff(os, PERM, REAL, emp)

    expect(result.removedGhost).toBe(true)
    expect(result.addedCharacter).toBe(true)
    expect(os.characters.has(SYNTH)).toBe(false)
    const real = os.characters.get(REAL)!
    expect(real.isPermanent).toBe(true)
    expect(real.permanentId).toBe(PERM)
    expect(real.visualState).toBe('spawning')
    expect(real.visualStateFrom).toBe('asleep')
    expect(real.spawnReason).toBe('manual')
    expect(os.selectedAgentId).toBe(REAL)
    expect(os.cameraFollowId).toBe(REAL)
  })

  it('(b) idempotent when synth already removed: still promotes real char to spawning', () => {
    const os = new OfficeState()

    const result = performWakeHandoff(os, PERM, REAL, emp)

    expect(result.removedGhost).toBe(false)
    expect(result.addedCharacter).toBe(true)
    const real = os.characters.get(REAL)!
    expect(real.visualState).toBe('spawning')
    expect(os.selectedAgentId).toBe(REAL)
  })

  it('(c) no duplicate when real char already present: patches wake fields, does not re-add', () => {
    const os = new OfficeState()
    seedSynth(os)
    os.addAgent(REAL, 3, 0, undefined, true, undefined, 'sonnet')
    const sizeBefore = os.characters.size

    const result = performWakeHandoff(os, PERM, REAL, emp)

    expect(result.addedCharacter).toBe(false)
    expect(result.removedGhost).toBe(true)
    expect(os.characters.size).toBe(sizeBefore - 1) // synth gone, real stayed
    const real = os.characters.get(REAL)!
    expect(real.visualState).toBe('spawning')
    expect(real.visualStateFrom).toBe('asleep')
    expect(real.permanentId).toBe(PERM)
  })

  it('(d) reducedMotion skips spawning transition, lands directly awake', () => {
    const os = new OfficeState()
    seedSynth(os)

    performWakeHandoff(os, PERM, REAL, emp, { reducedMotion: true })

    const real = os.characters.get(REAL)!
    expect(real.visualState).toBe('awake')
    expect(real.visualStateFrom).toBe(null)
    expect(real.visualStateTimer).toBe(0)
  })
})
