/**
 * storage.ts — SQLite-based drawer store (replaces ChromaDB)
 *
 * Uses better-sqlite3 with FTS5 for full-text search.
 * Stores drawers with metadata (wing, room, importance, etc.)
 */

import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { MempalaceConfig } from './config.js'

export interface DrawerMetadata {
  wing: string
  room: string
  hall?: string
  source_file?: string
  chunk_index?: number
  added_by?: string
  filed_at?: string
  importance?: number
  emotional_weight?: number
  date?: string
  topic?: string
  type?: string
  agent?: string
}

export interface Drawer {
  id: string
  content: string
  metadata: DrawerMetadata
}

export interface SearchResult {
  id: string
  content: string
  metadata: DrawerMetadata
  rank?: number
}

export class DrawerStore {
  private db: Database.Database
  private config: MempalaceConfig

  constructor(config?: MempalaceConfig) {
    this.config = config || new MempalaceConfig()
    const dbPath = path.join(this.config.palacePath, 'drawers.sqlite3')
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.initDb()
  }

  private initDb(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS drawers (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        wing TEXT NOT NULL,
        room TEXT NOT NULL DEFAULT 'general',
        hall TEXT DEFAULT '',
        source_file TEXT DEFAULT '',
        chunk_index INTEGER DEFAULT 0,
        added_by TEXT DEFAULT 'mcp',
        filed_at TEXT DEFAULT (datetime('now')),
        importance REAL DEFAULT 3.0,
        emotional_weight REAL DEFAULT 0.0,
        date TEXT DEFAULT '',
        topic TEXT DEFAULT '',
        type TEXT DEFAULT '',
        agent TEXT DEFAULT ''
      );

      CREATE INDEX IF NOT EXISTS idx_drawers_wing ON drawers(wing);
      CREATE INDEX IF NOT EXISTS idx_drawers_room ON drawers(room);
      CREATE INDEX IF NOT EXISTS idx_drawers_wing_room ON drawers(wing, room);
      CREATE INDEX IF NOT EXISTS idx_drawers_importance ON drawers(importance DESC);
    `)

    // FTS5 virtual table for full-text search
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS drawers_fts USING fts5(
        content,
        content_rowid='rowid',
        tokenize='porter unicode61'
      );
    `)

    // Triggers to keep FTS in sync
    const triggerExists = this.db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='drawers_ai'"
    ).get()

    if (!triggerExists) {
      this.db.exec(`
        CREATE TRIGGER drawers_ai AFTER INSERT ON drawers BEGIN
          INSERT INTO drawers_fts(rowid, content) VALUES (new.rowid, new.content);
        END;

        CREATE TRIGGER drawers_ad AFTER DELETE ON drawers BEGIN
          INSERT INTO drawers_fts(drawers_fts, rowid, content) VALUES('delete', old.rowid, old.content);
        END;

        CREATE TRIGGER drawers_au AFTER UPDATE ON drawers BEGIN
          INSERT INTO drawers_fts(drawers_fts, rowid, content) VALUES('delete', old.rowid, old.content);
          INSERT INTO drawers_fts(rowid, content) VALUES (new.rowid, new.content);
        END;
      `)
    }
  }

  count(wing?: string, room?: string): number {
    let sql = 'SELECT COUNT(*) as cnt FROM drawers'
    const params: any[] = []
    const conditions: string[] = []

    if (wing) {
      conditions.push('wing = ?')
      params.push(wing)
    }
    if (room) {
      conditions.push('room = ?')
      params.push(room)
    }
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ')
    }

    return (this.db.prepare(sql).get(...params) as any).cnt
  }

  add(id: string, content: string, metadata: DrawerMetadata): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO drawers (id, content, wing, room, hall, source_file, chunk_index, added_by, filed_at, importance, emotional_weight, date, topic, type, agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      content,
      metadata.wing,
      metadata.room,
      metadata.hall || '',
      metadata.source_file || '',
      metadata.chunk_index || 0,
      metadata.added_by || 'mcp',
      metadata.filed_at || new Date().toISOString(),
      metadata.importance || 3.0,
      metadata.emotional_weight || 0.0,
      metadata.date || '',
      metadata.topic || '',
      metadata.type || '',
      metadata.agent || '',
    )
  }

  get(id: string): Drawer | null {
    const row = this.db.prepare('SELECT * FROM drawers WHERE id = ?').get(id) as any
    if (!row) return null
    return this.rowToDrawer(row)
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM drawers WHERE id = ?').run(id)
    return result.changes > 0
  }

  getAll(wing?: string, room?: string, limit?: number): Drawer[] {
    let sql = 'SELECT * FROM drawers'
    const params: any[] = []
    const conditions: string[] = []

    if (wing) {
      conditions.push('wing = ?')
      params.push(wing)
    }
    if (room) {
      conditions.push('room = ?')
      params.push(room)
    }
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ')
    }
    sql += ' ORDER BY importance DESC, filed_at DESC'
    if (limit) {
      sql += ' LIMIT ?'
      params.push(limit)
    }

    return (this.db.prepare(sql).all(...params) as any[]).map(r => this.rowToDrawer(r))
  }

  getAllMetadata(): DrawerMetadata[] {
    return (this.db.prepare('SELECT wing, room, hall, date FROM drawers').all() as any[]).map(r => ({
      wing: r.wing,
      room: r.room,
      hall: r.hall,
      date: r.date,
    }))
  }

  search(query: string, wing?: string, room?: string, limit: number = 5): SearchResult[] {
    // Use FTS5 for full-text search with BM25 ranking
    let sql = `
      SELECT d.*, rank
      FROM drawers_fts fts
      JOIN drawers d ON d.rowid = fts.rowid
      WHERE drawers_fts MATCH ?
    `
    const params: any[] = [this.sanitizeFtsQuery(query)]

    if (wing) {
      sql += ' AND d.wing = ?'
      params.push(wing)
    }
    if (room) {
      sql += ' AND d.room = ?'
      params.push(room)
    }

    sql += ' ORDER BY rank LIMIT ?'
    params.push(limit)

    try {
      return (this.db.prepare(sql).all(...params) as any[]).map(r => ({
        ...this.rowToDrawer(r),
        rank: r.rank,
      }))
    } catch {
      // Fallback to LIKE search if FTS query fails
      return this.likeFallback(query, wing, room, limit)
    }
  }

  checkDuplicate(content: string, threshold: number = 0.9): { isDuplicate: boolean; matches: any[] } {
    // Use word overlap as a similarity proxy (no embeddings)
    const words = new Set(content.toLowerCase().split(/\s+/).filter(w => w.length > 2))
    if (words.size === 0) return { isDuplicate: false, matches: [] }

    // Search for similar content using key words
    const searchTerms = [...words].slice(0, 10).join(' ')
    const candidates = this.search(searchTerms, undefined, undefined, 10)

    const matches: any[] = []
    for (const candidate of candidates) {
      const candidateWords = new Set(candidate.content.toLowerCase().split(/\s+/).filter(w => w.length > 2))
      const intersection = [...words].filter(w => candidateWords.has(w))
      const union = new Set([...words, ...candidateWords])
      const jaccard = intersection.length / union.size

      if (jaccard >= threshold) {
        matches.push({
          id: candidate.id,
          wing: candidate.metadata.wing,
          room: candidate.metadata.room,
          similarity: Math.round(jaccard * 1000) / 1000,
          content: candidate.content.length > 200
            ? candidate.content.slice(0, 200) + '...'
            : candidate.content,
        })
      }
    }

    return { isDuplicate: matches.length > 0, matches }
  }

  getWingCounts(): Record<string, number> {
    const rows = this.db.prepare(
      'SELECT wing, COUNT(*) as cnt FROM drawers GROUP BY wing'
    ).all() as any[]
    const result: Record<string, number> = {}
    for (const r of rows) result[r.wing] = r.cnt
    return result
  }

  getRoomCounts(wing?: string): Record<string, number> {
    let sql = 'SELECT room, COUNT(*) as cnt FROM drawers'
    const params: any[] = []
    if (wing) {
      sql += ' WHERE wing = ?'
      params.push(wing)
    }
    sql += ' GROUP BY room'

    const rows = this.db.prepare(sql).all(...params) as any[]
    const result: Record<string, number> = {}
    for (const r of rows) result[r.room] = r.cnt
    return result
  }

  getTaxonomy(): Record<string, Record<string, number>> {
    const rows = this.db.prepare(
      'SELECT wing, room, COUNT(*) as cnt FROM drawers GROUP BY wing, room'
    ).all() as any[]
    const result: Record<string, Record<string, number>> = {}
    for (const r of rows) {
      if (!result[r.wing]) result[r.wing] = {}
      result[r.wing][r.room] = r.cnt
    }
    return result
  }

  close(): void {
    this.db.close()
  }

  private sanitizeFtsQuery(query: string): string {
    // Escape special FTS5 characters and convert to search terms
    const cleaned = query.replace(/[^a-zA-Z0-9\s-]/g, ' ').trim()
    const words = cleaned.split(/\s+/).filter(w => w.length > 1)
    if (words.length === 0) return '""'
    // Use implicit AND by joining words with spaces
    return words.join(' ')
  }

  private likeFallback(query: string, wing?: string, room?: string, limit: number = 5): SearchResult[] {
    let sql = 'SELECT * FROM drawers WHERE content LIKE ?'
    const params: any[] = [`%${query}%`]

    if (wing) {
      sql += ' AND wing = ?'
      params.push(wing)
    }
    if (room) {
      sql += ' AND room = ?'
      params.push(room)
    }
    sql += ' ORDER BY importance DESC LIMIT ?'
    params.push(limit)

    return (this.db.prepare(sql).all(...params) as any[]).map(r => ({
      ...this.rowToDrawer(r),
      rank: 0,
    }))
  }

  private rowToDrawer(row: any): Drawer {
    return {
      id: row.id,
      content: row.content,
      metadata: {
        wing: row.wing,
        room: row.room,
        hall: row.hall,
        source_file: row.source_file,
        chunk_index: row.chunk_index,
        added_by: row.added_by,
        filed_at: row.filed_at,
        importance: row.importance,
        emotional_weight: row.emotional_weight,
        date: row.date,
        topic: row.topic,
        type: row.type,
        agent: row.agent,
      },
    }
  }
}
