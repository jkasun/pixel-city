/**
 * Local (SQLite/IPC) city layout operations — single-city OSS version.
 */

const { ipcRenderer } = window.require('electron')

import type { CityLayout, CityBuildingCatalog } from '@pixel-city/shared/city/editor/cityLayoutTypes'

let _projectDir: string | null = null
export function setCityProjectDir(dir: string | null) { _projectDir = dir }

// ── City Layout CRUD ──────────────────────────────────────────────

export async function loadCityLayout(cityId?: string): Promise<{ found: boolean; data?: CityLayout; error?: string }> {
  if (!cityId) return { found: false }
  return ipcRenderer.invoke('city-load-layout', { cityId, projectDir: _projectDir })
}

export async function loadDefaultCityLayout(): Promise<{ found: boolean; data?: CityLayout; error?: string }> {
  return { found: false }
}

export async function saveCityLayout(
  layout: CityLayout,
  cityId?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!cityId) return { success: false, error: 'cityId is required' }
  const result = await ipcRenderer.invoke('city-save-layout', { cityId, layout, projectDir: _projectDir })
  if (result.success) notifyCityLayoutUpdated(cityId, layout)
  return result
}

// ── Building Catalog ──────────────────────────────────────────────

export async function loadCityCatalog(): Promise<{ found: boolean; data?: CityBuildingCatalog; error?: string }> {
  // Prefer a saved catalog from SQLite (user-customized), fall back to bundled catalog.json
  try {
    const result = await ipcRenderer.invoke('city-catalog-load', { projectDir: _projectDir })
    if (result.found) return result
  } catch { /* fall through */ }
  return loadBundledCatalog()
}

async function loadBundledCatalog(): Promise<{ found: boolean; data?: CityBuildingCatalog; error?: string }> {
  try {
    const res = await fetch('./buildings/catalog.json')
    if (!res.ok) return { found: false }
    const data: CityBuildingCatalog = await res.json()
    return { found: true, data }
  } catch {
    return { found: false }
  }
}

// ── Subscriptions (DOM-event based) ──────────────────────────────

export function subscribeToCityLayoutUpdates(
  callback: (layout: CityLayout | null) => void,
  cityId?: string,
): () => void {
  if (cityId) {
    ipcRenderer.invoke('city-load-layout', { cityId, projectDir: _projectDir }).then((result: any) => {
      callback(result.found ? result.data : null)
    }).catch(() => callback(null))
  } else {
    callback(null)
  }

  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail
    if (!cityId || detail?.cityId === cityId) callback(detail?.layout ?? null)
  }
  window.addEventListener('pixelcity:city-layout-updated', handler)
  return () => window.removeEventListener('pixelcity:city-layout-updated', handler)
}

export function subscribeToCityCatalogUpdates(
  callback: (catalog: CityBuildingCatalog | null) => void,
): () => void {
  loadCityCatalog().then((result) => {
    callback(result.found ? result.data ?? null : null)
  }).catch(() => callback(null))
  return () => {}
}

// ── DOM event helpers ────────────────────────────────────────────

function notifyCityLayoutUpdated(cityId: string, layout: CityLayout | null): void {
  window.dispatchEvent(new CustomEvent('pixelcity:city-layout-updated', { detail: { cityId, layout } }))
}
