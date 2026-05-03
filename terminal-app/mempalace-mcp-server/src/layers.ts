/**
 * layers.ts — 4-Layer Memory Stack
 *
 *   Layer 0: Identity       (~100 tokens)    — Always loaded. "Who am I?"
 *   Layer 1: Essential Story (~500-800)       — Always loaded. Top moments.
 *   Layer 2: On-Demand      (~200-500 each)   — Loaded when topic comes up.
 *   Layer 3: Deep Search    (unlimited)       — Full-text search.
 *
 * Wake-up cost: ~600-900 tokens (L0+L1). Leaves 95%+ of context free.
 */

import fs from 'fs'
import path from 'path'
import { DrawerStore } from './storage.js'
import { MempalaceConfig } from './config.js'

const MAX_DRAWERS = 15
const MAX_CHARS = 3200

export class Layer0 {
  private identityPath: string
  private text: string | null = null

  constructor(identityPath: string) {
    this.identityPath = identityPath
  }

  render(): string {
    if (this.text !== null) return this.text

    if (fs.existsSync(this.identityPath)) {
      this.text = fs.readFileSync(this.identityPath, 'utf-8').trim()
    } else {
      this.text = '## L0 — IDENTITY\nNo identity configured. Create ~/.mempalace/identity.txt'
    }

    return this.text
  }

  tokenEstimate(): number {
    return Math.floor(this.render().length / 4)
  }
}

export class Layer1 {
  private store: DrawerStore
  private wing?: string

  constructor(store: DrawerStore, wing?: string) {
    this.store = store
    this.wing = wing
  }

  setWing(wing: string): void {
    this.wing = wing
  }

  generate(): string {
    const drawers = this.store.getAll(this.wing, undefined, 100)

    if (drawers.length === 0) {
      return '## L1 — No memories yet.'
    }

    // Score by importance, take top N
    const scored = drawers.map(d => ({
      importance: d.metadata.importance || 3,
      room: d.metadata.room || 'general',
      source: d.metadata.source_file ? path.basename(d.metadata.source_file) : '',
      content: d.content,
    }))

    scored.sort((a, b) => b.importance - a.importance)
    const top = scored.slice(0, MAX_DRAWERS)

    // Group by room
    const byRoom: Record<string, typeof top> = {}
    for (const entry of top) {
      if (!byRoom[entry.room]) byRoom[entry.room] = []
      byRoom[entry.room].push(entry)
    }

    const lines = ['## L1 — ESSENTIAL STORY']
    let totalLen = 0

    for (const room of Object.keys(byRoom).sort()) {
      const roomLine = `\n[${room}]`
      lines.push(roomLine)
      totalLen += roomLine.length

      for (const entry of byRoom[room]) {
        let snippet = entry.content.trim().replace(/\n/g, ' ')
        if (snippet.length > 200) snippet = snippet.slice(0, 197) + '...'

        let entryLine = `  - ${snippet}`
        if (entry.source) entryLine += `  (${entry.source})`

        if (totalLen + entryLine.length > MAX_CHARS) {
          lines.push('  ... (more in L3 search)')
          return lines.join('\n')
        }

        lines.push(entryLine)
        totalLen += entryLine.length
      }
    }

    return lines.join('\n')
  }
}

export class Layer2 {
  private store: DrawerStore

  constructor(store: DrawerStore) {
    this.store = store
  }

  retrieve(wing?: string, room?: string, nResults: number = 10): string {
    const drawers = this.store.getAll(wing, room, nResults)

    if (drawers.length === 0) {
      const label = [wing && `wing=${wing}`, room && `room=${room}`].filter(Boolean).join(' ')
      return `No drawers found for ${label || 'query'}.`
    }

    const lines = [`## L2 — ON-DEMAND (${drawers.length} drawers)`]
    for (const d of drawers) {
      const roomName = d.metadata.room || '?'
      const source = d.metadata.source_file ? path.basename(d.metadata.source_file) : ''
      let snippet = d.content.trim().replace(/\n/g, ' ')
      if (snippet.length > 300) snippet = snippet.slice(0, 297) + '...'

      let entry = `  [${roomName}] ${snippet}`
      if (source) entry += `  (${source})`
      lines.push(entry)
    }

    return lines.join('\n')
  }
}

export class Layer3 {
  private store: DrawerStore

  constructor(store: DrawerStore) {
    this.store = store
  }

  search(query: string, wing?: string, room?: string, nResults: number = 5): string {
    const results = this.store.search(query, wing, room, nResults)

    if (results.length === 0) return 'No results found.'

    const lines = [`## L3 — SEARCH RESULTS for "${query}"`]
    results.forEach((r, i) => {
      const wingName = r.metadata.wing || '?'
      const roomName = r.metadata.room || '?'
      const source = r.metadata.source_file ? path.basename(r.metadata.source_file) : ''

      let snippet = r.content.trim().replace(/\n/g, ' ')
      if (snippet.length > 300) snippet = snippet.slice(0, 297) + '...'

      lines.push(`  [${i + 1}] ${wingName}/${roomName}`)
      lines.push(`      ${snippet}`)
      if (source) lines.push(`      src: ${source}`)
    })

    return lines.join('\n')
  }
}

export class MemoryStack {
  private config: MempalaceConfig
  private store: DrawerStore
  l0: Layer0
  l1: Layer1
  l2: Layer2
  l3: Layer3

  constructor(config?: MempalaceConfig) {
    this.config = config || new MempalaceConfig()
    this.store = new DrawerStore(this.config)
    this.l0 = new Layer0(this.config.identityPath)
    this.l1 = new Layer1(this.store)
    this.l2 = new Layer2(this.store)
    this.l3 = new Layer3(this.store)
  }

  wakeUp(wing?: string): string {
    const parts: string[] = []
    parts.push(this.l0.render())
    parts.push('')
    if (wing) this.l1.setWing(wing)
    parts.push(this.l1.generate())
    return parts.join('\n')
  }

  recall(wing?: string, room?: string, nResults: number = 10): string {
    return this.l2.retrieve(wing, room, nResults)
  }

  search(query: string, wing?: string, room?: string, nResults: number = 5): string {
    return this.l3.search(query, wing, room, nResults)
  }

  status(): Record<string, any> {
    return {
      palace_path: this.config.palacePath,
      L0_identity: {
        path: this.config.identityPath,
        exists: fs.existsSync(this.config.identityPath),
        tokens: this.l0.tokenEstimate(),
      },
      L1_essential: { description: 'Auto-generated from top palace drawers' },
      L2_on_demand: { description: 'Wing/room filtered retrieval' },
      L3_deep_search: { description: 'Full-text search via SQLite FTS5' },
      total_drawers: this.store.count(),
    }
  }

  getStore(): DrawerStore {
    return this.store
  }

  close(): void {
    this.store.close()
  }
}
