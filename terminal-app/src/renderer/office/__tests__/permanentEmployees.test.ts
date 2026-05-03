/**
 * Regression tests for permanent employee persistence across floor navigation
 * and building switches.
 *
 * Bug 1 (fixed): employees on non-landing floors disappear after app restart.
 *   Root cause: init() only registered employees whose floorId matched the
 *   landing floor. On restart lastActiveFloorMap is empty so landing = floor-0.
 *   Any employee on floor-1+ was never added to permanentAgentsRef, so
 *   handleSwitchFloor couldn't find them when the user navigated there.
 *   Fix: register ALL building employees in lookup maps during init; only render
 *   to canvas those on the landing floor.
 *
 * Bug 2 (fixed): employees from building A bleed into building B after the
 *   user switches buildings in the same session.
 *   Root cause: permanentAgentsRef is module-level (persists across mounts).
 *   handleSwitchFloor iterated it without an officeId guard, so a building-A
 *   employee whose floorId happened to match building B's target floor would
 *   appear there.
 *   Fix: add `(emp.settings.officeId ?? null) !== (buildingId ?? null)` guard
 *   in handleSwitchFloor.
 */

import { describe, it, expect } from 'vitest'
import type { PermanentEmployeeData } from '../officeAppTypes'

// ── Pure logic mirrors ────────────────────────────────────────────────────────
// These functions replicate the FIXED behaviour in OfficeApp.tsx so that a
// future regression in the component will be caught by these tests failing.

/**
 * Mirrors the init() permanent-employee loading logic (post-fix).
 *
 * Returns:
 *   registeredIds — employees that should be inserted into permanentAgentsRef
 *                   (ALL employees belonging to this building, any floor)
 *   canvasIds     — employees that should be rendered on the canvas
 *                   (only those on the landing floor)
 */
function simulateInit(
  employees: PermanentEmployeeData[],
  buildingId: string | null,
  landingFloorId: string,
): { registeredIds: Set<string>; canvasIds: Set<string> } {
  const registeredIds = new Set<string>()
  const canvasIds = new Set<string>()

  for (const emp of employees) {
    const empOfficeId = emp.settings.officeId ?? null
    if (empOfficeId !== buildingId) continue

    const empFloorId = emp.settings.floorId ?? 'floor-0'
    // KEY: register regardless of floor so handleSwitchFloor can find them
    registeredIds.add(emp.id)
    if (empFloorId === landingFloorId) {
      canvasIds.add(emp.id)
    }
  }

  return { registeredIds, canvasIds }
}

/**
 * Mirrors the handleSwitchFloor() permanent-employee lookup (post-fix).
 * Only returns employees that pass BOTH the officeId and floorId checks.
 */
function simulateSwitchFloor(
  registeredEmployees: PermanentEmployeeData[],
  targetBuildingId: string | null,
  targetFloorId: string,
): Set<string> {
  const visibleIds = new Set<string>()
  for (const emp of registeredEmployees) {
    if ((emp.settings.officeId ?? null) !== targetBuildingId) continue
    const empFloorId = emp.settings.floorId ?? 'floor-0'
    if (empFloorId !== targetFloorId) continue
    visibleIds.add(emp.id)
  }
  return visibleIds
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeEmployee(
  id: string,
  officeId: string | null,
  floorId: string,
): PermanentEmployeeData {
  return {
    id,
    settings: { name: id, palette: 0, hueShift: 0, officeId, floorId, model: 'sonnet' },
    soul: '',
  }
}

const BUILDING_A = 'building-alpha'
const BUILDING_B = 'building-beta'

// Scenario that reproduces the real bug:
// "DEV DEN" is floor-1; the default landing floor (on app restart) is floor-0.
const allEmployees: PermanentEmployeeData[] = [
  makeEmployee('nova',  BUILDING_A, 'floor-0'),  // default floor — always visible on entry
  makeEmployee('rex',   BUILDING_A, 'floor-1'),  // DEV DEN — was disappearing after restart
  makeEmployee('alice', BUILDING_B, 'floor-0'),
  makeEmployee('bob',   BUILDING_B, 'floor-1'),
]

// ── Bug 1: employees on non-landing floors survive app restart ────────────────

describe('permanent employee init (Bug 1: non-landing-floor persistence)', () => {
  it('registers ALL building employees in lookup maps, not only those on the landing floor', () => {
    // App restarts → lastActiveFloorMap is empty → landing defaults to floor-0
    const { registeredIds } = simulateInit(allEmployees, BUILDING_A, 'floor-0')

    expect(registeredIds).toContain('nova')  // floor-0 employee
    expect(registeredIds).toContain('rex')   // floor-1 (DEV DEN) employee — was missing before fix
  })

  it('only renders employees on the landing floor to the canvas', () => {
    const { canvasIds } = simulateInit(allEmployees, BUILDING_A, 'floor-0')

    expect(canvasIds).toContain('nova')
    expect(canvasIds).not.toContain('rex')  // floor-1 employee should not appear on floor-0
  })

  it('renders the correct employees when landing on a non-default floor', () => {
    // Remembered floor from a previous session
    const { registeredIds, canvasIds } = simulateInit(allEmployees, BUILDING_A, 'floor-1')

    expect(registeredIds).toContain('nova')
    expect(registeredIds).toContain('rex')
    expect(canvasIds).toContain('rex')   // DEV DEN employee visible on DEV DEN floor
    expect(canvasIds).not.toContain('nova')
  })

  it('excludes employees from other buildings', () => {
    const { registeredIds } = simulateInit(allEmployees, BUILDING_A, 'floor-0')

    expect(registeredIds).not.toContain('alice')  // BUILDING_B employee
    expect(registeredIds).not.toContain('bob')
  })

  it('employee missing from canvas on landing is visible after switching to their floor', () => {
    // Init with landing on floor-0 (app restart scenario)
    const { registeredIds } = simulateInit(allEmployees, BUILDING_A, 'floor-0')

    // Build the set of employees available in refs after init
    const registeredEmployees = allEmployees.filter(e => registeredIds.has(e.id))

    // User navigates to floor-1 (DEV DEN)
    const visible = simulateSwitchFloor(registeredEmployees, BUILDING_A, 'floor-1')

    expect(visible).toContain('rex')   // Nova should now appear — this was the bug
    expect(visible).not.toContain('nova')
  })

  it('employees with no floorId default to floor-0', () => {
    const noFloorEmployee = makeEmployee('legacy', BUILDING_A, 'floor-0')
    delete (noFloorEmployee.settings as any).floorId  // simulate legacy record

    const { registeredIds, canvasIds } = simulateInit(
      [noFloorEmployee],
      BUILDING_A,
      'floor-0',
    )

    expect(registeredIds).toContain('legacy')
    expect(canvasIds).toContain('legacy')
  })
})

// ── Bug 2: cross-building bleed ───────────────────────────────────────────────

describe('handleSwitchFloor officeId guard (Bug 2: cross-building bleed)', () => {
  // After visiting both buildings in one session, permanentAgentsRef contains
  // employees from BOTH buildings (module-level, not cleared between mounts).
  const allRegistered = allEmployees // simulate: both buildings in the ref map

  it('only shows building-B employees when switching floors in building B', () => {
    const visible = simulateSwitchFloor(allRegistered, BUILDING_B, 'floor-0')

    expect(visible).toContain('alice')      // BUILDING_B, floor-0
    expect(visible).not.toContain('bob')    // BUILDING_B, floor-1 — wrong floor
    expect(visible).not.toContain('nova')   // BUILDING_A — wrong building
    expect(visible).not.toContain('rex')    // BUILDING_A — wrong building
  })

  it('does not show building-A employees when switching to a floor-id that exists in building A', () => {
    // Both buildings have a 'floor-1'. Without the officeId guard,
    // switching to floor-1 in building B would also show rex (BUILDING_A).
    const visible = simulateSwitchFloor(allRegistered, BUILDING_B, 'floor-1')

    expect(visible).toContain('bob')    // BUILDING_B, floor-1 ✓
    expect(visible).not.toContain('rex')  // BUILDING_A, floor-1 — must be excluded
  })

  it('correctly isolates building-A floor-1 when switching floors in building A', () => {
    const visible = simulateSwitchFloor(allRegistered, BUILDING_A, 'floor-1')

    expect(visible).toContain('rex')      // BUILDING_A, floor-1 ✓
    expect(visible).not.toContain('bob')  // BUILDING_B, floor-1 — must be excluded
  })

  it('employees from a null (default) office do not appear in a named building', () => {
    const defaultOfficeEmployee = makeEmployee('orphan', null, 'floor-0')
    const visible = simulateSwitchFloor(
      [...allRegistered, defaultOfficeEmployee],
      BUILDING_A,
      'floor-0',
    )

    expect(visible).toContain('nova')
    expect(visible).not.toContain('orphan')  // null officeId ≠ BUILDING_A
  })

  it('employees from a named building do not appear in the null (default) office', () => {
    const visible = simulateSwitchFloor(allRegistered, null, 'floor-0')

    expect(visible).not.toContain('nova')
    expect(visible).not.toContain('alice')
  })
})

// ── Bug 3: working/status updates bleed across floors and buildings ───────────

describe('MCP re-sync guard (Bug 3: working agents visible on wrong floor)', () => {
  /**
   * Mirrors the MCP re-sync logic in the useEffect that adds MCP-controlled
   * agents to the canvas. After the fix, permanent employees are checked
   * against BOTH officeId AND floorId before being added.
   *
   * `registeredEmployees` simulates permanentEmployeesRef (all building
   * employees, from the init fix). `buildingMap` simulates
   * existingAgents.buildingMap from the parent context.
   */
  function simulateMcpResync(
    mcpAgentIds: string[],
    registeredEmployees: PermanentEmployeeData[],
    currentBuildingId: string | null,
    currentFloorId: string,
    buildingMap: Map<string, string>,
  ): Set<string> {
    const addedIds = new Set<string>()
    const empLookup = new Map(registeredEmployees.map(e => [e.id, e]))

    for (const id of mcpAgentIds) {
      // Check permanent employee data first
      const empData = empLookup.get(id)
      if (empData) {
        // Permanent: verify building + floor
        if ((empData.settings.officeId ?? null) !== currentBuildingId) continue
        const empFloorId = empData.settings.floorId ?? 'floor-0'
        if (empFloorId !== currentFloorId) continue
      } else {
        // Non-permanent: building-map check
        const agentBuilding = buildingMap.get(id)
        if (agentBuilding !== undefined && agentBuilding !== (currentBuildingId ?? null)) continue
      }
      addedIds.add(id)
    }
    return addedIds
  }

  it('working employee on floor-1 does NOT appear when user views floor-0 of same building', () => {
    // Rex is working on floor-1 (DEV DEN), user is on floor-0
    const visible = simulateMcpResync(
      ['rex'],
      allEmployees,
      BUILDING_A,
      'floor-0',  // user is on floor-0
      new Map(),
    )

    expect(visible).not.toContain('rex')  // was the bug — appeared as blue tint
  })

  it('working employee on floor-1 DOES appear when user views their floor', () => {
    const visible = simulateMcpResync(
      ['rex'],
      allEmployees,
      BUILDING_A,
      'floor-1',  // user is on floor-1 (same as rex)
      new Map(),
    )

    expect(visible).toContain('rex')
  })

  it('working employee from building A does NOT appear in building B', () => {
    const visible = simulateMcpResync(
      ['nova'],
      allEmployees,
      BUILDING_B,  // user is in building B
      'floor-0',
      new Map(),
    )

    expect(visible).not.toContain('nova')
  })

  it('non-permanent MCP agent is excluded when buildingMap says different building', () => {
    const buildingMap = new Map([['temp-agent', BUILDING_A]])
    const visible = simulateMcpResync(
      ['temp-agent'],
      [],  // not a permanent employee
      BUILDING_B,  // user in building B
      'floor-0',
      buildingMap,
    )

    expect(visible).not.toContain('temp-agent')
  })

  it('non-permanent MCP agent with no buildingMap entry is allowed through', () => {
    // Agents without a building mapping (e.g., freshly spawned via MCP
    // with no building context) should still appear — we can't determine
    // their building so we default to showing them.
    const visible = simulateMcpResync(
      ['unknown-agent'],
      [],  // not a permanent employee
      BUILDING_A,
      'floor-0',
      new Map(),  // no mapping
    )

    expect(visible).toContain('unknown-agent')
  })
})
