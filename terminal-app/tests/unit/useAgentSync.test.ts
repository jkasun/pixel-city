import { describe, expect, it } from 'vitest'
import { computeStaleCharacterIds } from '../../src/renderer/hooks/agentSyncReconcile'

type Ch = { isSubagent?: boolean; matrixEffect?: string | null }

function chars(entries: Array<[string, Ch]>): Map<string, Ch> {
  return new Map(entries)
}

describe('computeStaleCharacterIds', () => {
  it('removes permanents whose session ended (the leak fix)', () => {
    // Repro of the original leak: three perms were spawned this Electron
    // run, sessions ended, but characters stayed behind with isPermanent=true.
    // The prior code skipped removal on isPermanent, leaking stale awake chars.
    const map = chars([
      ['perm-ash', {}],
      ['perm-coral', {}],
      ['perm-luna', {}],
    ])
    expect(computeStaleCharacterIds(map, [])).toEqual(['perm-ash', 'perm-coral', 'perm-luna'])
  })

  it('keeps characters that are still in agentIds', () => {
    const map = chars([['a', {}], ['b', {}]])
    expect(computeStaleCharacterIds(map, ['a', 'b'])).toEqual([])
  })

  it('removes only the ids not in the active set', () => {
    const map = chars([['a', {}], ['b', {}], ['c', {}]])
    expect(computeStaleCharacterIds(map, ['a', 'c'])).toEqual(['b'])
  })

  it('never removes synth ghosts — those are owned by syncPermanentGhosts', () => {
    const map = chars([
      ['synth-gizmo', {}],
      ['synth-snap', {}],
      ['real-agent', {}],
    ])
    expect(computeStaleCharacterIds(map, [])).toEqual(['real-agent'])
  })

  it('never removes subagents — parent lifecycle owns them', () => {
    const map = chars([
      ['parent', { isSubagent: false }],
      ['sub-1', { isSubagent: true }],
    ])
    expect(computeStaleCharacterIds(map, [])).toEqual(['parent'])
  })

  it('skips characters currently in a despawn transition', () => {
    const map = chars([
      ['a', { matrixEffect: 'despawn' }],
      ['b', {}],
    ])
    expect(computeStaleCharacterIds(map, [])).toEqual(['b'])
  })
})
