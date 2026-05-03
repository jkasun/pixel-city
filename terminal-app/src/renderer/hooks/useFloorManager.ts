/**
 * useFloorManager — L2 Hook
 *
 * Owns all floor state: list, active floor, switching (stash/restore), RTDB persistence.
 * Zero JSX. Zero knowledge of editor state, agent spawning, or office status.
 *
 * Consumed by OfficeApp (L3) to delegate floor management.
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import type { OfficeLayout } from '@pixel-city/shared/office/types'
import { normalizeLayout } from '@pixel-city/plugin-office/components'
import { loadLayoutFromRtdb, saveFloorsToRtdb } from '../office/layoutDbLocal.js'
import { officeRegistry, lastActiveFloorMap, getOfficeState } from '../office/officeStateRefs.js'
import type { FloorEntry } from '../office/officeAppTypes.js'

export interface UseFloorManagerOptions {
  buildingId: string | null
  /** Trigger a canvas re-render after floor state changes */
  onFloorChanged: () => void
}

export interface UseFloorManagerResult {
  floors: FloorEntry[]
  setFloors: React.Dispatch<React.SetStateAction<FloorEntry[]>>
  activeFloorId: string
  setActiveFloorId: React.Dispatch<React.SetStateAction<string>>
  activeFloorIdRef: React.RefObject<string>
  activeLayoutId: string
  setActiveLayoutId: React.Dispatch<React.SetStateAction<string>>
  /** Switch to a floor: stashes current characters, loads layout, restores target floor characters. */
  switchFloor: (floorId: string, setActiveFloorIdInView: (id: string) => void) => Promise<void>
  /** Persist renamed or reordered floors to RTDB. */
  saveFloors: (_buildingId: string, updatedFloors: FloorEntry[]) => Promise<void>
  /** Stash all current characters so a new floor starts empty. Call before activating any new floor. */
  stashAllCharacters: () => void
}

export function useFloorManager({ buildingId, onFloorChanged }: UseFloorManagerOptions): UseFloorManagerResult {
  const [floors, setFloors] = useState<FloorEntry[]>([])
  const [activeFloorId, setActiveFloorId] = useState(() =>
    (buildingId ? lastActiveFloorMap.get(buildingId) : undefined) ?? 'floor-0'
  )
  const [activeLayoutId, setActiveLayoutId] = useState<string>('main-office')
  const activeFloorIdRef = useRef(activeFloorId)

  useEffect(() => {
    activeFloorIdRef.current = activeFloorId
    if (buildingId) lastActiveFloorMap.set(buildingId, activeFloorId)
  }, [activeFloorId, buildingId])

  /** Stash all characters currently in the office state, clearing the canvas. */
  const stashAllCharacters = useCallback(() => {
    const os = getOfficeState()
    for (const [id, ch] of os.characters.entries()) {
      if (buildingId) officeRegistry.stashCharacter(id, buildingId, { ...ch })
      if (ch.seatId) {
        const seat = os.seats.get(ch.seatId)
        if (seat) seat.assigned = false
      }
      os.characters.delete(id)
    }
  }, [buildingId])

  const switchFloor = useCallback(async (floorId: string, setActiveFloorIdInView: (id: string) => void) => {
    // Load persisted layout for the target floor
    let layout: OfficeLayout | null = null
    try {
      const result = await loadLayoutFromRtdb(`${buildingId}--${floorId}`)
      if (result.found && result.data) layout = normalizeLayout(result.data as OfficeLayout)
    } catch { /* RTDB not available */ }
    if (layout) {
      getOfficeState().rebuildFromLayout(layout)
    }

    const os = getOfficeState()

    // Stash characters not belonging to the target floor
    for (const [id, ch] of os.characters.entries()) {
      const charFloor = ch.floorId ?? 'floor-0'
      if (charFloor !== floorId && buildingId) {
        officeRegistry.stashCharacter(id, buildingId, { ...ch })
        if (ch.seatId) {
          const seat = os.seats.get(ch.seatId)
          if (seat) seat.assigned = false
        }
        os.characters.delete(id)
      }
    }

    // Restore stashed characters that belong to the target floor
    if (buildingId) {
      for (const stashed of officeRegistry.popStashedCharacters(buildingId, floorId)) {
        os.addAgent(stashed.id, stashed.palette, stashed.hueShift, stashed.seatId ?? undefined, true, undefined, stashed.model)
        const ch = os.characters.get(stashed.id)
        if (ch) {
          ch.name = stashed.name
          ch.role = stashed.role
          ch.model = stashed.model
          ch.floorId = stashed.floorId
          ch.isPermanent = stashed.isPermanent
          ch.permanentId = stashed.permanentId
          ch.isActive = stashed.isActive
          ch.workerStatus = stashed.workerStatus
          ch.statusText = stashed.statusText
          ch.currentTool = stashed.currentTool
        }
      }
    }

    // Add permanent employees registered to the target floor that aren't on canvas yet
    if (buildingId) {
      const snap = officeRegistry.getBuilding(buildingId)
      if (snap) {
        for (const [empId, emp] of snap.permanentEmployees.entries()) {
          // Permanents use empId as their runtime agentId.
          const agentId = empId
          if (os.characters.has(agentId)) continue
          if (snap.floorStash.has(agentId)) continue
          const empFloorId = emp.settings.floorId ?? 'floor-0'
          if (empFloorId !== floorId) continue
          const { palette = 0, hueShift = 0, seatId, name, model = 'sonnet' } = emp.settings
          os.addAgent(agentId, palette, hueShift, seatId ?? undefined, true, undefined, model)
          const ch = os.characters.get(agentId)
          if (ch) {
            ch.isPermanent = true
            ch.permanentId = empId
            ch.name = name
            ch.role = emp.settings.role
            ch.model = model
            ch.floorId = empFloorId
          }
        }
      }
    }

    setActiveFloorId(floorId)
    setActiveFloorIdInView(floorId)
    setActiveLayoutId(`${buildingId}--${floorId}`)
    onFloorChanged()
  }, [buildingId, onFloorChanged])

  const saveFloors = useCallback(async (_buildingId: string, updatedFloors: FloorEntry[]) => {
    setFloors(updatedFloors)
    try {
      if (buildingId) await saveFloorsToRtdb(buildingId, updatedFloors)
    } catch (err) {
      console.warn('Failed to save floor index:', err)
    }
  }, [buildingId])

  return {
    floors, setFloors,
    activeFloorId, setActiveFloorId, activeFloorIdRef,
    activeLayoutId, setActiveLayoutId,
    switchFloor, saveFloors, stashAllCharacters,
  }
}
