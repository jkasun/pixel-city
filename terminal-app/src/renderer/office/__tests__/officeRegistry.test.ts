/**
 * Unit tests for OfficeRegistry (L1 domain class).
 *
 * Covers:
 *   - Building activation and snapshot isolation
 *   - Agent registration and lookup
 *   - isAgentInActiveBuilding guard (the MCP mutation gate)
 *   - Permanent employee registration scoped to building
 *   - Cross-building bleed prevention (the original bug)
 *   - Floor stash scoped to building
 *   - removeAgent cleans up all refs atomically
 *   - subscribe/emit event notifications
 */

import { describe, it, expect, vi } from 'vitest'
import { OfficeRegistry } from '../officeRegistry'
import type { AgentRegistration } from '../officeRegistry'
import type { PermanentEmployeeData } from '../officeAppTypes'

// ── Stubs ─────────────────────────────────────────────────────────────────────

/** OfficeState stub — registry only stores the reference, never calls methods on it */
function makeOfficeState(tag = 'default') {
  return { _tag: tag } as any
}

function makeEmployee(
  id: string,
  officeId: string | null,
  floorId = 'floor-0',
): PermanentEmployeeData {
  return {
    id,
    settings: { name: id, palette: 0, hueShift: 0, officeId, floorId, seatId: `seat-${id}`, model: 'sonnet' },
    soul: '',
  }
}

function makeAgent(
  agentId: string,
  buildingId: string,
  overrides: Partial<AgentRegistration> = {},
): AgentRegistration {
  return {
    agentId,
    buildingId,
    floorId: 'floor-0',
    palette: 0,
    name: agentId,
    model: 'sonnet',
    isPermanent: false,
    ...overrides,
  }
}

const BLDG_A = 'building-alpha'
const BLDG_B = 'building-beta'

// ── Building lifecycle ────────────────────────────────────────────────────────

describe('OfficeRegistry — building lifecycle', () => {
  it('activateBuilding creates a snapshot for a new building', () => {
    const reg = new OfficeRegistry()
    const state = makeOfficeState('A')
    const snap = reg.activateBuilding(BLDG_A, state)
    expect(snap.buildingId).toBe(BLDG_A)
    expect(snap.officeState).toBe(state)
  })

  it('getActiveBuilding returns the currently activated building', () => {
    const reg = new OfficeRegistry()
    reg.activateBuilding(BLDG_A, makeOfficeState())
    expect(reg.getActiveBuilding()).toBe(BLDG_A)
    reg.activateBuilding(BLDG_B, makeOfficeState())
    expect(reg.getActiveBuilding()).toBe(BLDG_B)
  })

  it('getBuilding returns null for unknown building', () => {
    const reg = new OfficeRegistry()
    expect(reg.getBuilding('no-such-building')).toBeNull()
  })

  it('re-activating a building updates its officeState reference', () => {
    const reg = new OfficeRegistry()
    reg.activateBuilding(BLDG_A, makeOfficeState('v1'))
    const stateV2 = makeOfficeState('v2')
    reg.activateBuilding(BLDG_A, stateV2)
    expect(reg.getBuilding(BLDG_A)?.officeState).toBe(stateV2)
  })

  it('switching buildings preserves the snapshot of the previous building', () => {
    const reg = new OfficeRegistry()
    reg.activateBuilding(BLDG_A, makeOfficeState())
    reg.registerAgent(makeAgent('agent-1', BLDG_A))
    reg.activateBuilding(BLDG_B, makeOfficeState())
    // Building A snapshot must still exist with agent-1
    expect(reg.getBuilding(BLDG_A)?.agents.has('agent-1')).toBe(true)
  })
})

// ── Agent registration ────────────────────────────────────────────────────────

describe('OfficeRegistry — agent registration', () => {
  it('registerAgent adds agent to correct building snapshot', () => {
    const reg = new OfficeRegistry()
    reg.activateBuilding(BLDG_A, makeOfficeState())
    reg.registerAgent(makeAgent('agent-1', BLDG_A))
    expect(reg.getAgentsForBuilding(BLDG_A).map(a => a.agentId)).toContain('agent-1')
  })

  it('getBuildingForAgent returns the correct building', () => {
    const reg = new OfficeRegistry()
    reg.activateBuilding(BLDG_A, makeOfficeState())
    reg.activateBuilding(BLDG_B, makeOfficeState())
    reg.registerAgent(makeAgent('agent-a', BLDG_A))
    reg.registerAgent(makeAgent('agent-b', BLDG_B))
    expect(reg.getBuildingForAgent('agent-a')).toBe(BLDG_A)
    expect(reg.getBuildingForAgent('agent-b')).toBe(BLDG_B)
  })

  it('getBuildingForAgent returns null for unknown agent', () => {
    const reg = new OfficeRegistry()
    expect(reg.getBuildingForAgent('ghost')).toBeNull()
  })

  it('getAgentsForBuilding only returns agents from that building', () => {
    const reg = new OfficeRegistry()
    reg.activateBuilding(BLDG_A, makeOfficeState())
    reg.activateBuilding(BLDG_B, makeOfficeState())
    reg.registerAgent(makeAgent('a1', BLDG_A))
    reg.registerAgent(makeAgent('a2', BLDG_A))
    reg.registerAgent(makeAgent('b1', BLDG_B))

    const aAgents = reg.getAgentsForBuilding(BLDG_A).map(a => a.agentId)
    expect(aAgents).toContain('a1')
    expect(aAgents).toContain('a2')
    expect(aAgents).not.toContain('b1')
  })

  it('removeAgent cleans up agent index and building snapshot atomically', () => {
    const reg = new OfficeRegistry()
    reg.activateBuilding(BLDG_A, makeOfficeState())
    reg.registerAgent(makeAgent('agent-x', BLDG_A))
    reg.removeAgent('agent-x')
    expect(reg.getBuildingForAgent('agent-x')).toBeNull()
    expect(reg.getAgentsForBuilding(BLDG_A).map(a => a.agentId)).not.toContain('agent-x')
  })

  it('removeAgent on unknown agent is a no-op', () => {
    const reg = new OfficeRegistry()
    expect(() => reg.removeAgent('ghost')).not.toThrow()
  })
})

// ── MCP guard ─────────────────────────────────────────────────────────────────

describe('OfficeRegistry — isAgentInActiveBuilding (MCP mutation gate)', () => {
  it('returns true for an agent in the currently active building', () => {
    const reg = new OfficeRegistry()
    reg.activateBuilding(BLDG_A, makeOfficeState())
    reg.registerAgent(makeAgent('agent-a', BLDG_A))
    expect(reg.isAgentInActiveBuilding('agent-a')).toBe(true)
  })

  it('returns false for an agent in a different building — prevents cross-building mutation', () => {
    const reg = new OfficeRegistry()
    reg.activateBuilding(BLDG_A, makeOfficeState())
    reg.registerAgent(makeAgent('agent-a', BLDG_A))
    reg.activateBuilding(BLDG_B, makeOfficeState()) // user navigates to B
    // agent-a is still in A — must NOT be allowed to mutate B's canvas
    expect(reg.isAgentInActiveBuilding('agent-a')).toBe(false)
  })

  it('returns false for an unregistered agent', () => {
    const reg = new OfficeRegistry()
    reg.activateBuilding(BLDG_A, makeOfficeState())
    expect(reg.isAgentInActiveBuilding('ghost')).toBe(false)
  })

  it('returns false when no building is active', () => {
    const reg = new OfficeRegistry()
    expect(reg.isAgentInActiveBuilding('any-agent')).toBe(false)
  })
})

// ── Permanent employees ───────────────────────────────────────────────────────

describe('OfficeRegistry — permanent employee scoping', () => {
  it('registerPermanentEmployee stores employee in the correct building snapshot', () => {
    const reg = new OfficeRegistry()
    reg.activateBuilding(BLDG_A, makeOfficeState())
    reg.activateBuilding(BLDG_B, makeOfficeState())
    const emp = makeEmployee('nova', BLDG_A)
    reg.registerPermanentEmployee(emp)

    expect(reg.getBuilding(BLDG_A)?.permanentEmployees.has('nova')).toBe(true)
    expect(reg.getBuilding(BLDG_B)?.permanentEmployees.has('nova')).toBe(false)
  })

  it('getAgentIdForPermanent resolves within the correct building (agentId === permanentId)', () => {
    const reg = new OfficeRegistry()
    reg.activateBuilding(BLDG_A, makeOfficeState())
    reg.registerPermanentEmployee(makeEmployee('nova', BLDG_A))
    expect(reg.getAgentIdForPermanent('nova', BLDG_A)).toBe('nova')
  })

  it('getAgentIdForPermanent returns null for a different building', () => {
    const reg = new OfficeRegistry()
    reg.activateBuilding(BLDG_A, makeOfficeState())
    reg.activateBuilding(BLDG_B, makeOfficeState())
    reg.registerPermanentEmployee(makeEmployee('nova', BLDG_A))
    // nova belongs to A, should not be found under B
    expect(reg.getAgentIdForPermanent('nova', BLDG_B)).toBeNull()
  })

  it('getPermanentIdForAgent returns the agentId itself for a registered permanent', () => {
    const reg = new OfficeRegistry()
    reg.activateBuilding(BLDG_A, makeOfficeState())
    reg.registerPermanentEmployee(makeEmployee('nova', BLDG_A))
    expect(reg.getPermanentIdForAgent('nova')).toBe('nova')
  })

  it('getPermanentIdForAgent returns null for non-permanent agent', () => {
    const reg = new OfficeRegistry()
    reg.activateBuilding(BLDG_A, makeOfficeState())
    reg.registerAgent(makeAgent('temp', BLDG_A))
    expect(reg.getPermanentIdForAgent('temp')).toBeNull()
  })

  it('employee from building A does NOT appear in building B permanent list — cross-building bleed', () => {
    const reg = new OfficeRegistry()
    reg.activateBuilding(BLDG_A, makeOfficeState())
    reg.activateBuilding(BLDG_B, makeOfficeState())
    reg.registerPermanentEmployee(makeEmployee('nova', BLDG_A))
    reg.registerPermanentEmployee(makeEmployee('alice', BLDG_B))

    const aEmps = reg.getBuilding(BLDG_A)!.permanentEmployees
    const bEmps = reg.getBuilding(BLDG_B)!.permanentEmployees

    expect(aEmps.has('nova')).toBe(true)
    expect(aEmps.has('alice')).toBe(false) // alice is in B, not A
    expect(bEmps.has('alice')).toBe(true)
    expect(bEmps.has('nova')).toBe(false)  // nova is in A, not B
  })
})

// ── Floor stash ───────────────────────────────────────────────────────────────

describe('OfficeRegistry — floor stash', () => {
  it('stashCharacter stores character scoped to its building', () => {
    const reg = new OfficeRegistry()
    reg.activateBuilding(BLDG_A, makeOfficeState())
    reg.activateBuilding(BLDG_B, makeOfficeState())
    const char = { id: 'agent-1', floorId: 'floor-1' } as any
    reg.stashCharacter('agent-1', BLDG_A, char)

    expect(reg.getBuilding(BLDG_A)?.floorStash.has('agent-1')).toBe(true)
    expect(reg.getBuilding(BLDG_B)?.floorStash.has('agent-1')).toBe(false)
  })

  it('popStashedCharacters returns only characters matching building + floor', () => {
    const reg = new OfficeRegistry()
    reg.activateBuilding(BLDG_A, makeOfficeState())
    reg.stashCharacter('agent-floor0', BLDG_A, { id: 'agent-floor0', floorId: 'floor-0' } as any)
    reg.stashCharacter('agent-floor1', BLDG_A, { id: 'agent-floor1', floorId: 'floor-1' } as any)

    const popped = reg.popStashedCharacters(BLDG_A, 'floor-1')
    expect(popped.map(c => c.id)).toContain('agent-floor1')
    expect(popped.map(c => c.id)).not.toContain('agent-floor0')
  })

  it('popStashedCharacters removes returned entries from the stash', () => {
    const reg = new OfficeRegistry()
    reg.activateBuilding(BLDG_A, makeOfficeState())
    reg.stashCharacter('agent-1', BLDG_A, { id: 'agent-1', floorId: 'floor-0' } as any)

    reg.popStashedCharacters(BLDG_A, 'floor-0')
    expect(reg.getBuilding(BLDG_A)?.floorStash.has('agent-1')).toBe(false)
  })

  it('stash from building A does NOT bleed into building B floor switch', () => {
    const reg = new OfficeRegistry()
    reg.activateBuilding(BLDG_A, makeOfficeState())
    reg.activateBuilding(BLDG_B, makeOfficeState())

    // Agent from building A stashed on floor-0
    reg.stashCharacter('agent-a', BLDG_A, { id: 'agent-a', floorId: 'floor-0' } as any)

    // Building B floor switch to floor-0 must NOT return building A's stash
    const popped = reg.popStashedCharacters(BLDG_B, 'floor-0')
    expect(popped.map(c => c.id)).not.toContain('agent-a')
  })
})

// ── Subscriptions ─────────────────────────────────────────────────────────────

describe('OfficeRegistry — subscriptions', () => {
  it('emits building_activated when activateBuilding is called', () => {
    const reg = new OfficeRegistry()
    const listener = vi.fn()
    reg.subscribe(listener)
    reg.activateBuilding(BLDG_A, makeOfficeState())
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: 'building_activated',
      buildingId: BLDG_A,
    }))
  })

  it('emits building_deactivated for previous building when switching', () => {
    const reg = new OfficeRegistry()
    const listener = vi.fn()
    reg.subscribe(listener)
    reg.activateBuilding(BLDG_A, makeOfficeState())
    reg.activateBuilding(BLDG_B, makeOfficeState())
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: 'building_deactivated',
      buildingId: BLDG_A,
    }))
  })

  it('emits agent_registered when registerAgent is called', () => {
    const reg = new OfficeRegistry()
    const listener = vi.fn()
    reg.subscribe(listener)
    reg.activateBuilding(BLDG_A, makeOfficeState())
    reg.registerAgent(makeAgent('agent-1', BLDG_A))
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: 'agent_registered',
      buildingId: BLDG_A,
      agentId: 'agent-1',
    }))
  })

  it('emits agent_removed when removeAgent is called', () => {
    const reg = new OfficeRegistry()
    reg.activateBuilding(BLDG_A, makeOfficeState())
    reg.registerAgent(makeAgent('agent-1', BLDG_A))
    const listener = vi.fn()
    reg.subscribe(listener)
    reg.removeAgent('agent-1')
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: 'agent_removed',
      agentId: 'agent-1',
    }))
  })

  it('unsubscribe removes the listener', () => {
    const reg = new OfficeRegistry()
    const listener = vi.fn()
    const unsub = reg.subscribe(listener)
    unsub()
    reg.activateBuilding(BLDG_A, makeOfficeState())
    expect(listener).not.toHaveBeenCalled()
  })

  it('listener errors do not crash the registry', () => {
    const reg = new OfficeRegistry()
    reg.subscribe(() => { throw new Error('listener exploded') })
    expect(() => reg.activateBuilding(BLDG_A, makeOfficeState())).not.toThrow()
  })
})
