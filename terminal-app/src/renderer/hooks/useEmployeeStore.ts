import { useState, useEffect, useCallback } from 'react'
import { employeeStore } from '../employee/EmployeeStore.js'
import type { PermanentEmployeeSettings } from '../office/officeAppTypes.js'

export function useEmployeeStore() {
  const [employees, setEmployees] = useState(() => employeeStore.getAll())

  useEffect(() => {
    return employeeStore.subscribe(() => {
      setEmployees(employeeStore.getAll())
    })
  }, [])

  const updateEmployee = useCallback((id: string, patch: Partial<PermanentEmployeeSettings>) => {
    employeeStore.update(id, patch)
  }, [])

  const getEmployee = useCallback((id: string) => {
    return employeeStore.get(id)
  }, [])

  return { employees, updateEmployee, getEmployee }
}
