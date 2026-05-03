/**
 * Local (filesystem/IPC) employee operations.
 * All operations go through Electron IPC to the main process, which reads
 * and writes folders under <projectDir>/.pixelcity/agents/<id>/.
 *
 * projectDir is auto-injected from the renderer-level register so callers
 * don't need to thread it through.
 */

const { ipcRenderer } = window.require('electron')

import type { PermanentEmployeeData, PermanentEmployeeSettings } from '../office/officeAppTypes'
import { getEmployeeProjectCwd } from './currentProjectCwd'

function ipcArgs<T extends Record<string, unknown>>(extra: T): T & { projectDir: string | null } {
  return { ...extra, projectDir: getEmployeeProjectCwd() }
}

export async function listEmployeesFromRtdb(): Promise<{ success: boolean; employees: PermanentEmployeeData[]; error?: string }> {
  return ipcRenderer.invoke('permanent-employee-list', ipcArgs({}))
}

export async function getEmployeeFromRtdb(id: string): Promise<{ success: boolean; employee: PermanentEmployeeData | null; error?: string }> {
  const result = await ipcRenderer.invoke('permanent-employee-list', ipcArgs({}))
  if (!result.success) return { success: false, employee: null, error: result.error }
  const employee = result.employees.find((e: any) => e.id === id) ?? null
  return { success: true, employee }
}

export async function createEmployeeInRtdb(
  id: string,
  settings: PermanentEmployeeSettings,
  soul: string,
): Promise<{ success: boolean; error?: string }> {
  return ipcRenderer.invoke('permanent-employee-create', ipcArgs({ id, settings, soul }))
}

export async function saveEmployeeSettingsToRtdb(
  id: string,
  settings: PermanentEmployeeSettings,
): Promise<{ success: boolean; error?: string }> {
  return ipcRenderer.invoke('permanent-employee-save-settings', ipcArgs({ id, settings }))
}

export async function saveEmployeeSoulToRtdb(
  id: string,
  soul: string,
): Promise<{ success: boolean; error?: string }> {
  return ipcRenderer.invoke('permanent-employee-save-soul', ipcArgs({ id, soul }))
}

export async function updateEmployeeModelInRtdb(
  id: string,
  model: string,
): Promise<{ success: boolean; error?: string }> {
  const result = await ipcRenderer.invoke('permanent-employee-list', ipcArgs({}))
  if (!result.success) return { success: false, error: result.error }
  const emp = result.employees.find((e: any) => e.id === id)
  if (!emp) return { success: false, error: 'Employee not found' }
  return ipcRenderer.invoke('permanent-employee-save-settings', ipcArgs({
    id,
    settings: { ...emp.settings, model },
  }))
}

export async function deleteEmployeeFromRtdb(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  return ipcRenderer.invoke('permanent-employee-delete', ipcArgs({ id }))
}

/**
 * Local subscriptions: refetch + invoke callback on initial mount and whenever
 * `pixelcity:employees-updated` fires (dispatched by hire/fire flows + MCP
 * employee mutations). Returns a real unsubscribe.
 */
export function subscribeToEmployeeUpdates(
  callback: (employees: PermanentEmployeeData[]) => void,
): () => void {
  const refresh = () => {
    ipcRenderer.invoke('permanent-employee-list', ipcArgs({})).then((result: any) => {
      if (result.success) callback(result.employees)
    }).catch(console.error)
  }
  refresh()
  window.addEventListener('pixelcity:employees-updated', refresh)
  return () => window.removeEventListener('pixelcity:employees-updated', refresh)
}
