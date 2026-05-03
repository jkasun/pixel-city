import { useState, useEffect, useCallback } from 'react'
import { subscribeToEmployeeUpdates } from '../employee/employeeDbLocal.js'
import { employeeStore } from '../employee/EmployeeStore.js'

export interface EmployeeEntry {
  id: string
  settings: {
    name: string
    palette?: number
    hueShift?: number
    model?: string
    officeId?: string | null
    floorId?: string
    handle?: string
  }
}

export function useEmployeeSync(projectCwd: string | null) {
  const [permanentEmployees, setPermanentEmployees] = useState<EmployeeEntry[]>([])

  useEffect(() => {
    if (!projectCwd) return
    const unsubscribe = subscribeToEmployeeUpdates((employees) => {
      employeeStore.hydrate(employees.map(e => ({
        id: e.id,
        settings: e.settings ?? {},
        soul: e.soul ?? '',
      })))
    })
    return unsubscribe
  }, [projectCwd])

  // Derive local state from the store
  useEffect(() => {
    const sync = () => {
      const all = employeeStore.getAll()
      setPermanentEmployees(all.map(emp => ({ id: emp.id, settings: emp.settings })))
    }
    sync()
    return employeeStore.subscribe(sync)
  }, [])

  const updateEmployeeModel = useCallback((employeeId: string, model: string) => {
    employeeStore.update(employeeId, { model })
  }, [])

  return { permanentEmployees, updateEmployeeModel }
}
