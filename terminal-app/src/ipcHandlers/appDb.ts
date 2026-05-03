import path from 'path'
import os from 'os'
import fs from 'fs'
import Database from 'better-sqlite3'

const dbCache = new Map<string, Database.Database>()

export function getDb(projectDir?: string | null): Database.Database {
  const base = projectDir
    ? path.join(projectDir, '.pixelcity')
    : path.join(os.homedir(), '.pixelcity')
  const dbPath = path.join(base, 'app.db')

  if (dbCache.has(dbPath)) return dbCache.get(dbPath)!

  fs.mkdirSync(base, { recursive: true })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  applySchema(db)
  dbCache.set(dbPath, db)
  return db
}

function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS office_layouts (
      id TEXT PRIMARY KEY,
      data_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS office_floors (
      building_id TEXT PRIMARY KEY,
      floors_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS cities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      layout_json TEXT,
      config_json TEXT,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS boards (
      building_id TEXT PRIMARY KEY,
      columns_json TEXT NOT NULL DEFAULT '{}',
      next_id INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS dynamic_plugins (
      id TEXT PRIMARY KEY,
      building_id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_dynamic_plugins_building ON dynamic_plugins (building_id);

    CREATE TABLE IF NOT EXISTS city_catalog (
      id TEXT PRIMARY KEY,
      data_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      from_agent TEXT NOT NULL DEFAULT '',
      from_name TEXT,
      to_agent TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'info',
      timestamp INTEGER NOT NULL DEFAULT 0,
      read INTEGER NOT NULL DEFAULT 0,
      reply_to TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_messages_to ON messages (to_agent);
    CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages (timestamp);

  `)

  const cols = db.prepare(`PRAGMA table_info(messages)`).all() as Array<{ name: string }>
  if (!cols.some(c => c.name === 'from_name')) {
    db.exec(`ALTER TABLE messages ADD COLUMN from_name TEXT`)
  }
}
