import type { PermanentEmployeeData, PermanentEmployeeSettings } from '../office/officeAppTypes.js'
import { saveEmployeeSettingsToRtdb, deleteEmployeeFromRtdb, createEmployeeInRtdb } from './employeeDbLocal.js'

export type EmployeeChangeEvent = {
  type: 'update' | 'add' | 'remove' | 'hydrate'
  employeeId: string | null
}

type Listener = (event: EmployeeChangeEvent) => void

class EmployeeStore {
  private employees = new Map<string, PermanentEmployeeData>()
  private listeners = new Set<Listener>()
  private pendingWrites = new Set<string>()

  get(id: string): PermanentEmployeeData | undefined {
    return this.employees.get(id)
  }

  getAll(): PermanentEmployeeData[] {
    return Array.from(this.employees.values())
  }

  getForOffice(officeId: string | null): PermanentEmployeeData[] {
    return this.getAll().filter(e => (e.settings.officeId ?? null) === officeId)
  }

  getSettings(id: string): PermanentEmployeeSettings | undefined {
    return this.employees.get(id)?.settings
  }

  hydrate(employees: PermanentEmployeeData[]): void {
    // Preserve local patches for employees with in-flight RTDB writes —
    // the get() inside saveEmployeeSettingsToRtdb triggers onValue with
    // stale server data before set() writes the new value.
    const preserved = new Map<string, PermanentEmployeeData>()
    for (const id of this.pendingWrites) {
      const local = this.employees.get(id)
      if (local) preserved.set(id, local)
    }
    this.employees.clear()
    for (const emp of employees) {
      this.employees.set(emp.id, preserved.get(emp.id) ?? emp)
    }
    this.emit({ type: 'hydrate', employeeId: null })
  }

  update(id: string, patch: Partial<PermanentEmployeeSettings>): void {
    const existing = this.employees.get(id)
    if (!existing) return

    const updated: PermanentEmployeeData = {
      ...existing,
      settings: { ...existing.settings, ...patch },
    }
    this.employees.set(id, updated)
    this.emit({ type: 'update', employeeId: id })

    this.pendingWrites.add(id)
    saveEmployeeSettingsToRtdb(id, updated.settings)
      .then(() => { this.pendingWrites.delete(id) })
      .catch(err => {
        this.pendingWrites.delete(id)
        console.error(`EmployeeStore: failed to persist settings for ${id}:`, err)
      })
  }

  create(id: string, settings: PermanentEmployeeSettings, soul: string): void {
    const data: PermanentEmployeeData = { id, settings, soul }
    this.employees.set(id, data)
    this.emit({ type: 'add', employeeId: id })

    createEmployeeInRtdb(id, settings, soul).catch(err => {
      console.error(`EmployeeStore: failed to persist new employee ${id}:`, err)
    })
  }

  remove(id: string): void {
    if (!this.employees.has(id)) return
    this.employees.delete(id)
    this.emit({ type: 'remove', employeeId: id })

    deleteEmployeeFromRtdb(id).catch(err => {
      console.error(`EmployeeStore: failed to delete employee ${id}:`, err)
    })
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private emit(event: EmployeeChangeEvent): void {
    for (const listener of this.listeners) {
      try { listener(event) } catch (err) { console.error('EmployeeStore listener error:', err) }
    }
  }
}

export const employeeStore = new EmployeeStore()
