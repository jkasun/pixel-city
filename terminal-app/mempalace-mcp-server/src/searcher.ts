/**
 * searcher.ts — Find anything. Exact words.
 *
 * Full-text search against the palace using SQLite FTS5.
 * Returns verbatim text — the actual words, never summaries.
 */

import path from 'path'
import { DrawerStore } from './storage.js'
import { MempalaceConfig } from './config.js'

export function searchMemories(
  query: string,
  palacePath?: string,
  wing?: string,
  room?: string,
  nResults: number = 5,
): Record<string, any> {
  let store: DrawerStore | null = null
  try {
    const config = new MempalaceConfig()
    store = new DrawerStore(config)

    const results = store.search(query, wing, room, nResults)

    const hits = results.map(r => ({
      text: r.content,
      wing: r.metadata.wing || 'unknown',
      room: r.metadata.room || 'unknown',
      source_file: r.metadata.source_file
        ? path.basename(r.metadata.source_file)
        : '?',
      similarity: r.rank !== undefined ? Math.round(Math.abs(r.rank) * 1000) / 1000 : 0,
    }))

    return {
      query,
      filters: { wing: wing || null, room: room || null },
      results: hits,
    }
  } catch (e: any) {
    return { error: `Search error: ${e.message}` }
  } finally {
    store?.close()
  }
}
