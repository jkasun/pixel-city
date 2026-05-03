import path from 'path'
import os from 'os'
import fs from 'fs'
import { IpcMain } from 'electron'
import { getDb } from './appDb'

function getCityDir(projectDir?: string): string {
  if (projectDir) return path.join(projectDir, '.pixelcity', 'city')
  return path.join(os.homedir(), '.pixelcity', 'city')
}

export function register(ipcMain: IpcMain) {
  // ── Office layouts ───────────────────────────────────────────────

  ipcMain.handle('layout-save', (_event, { id, data, projectDir }: any) => {
    try {
      const db = getDb(projectDir)
      const now = new Date().toISOString()
      db.prepare(`
        INSERT INTO office_layouts (id, data_json, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at
      `).run(id, JSON.stringify(data), now)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('layout-load', (_event, { id, projectDir }: any) => {
    try {
      const db = getDb(projectDir)
      const row = db.prepare('SELECT data_json FROM office_layouts WHERE id = ?').get(id) as any
      if (!row) return { found: false }
      return { found: true, data: JSON.parse(row.data_json) }
    } catch (err: any) {
      return { found: false, error: err.message }
    }
  })

  ipcMain.handle('layout-list', (_event, { projectDir } = {} as any) => {
    try {
      const db = getDb(projectDir)
      const rows = db.prepare('SELECT id FROM office_layouts').all() as any[]
      return rows.map((r) => r.id)
    } catch {
      return []
    }
  })

  // ── Floor index ──────────────────────────────────────────────────

  ipcMain.handle('floors-save', (_event, { buildingId, floors, projectDir }: any) => {
    try {
      const db = getDb(projectDir)
      const now = new Date().toISOString()
      db.prepare(`
        INSERT INTO office_floors (building_id, floors_json, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(building_id) DO UPDATE SET floors_json = excluded.floors_json, updated_at = excluded.updated_at
      `).run(buildingId, JSON.stringify(floors), now)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('floors-load', (_event, { buildingId, projectDir }: any) => {
    try {
      const db = getDb(projectDir)
      const row = db.prepare('SELECT floors_json FROM office_floors WHERE building_id = ?').get(buildingId) as any
      if (!row) return { found: false }
      return { found: true, floors: JSON.parse(row.floors_json) }
    } catch (err: any) {
      return { found: false, error: err.message }
    }
  })

  // ── City layout (single city, always id = 'default-city') ───────

  ipcMain.handle('city-save-layout', (_event, { cityId, layout, projectDir }: any) => {
    try {
      const db = getDb(projectDir)
      const now = Date.now()
      db.prepare(`
        INSERT INTO cities (id, name, layout_json, created_at, updated_at) VALUES (?, '', ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET layout_json = excluded.layout_json, updated_at = excluded.updated_at
      `).run(cityId, JSON.stringify(layout), now, now)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('city-load-layout', (_event, { cityId, projectDir }: any) => {
    try {
      const db = getDb(projectDir)
      const row = db.prepare('SELECT layout_json FROM cities WHERE id = ?').get(cityId) as any
      if (!row || !row.layout_json) return { found: false }
      return { found: true, data: JSON.parse(row.layout_json) }
    } catch (err: any) {
      return { found: false, error: err.message }
    }
  })

  // ── City catalog ─────────────────────────────────────────────────

  ipcMain.handle('city-catalog-save', (_event, { catalog, projectDir }: any) => {
    try {
      const db = getDb(projectDir)
      const now = new Date().toISOString()
      db.prepare(`
        INSERT INTO city_catalog (id, data_json, updated_at) VALUES ('default', ?, ?)
        ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at
      `).run(JSON.stringify(catalog), now)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('city-catalog-load', (_event, { projectDir } = {} as any) => {
    try {
      // Only returns a catalog if the user has saved a custom one (e.g. after adding buildings).
      // Default catalog is the bundled catalog.json loaded by the renderer directly.
      const db = getDb(projectDir)
      const row = db.prepare("SELECT data_json FROM city_catalog WHERE id = 'default'").get() as any
      if (row) return { found: true, data: JSON.parse(row.data_json) }
      return { found: false }
    } catch (err: any) {
      return { found: false, error: err.message }
    }
  })

  // ── City asset imports (unchanged) ───────────────────────────────

  ipcMain.handle('city-import-building', async (_event, { srcPath, projectDir, meta }: any) => {
    try {
      const destDir = path.join(getCityDir(projectDir), 'buildings')
      fs.mkdirSync(destDir, { recursive: true })
      const fileName = `custom_${Date.now()}_${path.basename(srcPath)}`
      const destPath = path.join(destDir, fileName)
      fs.copyFileSync(srcPath, destPath)
      if (meta) {
        fs.writeFileSync(`${destPath}.meta.json`, JSON.stringify(meta, null, 2), 'utf8')
      }
      return { success: true, fileName, destPath }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('city-import-vehicle-sprite', async (_event, { srcPath, direction, projectDir }: any) => {
    try {
      const destDir = path.join(getCityDir(projectDir), 'vehicles')
      fs.mkdirSync(destDir, { recursive: true })
      const fileName = `vehicle_${Date.now()}_${direction}_${path.basename(srcPath)}`
      const destPath = path.join(destDir, fileName)
      fs.copyFileSync(srcPath, destPath)
      return { success: true, fileName, destPath }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}
