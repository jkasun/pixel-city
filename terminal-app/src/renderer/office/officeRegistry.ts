/**
 * OfficeRegistry — L1 Domain
 *
 * Single source of truth for all agent ↔ building relationships.
 * Pure TypeScript — zero React imports, zero DOM access.
 * All state is scoped to buildingId, making cross-office leakage structurally impossible.
 */
import { OfficeState } from '@pixel-city/shared/office/engine/officeState'
import type { Character } from '@pixel-city/shared/office/types'
import type { PermanentEmployeeData } from './officeAppTypes.js'

// ── Types ──────────────────────────────────────────────────────────────────

export interface AgentRegistration {
  agentId: string
  buildingId: string
  permanentId?: string
  floorId: string
  palette: number
  name: string
  model: string
  isPermanent: boolean
}

export interface BuildingSnapshot {
  buildingId: string
  officeState: OfficeState
  /** agentId → registration */
  agents: Map<string, AgentRegistration>
  /** permanentId → PermanentEmployeeData. For permanents, permanentId === agentId. */
  permanentEmployees: Map<string, PermanentEmployeeData>
  /** agentId → seatId | null */
  seatMap: Map<string, string | null>
  /** agentId → { floorId, character snapshot } */
  floorStash: Map<string, { floorId: string; character: Character }>
}

export type OfficeRegistryEventType =
  | 'building_activated'
  | 'building_deactivated'
  | 'agent_registered'
  | 'agent_removed'
  | 'agent_status_changed'

export interface OfficeRegistryEvent {
  type: OfficeRegistryEventType
  buildingId: string
  agentId?: string
  payload?: unknown
}

export type OfficeRegistryListener = (event: OfficeRegistryEvent) => void

// ── IOfficeRegistry ────────────────────────────────────────────────────────

export interface IOfficeRegistry {
  // Building lifecycle
  activateBuilding(buildingId: string, officeState: OfficeState): BuildingSnapshot
  getActiveBuilding(): string | null
  getBuilding(buildingId: string): BuildingSnapshot | null

  // Agent registration
  registerAgent(reg: AgentRegistration): void
  removeAgent(agentId: string): void
  getBuildingForAgent(agentId: string): string | null
  getAgentsForBuilding(buildingId: string): AgentRegistration[]

  // Permanent employees — agentId is always the employee's stable id
  registerPermanentEmployee(emp: PermanentEmployeeData): void
  getAgentIdForPermanent(permanentId: string, buildingId: string): string | null
  getPermanentIdForAgent(agentId: string): string | null

  // MCP command validation
  isAgentInActiveBuilding(agentId: string): boolean

  // Floor stash
  stashCharacter(agentId: string, buildingId: string, character: Character): void
  popStashedCharacters(buildingId: string, floorId: string): Character[]

  // Subscriptions (for L2 hook binding)
  subscribe(listener: OfficeRegistryListener): () => void
}

// ── Implementation ─────────────────────────────────────────────────────────

export class OfficeRegistry implements IOfficeRegistry {
  private buildings = new Map<string, BuildingSnapshot>()
  private activeBuildingId: string | null = null
  /** Global reverse index: agentId → buildingId (for fast lookups) */
  private agentBuildingIndex = new Map<string, string>()
  private listeners = new Set<OfficeRegistryListener>()

  // ── Building lifecycle ───────────────────────────────────────────────────

  activateBuilding(buildingId: string, officeState: OfficeState): BuildingSnapshot {
    const previous = this.activeBuildingId

    // Deactivate previous
    if (previous && previous !== buildingId) {
      this.emit({ type: 'building_deactivated', buildingId: previous })
    }

    // Create snapshot if first visit
    if (!this.buildings.has(buildingId)) {
      this.buildings.set(buildingId, {
        buildingId,
        officeState,
        agents: new Map(),
        permanentEmployees: new Map(),
        seatMap: new Map(),
        floorStash: new Map(),
      })
    } else {
      // Update officeState reference on re-activation (new OfficeState created on re-entry)
      this.buildings.get(buildingId)!.officeState = officeState
    }

    this.activeBuildingId = buildingId
    this.emit({ type: 'building_activated', buildingId })
    return this.buildings.get(buildingId)!
  }

  getActiveBuilding(): string | null {
    return this.activeBuildingId
  }

  getBuilding(buildingId: string): BuildingSnapshot | null {
    return this.buildings.get(buildingId) ?? null
  }

  // ── Agent registration ───────────────────────────────────────────────────

  registerAgent(reg: AgentRegistration): void {
    const snapshot = this.buildings.get(reg.buildingId)
    if (!snapshot) {
      console.warn(`[OfficeRegistry] registerAgent: building ${reg.buildingId} not activated`)
      return
    }
    snapshot.agents.set(reg.agentId, reg)
    this.agentBuildingIndex.set(reg.agentId, reg.buildingId)
    this.emit({ type: 'agent_registered', buildingId: reg.buildingId, agentId: reg.agentId })
  }

  removeAgent(agentId: string): void {
    const buildingId = this.agentBuildingIndex.get(agentId)
    if (!buildingId) return
    const snapshot = this.buildings.get(buildingId)
    if (snapshot) {
      snapshot.agents.delete(agentId)
      snapshot.seatMap.delete(agentId)
      snapshot.floorStash.delete(agentId)
    }
    this.agentBuildingIndex.delete(agentId)
    this.emit({ type: 'agent_removed', buildingId: buildingId ?? '', agentId })
  }

  getBuildingForAgent(agentId: string): string | null {
    return this.agentBuildingIndex.get(agentId) ?? null
  }

  getAgentsForBuilding(buildingId: string): AgentRegistration[] {
    return Array.from(this.buildings.get(buildingId)?.agents.values() ?? [])
  }

  // ── Permanent employees ──────────────────────────────────────────────────
  // For permanents, agentId === permanentId (employee's stable id, e.g.
  // `peach-crouton`). The lookups below are identity ops gated on existence
  // in the building's permanentEmployees map.

  registerPermanentEmployee(emp: PermanentEmployeeData): void {
    const buildingId = emp.settings.officeId ?? null
    if (buildingId === null) return
    const snapshot = this.buildings.get(buildingId)
    if (!snapshot) {
      console.warn(`[OfficeRegistry] registerPermanentEmployee: building ${buildingId} not activated`)
      return
    }
    snapshot.permanentEmployees.set(emp.id, emp)
    if (emp.settings.seatId !== undefined) {
      snapshot.seatMap.set(emp.id, emp.settings.seatId ?? null)
    }
    // Register in agent index so getBuildingForAgent works even before the
    // permanent's terminal session is initialized.
    this.agentBuildingIndex.set(emp.id, buildingId)
  }

  getAgentIdForPermanent(permanentId: string, buildingId: string): string | null {
    return this.buildings.get(buildingId)?.permanentEmployees.has(permanentId)
      ? permanentId
      : null
  }

  getPermanentIdForAgent(agentId: string): string | null {
    const buildingId = this.agentBuildingIndex.get(agentId)
    if (!buildingId) return null
    return this.buildings.get(buildingId)?.permanentEmployees.has(agentId) ? agentId : null
  }

  // ── MCP command validation ───────────────────────────────────────────────

  isAgentInActiveBuilding(agentId: string): boolean {
    if (!this.activeBuildingId) return false
    const agentBuilding = this.agentBuildingIndex.get(agentId)
    return agentBuilding === this.activeBuildingId
  }

  // ── Floor stash ──────────────────────────────────────────────────────────

  stashCharacter(agentId: string, buildingId: string, character: Character): void {
    const snapshot = this.buildings.get(buildingId)
    if (!snapshot) return
    snapshot.floorStash.set(agentId, {
      floorId: character.floorId ?? 'floor-0',
      character: { ...character },
    })
  }

  popStashedCharacters(buildingId: string, floorId: string): Character[] {
    const snapshot = this.buildings.get(buildingId)
    if (!snapshot) return []
    const result: Character[] = []
    for (const [agentId, entry] of snapshot.floorStash) {
      if (entry.floorId === floorId) {
        result.push(entry.character)
        snapshot.floorStash.delete(agentId)
      }
    }
    return result
  }

  // ── Subscriptions ────────────────────────────────────────────────────────

  subscribe(listener: OfficeRegistryListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: OfficeRegistryEvent): void {
    for (const listener of this.listeners) {
      try { listener(event) } catch { /* listener errors must not crash registry */ }
    }
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────

/** Module-level singleton — the single source of truth for all office state. */
export const officeRegistry = new OfficeRegistry()
