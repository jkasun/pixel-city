/**
 * knowledge-graph.ts — Temporal Entity-Relationship Graph
 *
 * Entity nodes + typed relationship edges with temporal validity.
 * Storage: SQLite (local, no dependencies, no subscriptions)
 */

import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { MempalaceConfig } from './config.js'

export interface Triple {
  direction?: string
  subject: string
  predicate: string
  object: string
  valid_from: string | null
  valid_to: string | null
  confidence?: number
  source_closet?: string
  current: boolean
}

export class KnowledgeGraph {
  private db: Database.Database

  constructor(dbPath?: string) {
    const config = new MempalaceConfig()
    const resolvedPath = dbPath || config.kgPath
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true })
    this.db = new Database(resolvedPath)
    this.db.pragma('journal_mode = WAL')
    this.initDb()
  }

  private initDb(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'unknown',
        properties TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS triples (
        id TEXT PRIMARY KEY,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object TEXT NOT NULL,
        valid_from TEXT,
        valid_to TEXT,
        confidence REAL DEFAULT 1.0,
        source_closet TEXT,
        source_file TEXT,
        extracted_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (subject) REFERENCES entities(id),
        FOREIGN KEY (object) REFERENCES entities(id)
      );

      CREATE INDEX IF NOT EXISTS idx_triples_subject ON triples(subject);
      CREATE INDEX IF NOT EXISTS idx_triples_object ON triples(object);
      CREATE INDEX IF NOT EXISTS idx_triples_predicate ON triples(predicate);
      CREATE INDEX IF NOT EXISTS idx_triples_valid ON triples(valid_from, valid_to);
    `)
  }

  private entityId(name: string): string {
    return name.toLowerCase().replace(/ /g, '_').replace(/'/g, '')
  }

  addEntity(name: string, entityType: string = 'unknown', properties?: Record<string, any>): string {
    const eid = this.entityId(name)
    const props = JSON.stringify(properties || {})
    this.db.prepare(
      'INSERT OR REPLACE INTO entities (id, name, type, properties) VALUES (?, ?, ?, ?)'
    ).run(eid, name, entityType, props)
    return eid
  }

  addTriple(
    subject: string,
    predicate: string,
    obj: string,
    validFrom?: string,
    validTo?: string,
    confidence: number = 1.0,
    sourceCloset?: string,
    sourceFile?: string,
  ): string {
    const subId = this.entityId(subject)
    const objId = this.entityId(obj)
    const pred = predicate.toLowerCase().replace(/ /g, '_')

    // Auto-create entities
    this.db.prepare('INSERT OR IGNORE INTO entities (id, name) VALUES (?, ?)').run(subId, subject)
    this.db.prepare('INSERT OR IGNORE INTO entities (id, name) VALUES (?, ?)').run(objId, obj)

    // Check for existing identical triple
    const existing = this.db.prepare(
      'SELECT id FROM triples WHERE subject=? AND predicate=? AND object=? AND valid_to IS NULL'
    ).get(subId, pred, objId) as any

    if (existing) return existing.id

    const hash = crypto.createHash('md5')
      .update(`${validFrom}${new Date().toISOString()}`)
      .digest('hex')
      .slice(0, 8)
    const tripleId = `t_${subId}_${pred}_${objId}_${hash}`

    this.db.prepare(`
      INSERT INTO triples (id, subject, predicate, object, valid_from, valid_to, confidence, source_closet, source_file)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tripleId, subId, pred, objId, validFrom || null, validTo || null, confidence, sourceCloset || null, sourceFile || null)

    return tripleId
  }

  invalidate(subject: string, predicate: string, obj: string, ended?: string): void {
    const subId = this.entityId(subject)
    const objId = this.entityId(obj)
    const pred = predicate.toLowerCase().replace(/ /g, '_')
    const endDate = ended || new Date().toISOString().split('T')[0]

    this.db.prepare(
      'UPDATE triples SET valid_to=? WHERE subject=? AND predicate=? AND object=? AND valid_to IS NULL'
    ).run(endDate, subId, pred, objId)
  }

  queryEntity(name: string, asOf?: string, direction: string = 'outgoing'): Triple[] {
    const eid = this.entityId(name)
    const results: Triple[] = []

    if (direction === 'outgoing' || direction === 'both') {
      let sql = 'SELECT t.*, e.name as obj_name FROM triples t JOIN entities e ON t.object = e.id WHERE t.subject = ?'
      const params: any[] = [eid]

      if (asOf) {
        sql += ' AND (t.valid_from IS NULL OR t.valid_from <= ?) AND (t.valid_to IS NULL OR t.valid_to >= ?)'
        params.push(asOf, asOf)
      }

      const rows = this.db.prepare(sql).all(...params) as any[]
      for (const row of rows) {
        results.push({
          direction: 'outgoing',
          subject: name,
          predicate: row.predicate,
          object: row.obj_name,
          valid_from: row.valid_from,
          valid_to: row.valid_to,
          confidence: row.confidence,
          source_closet: row.source_closet,
          current: row.valid_to === null,
        })
      }
    }

    if (direction === 'incoming' || direction === 'both') {
      let sql = 'SELECT t.*, e.name as sub_name FROM triples t JOIN entities e ON t.subject = e.id WHERE t.object = ?'
      const params: any[] = [eid]

      if (asOf) {
        sql += ' AND (t.valid_from IS NULL OR t.valid_from <= ?) AND (t.valid_to IS NULL OR t.valid_to >= ?)'
        params.push(asOf, asOf)
      }

      const rows = this.db.prepare(sql).all(...params) as any[]
      for (const row of rows) {
        results.push({
          direction: 'incoming',
          subject: row.sub_name,
          predicate: row.predicate,
          object: name,
          valid_from: row.valid_from,
          valid_to: row.valid_to,
          confidence: row.confidence,
          source_closet: row.source_closet,
          current: row.valid_to === null,
        })
      }
    }

    return results
  }

  timeline(entityName?: string): Triple[] {
    let rows: any[]

    if (entityName) {
      const eid = this.entityId(entityName)
      rows = this.db.prepare(`
        SELECT t.*, s.name as sub_name, o.name as obj_name
        FROM triples t
        JOIN entities s ON t.subject = s.id
        JOIN entities o ON t.object = o.id
        WHERE (t.subject = ? OR t.object = ?)
        ORDER BY t.valid_from ASC NULLS LAST
      `).all(eid, eid) as any[]
    } else {
      rows = this.db.prepare(`
        SELECT t.*, s.name as sub_name, o.name as obj_name
        FROM triples t
        JOIN entities s ON t.subject = s.id
        JOIN entities o ON t.object = o.id
        ORDER BY t.valid_from ASC NULLS LAST
        LIMIT 100
      `).all() as any[]
    }

    return rows.map(r => ({
      subject: r.sub_name,
      predicate: r.predicate,
      object: r.obj_name,
      valid_from: r.valid_from,
      valid_to: r.valid_to,
      current: r.valid_to === null,
    }))
  }

  stats(): Record<string, any> {
    const entities = (this.db.prepare('SELECT COUNT(*) as cnt FROM entities').get() as any).cnt
    const triples = (this.db.prepare('SELECT COUNT(*) as cnt FROM triples').get() as any).cnt
    const current = (this.db.prepare('SELECT COUNT(*) as cnt FROM triples WHERE valid_to IS NULL').get() as any).cnt
    const expired = triples - current
    const predicates = (this.db.prepare(
      'SELECT DISTINCT predicate FROM triples ORDER BY predicate'
    ).all() as any[]).map(r => r.predicate)

    return {
      entities,
      triples,
      current_facts: current,
      expired_facts: expired,
      relationship_types: predicates,
    }
  }

  close(): void {
    this.db.close()
  }
}
