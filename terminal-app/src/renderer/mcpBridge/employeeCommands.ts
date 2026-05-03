/**
 * Employee and office info command handlers for the MCP Bridge.
 */
import type { BridgeState } from './types.js'
import { createEmployeeInRtdb, listEmployeesFromRtdb } from '../employee/employeeDbLocal'
import type { PermanentEmployeeSettings } from '../office/officeAppTypes'

/** Sync employee/office commands. */
export function executeEmployeeAction(
  action: string,
  params: Record<string, unknown>,
  state: BridgeState,
): unknown {
  switch (action) {
    case 'get_office_info': {
      const { activeOfficeState } = state
      if (!activeOfficeState) return { available: false }
      const layout = activeOfficeState.getLayout()
      return {
        available: true,
        cols: layout.cols,
        rows: layout.rows,
        agentCount: activeOfficeState.getCharacters().length,
        seatCount: activeOfficeState.seats.size,
        freeSeatCount: Array.from(activeOfficeState.seats.values()).filter(s => !s.assigned).length,
      }
    }

    case 'ping':
      return { pong: true, timestamp: Date.now() }

    // These sync actions throw to force async path
    case 'create_employee':
    case 'list_employees':
      throw new Error('Use async version')

    default:
      return undefined
  }
}

/** Async employee commands. */
export async function executeEmployeeActionAsync(
  action: string,
  params: Record<string, unknown>,
  _ipc: Electron.IpcRenderer,
): Promise<unknown> {
  switch (action) {
    case 'create_employee': {
      const empId = params.id as string
      const settings = params.settings as PermanentEmployeeSettings
      const soul = (params.soul as string) ?? ''
      if (!empId || !settings) throw new Error('Missing id or settings')
      await createEmployeeInRtdb(empId, settings, soul)
      return { success: true, id: empId }
    }
    case 'list_employees': {
      const res = await listEmployeesFromRtdb()
      const filterBuildingId = (params.buildingId as string | undefined) ?? null
      if (res.success && filterBuildingId) {
        return {
          ...res,
          employees: res.employees.filter((emp: { settings: { officeId?: string | null } }) => (emp.settings.officeId ?? null) === filterBuildingId),
        }
      }
      return res
    }
    default:
      return undefined
  }
}

/** Sync action names handled by this module. */
export const EMPLOYEE_SYNC_ACTIONS = new Set([
  'get_office_info', 'ping',
  'create_employee', 'list_employees', // these throw to async
])

/** Async action names handled by this module. */
export const EMPLOYEE_ASYNC_ACTIONS = new Set([
  'create_employee', 'list_employees',
])
