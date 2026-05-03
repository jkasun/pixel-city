import { IpcMain } from 'electron'
import { getDb } from './appDb'

export function register(ipcMain: IpcMain) {
  ipcMain.handle('board-load', (_event, { projectDir, buildingId } = {} as any) => {
    try {
      const db = getDb(projectDir)
      const bid = buildingId || 'default'
      const row = db.prepare('SELECT columns_json, next_id FROM boards WHERE building_id = ?').get(bid) as any
      if (!row) return { success: true, board: null }
      const board = {
        columns: JSON.parse(row.columns_json || '{}'),
        nextId: row.next_id ?? 1,
      }
      return { success: true, board }
    } catch (err: any) {
      return { success: false, error: err.message, board: null }
    }
  })

  ipcMain.handle('board-list', (_event, { projectDir } = {} as any) => {
    try {
      const db = getDb(projectDir)
      const rows = db.prepare('SELECT building_id FROM boards').all() as any[]
      return { success: true, boards: rows.map((r) => r.building_id) }
    } catch (err: any) {
      return { success: false, error: err.message, boards: [] }
    }
  })

  ipcMain.handle('board-save', (_event, { board, projectDir, buildingId }: any) => {
    try {
      const db = getDb(projectDir)
      const bid = buildingId || 'default'
      const now = new Date().toISOString()
      db.prepare(`
        INSERT INTO boards (building_id, columns_json, next_id, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(building_id) DO UPDATE SET
          columns_json = excluded.columns_json,
          next_id = excluded.next_id,
          updated_at = excluded.updated_at
      `).run(bid, JSON.stringify(board.columns ?? {}), board.nextId ?? 1, now)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}
