import { IpcMain } from 'electron'
import { getDb } from './appDb'

export function register(ipcMain: IpcMain) {
  ipcMain.handle('dynamic-plugin-save', (_event, { buildingId, record, projectDir }: any) => {
    try {
      const db = getDb(projectDir)
      const now = new Date().toISOString()
      db.prepare(`
        INSERT INTO dynamic_plugins (id, building_id, data_json, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET building_id = excluded.building_id, data_json = excluded.data_json, updated_at = excluded.updated_at
      `).run(record.id, buildingId, JSON.stringify(record), now)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('dynamic-plugin-get', (_event, { buildingId, pluginId, projectDir }: any) => {
    try {
      const db = getDb(projectDir)
      const row = db.prepare('SELECT data_json FROM dynamic_plugins WHERE id = ? AND building_id = ?').get(pluginId, buildingId) as any
      if (!row) return { found: false, record: null }
      return { found: true, record: JSON.parse(row.data_json) }
    } catch (err: any) {
      return { found: false, record: null, error: err.message }
    }
  })

  ipcMain.handle('dynamic-plugin-get-state', (_event, { buildingId, pluginId, projectDir }: any) => {
    try {
      const db = getDb(projectDir)
      const row = db.prepare('SELECT data_json FROM dynamic_plugins WHERE id = ? AND building_id = ?').get(pluginId, buildingId) as any
      if (!row) return null
      const record = JSON.parse(row.data_json)
      return record.state ?? null
    } catch {
      return null
    }
  })

  ipcMain.handle('dynamic-plugin-update-state', (_event, { buildingId, pluginId, state, projectDir }: any) => {
    try {
      const db = getDb(projectDir)
      const row = db.prepare('SELECT data_json FROM dynamic_plugins WHERE id = ? AND building_id = ?').get(pluginId, buildingId) as any
      if (!row) return { success: false, error: 'Plugin not found' }
      const record = JSON.parse(row.data_json)
      record.state = state
      db.prepare('UPDATE dynamic_plugins SET data_json = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(record), new Date().toISOString(), pluginId)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('dynamic-plugin-remove', (_event, { buildingId, pluginId, projectDir }: any) => {
    try {
      const db = getDb(projectDir)
      db.prepare('DELETE FROM dynamic_plugins WHERE id = ? AND building_id = ?').run(pluginId, buildingId)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('dynamic-plugin-list', (_event, { buildingId, projectDir }: any) => {
    try {
      const db = getDb(projectDir)
      const rows = db.prepare('SELECT data_json FROM dynamic_plugins WHERE building_id = ?').all(buildingId) as any[]
      const records: Record<string, any> = {}
      for (const row of rows) {
        const record = JSON.parse(row.data_json)
        records[record.id] = record
      }
      return { success: true, records }
    } catch (err: any) {
      return { success: false, error: err.message, records: {} }
    }
  })
}
