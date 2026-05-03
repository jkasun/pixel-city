/**
 * Local (SQLite/IPC) office layout operations.
 */

const { ipcRenderer } = window.require('electron')

import type { OfficeLayout } from '@pixel-city/shared/office/types'
import { DEFAULT_OFFICE_LAYOUT } from '@pixel-city/shared/office/layout/defaultOfficeLayout'
import type { FloorEntry } from './officeAppTypes'

let _projectDir: string | null = null
export function setLayoutProjectDir(dir: string | null) { _projectDir = dir }

export async function loadLayoutFromRtdb(
  id: string,
): Promise<{ found: boolean; data?: OfficeLayout; error?: string }> {
  return ipcRenderer.invoke('layout-load', { id, projectDir: _projectDir })
}

export async function loadDefaultOfficeLayout(): Promise<{ found: boolean; data?: OfficeLayout; error?: string }> {
  return { found: true, data: DEFAULT_OFFICE_LAYOUT }
}

export async function saveLayoutToRtdb(
  id: string,
  data: OfficeLayout,
): Promise<{ success: boolean; error?: string }> {
  return ipcRenderer.invoke('layout-save', { id, data, projectDir: _projectDir })
}

export async function listLayoutsFromRtdb(): Promise<string[]> {
  try {
    return await ipcRenderer.invoke('layout-list', { projectDir: _projectDir })
  } catch {
    return []
  }
}

export async function loadFloorsFromRtdb(
  buildingId: string,
): Promise<{ found: boolean; floors?: FloorEntry[]; error?: string }> {
  return ipcRenderer.invoke('floors-load', { buildingId, projectDir: _projectDir })
}

export async function saveFloorsToRtdb(
  buildingId: string,
  floors: FloorEntry[],
): Promise<{ success: boolean; error?: string }> {
  return ipcRenderer.invoke('floors-save', { buildingId, floors, projectDir: _projectDir })
}

/** Local subscription: load once and call callback. Listens for DOM events on subsequent writes. */
export function subscribeToLayoutUpdates(
  id: string,
  callback: (layout: OfficeLayout | null) => void,
): () => void {
  ipcRenderer.invoke('layout-load', { id, projectDir: _projectDir }).then((result: any) => {
    callback(result.found ? result.data : null)
  }).catch(() => callback(null))

  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail
    if (detail?.id === id) {
      callback(detail.layout)
    }
  }
  window.addEventListener('pixelcity:layout-updated', handler)
  return () => window.removeEventListener('pixelcity:layout-updated', handler)
}

/** Call after saving a layout to notify subscribers. */
export function notifyLayoutUpdated(id: string, layout: OfficeLayout | null): void {
  window.dispatchEvent(new CustomEvent('pixelcity:layout-updated', { detail: { id, layout } }))
}
