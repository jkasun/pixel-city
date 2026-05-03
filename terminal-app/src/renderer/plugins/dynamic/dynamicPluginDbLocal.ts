/**
 * Local (SQLite/IPC) dynamic plugin operations.
 */

const { ipcRenderer } = window.require('electron')

import type { DynamicPluginRecord } from './types.js'

let _projectDir: string | null = null
export function setPluginProjectDir(dir: string | null) { _projectDir = dir }

export async function saveDynamicPlugin(buildingId: string, record: DynamicPluginRecord): Promise<void> {
  await ipcRenderer.invoke('dynamic-plugin-save', { buildingId, record, projectDir: _projectDir })
  notifyPluginsUpdated(buildingId)
}

export async function updateDynamicPluginState(
  buildingId: string,
  pluginId: string,
  state: Record<string, unknown>,
): Promise<void> {
  await ipcRenderer.invoke('dynamic-plugin-update-state', { buildingId, pluginId, state, projectDir: _projectDir })
}

export async function getDynamicPluginState(
  buildingId: string,
  pluginId: string,
): Promise<Record<string, unknown> | null> {
  return ipcRenderer.invoke('dynamic-plugin-get-state', { buildingId, pluginId, projectDir: _projectDir })
}

export async function getDynamicPlugin(
  buildingId: string,
  pluginId: string,
): Promise<DynamicPluginRecord | null> {
  const result = await ipcRenderer.invoke('dynamic-plugin-get', { buildingId, pluginId, projectDir: _projectDir })
  return result.found ? result.record : null
}

export async function removeDynamicPlugin(buildingId: string, pluginId: string): Promise<void> {
  await ipcRenderer.invoke('dynamic-plugin-remove', { buildingId, pluginId, projectDir: _projectDir })
  notifyPluginsUpdated(buildingId)
}

export function subscribeDynamicPlugins(
  buildingId: string,
  callback: (records: Record<string, DynamicPluginRecord>) => void,
): () => void {
  ipcRenderer.invoke('dynamic-plugin-list', { buildingId, projectDir: _projectDir }).then((result: any) => {
    callback(result.records ?? {})
  }).catch(() => callback({}))

  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail
    if (detail?.buildingId === buildingId) {
      ipcRenderer.invoke('dynamic-plugin-list', { buildingId, projectDir: _projectDir }).then((result: any) => {
        callback(result.records ?? {})
      }).catch(() => callback({}))
    }
  }
  window.addEventListener('pixelcity:plugins-updated', handler)
  return () => window.removeEventListener('pixelcity:plugins-updated', handler)
}

export function subscribeDynamicPluginState(
  buildingId: string,
  pluginId: string,
  callback: (state: Record<string, unknown>) => void,
): () => void {
  ipcRenderer.invoke('dynamic-plugin-get-state', { buildingId, pluginId, projectDir: _projectDir }).then((state: any) => {
    callback(state ?? {})
  }).catch(() => callback({}))
  return () => {}
}

function notifyPluginsUpdated(buildingId: string): void {
  window.dispatchEvent(new CustomEvent('pixelcity:plugins-updated', { detail: { buildingId } }))
}
