/**
 * In-memory implementation of BoardStore.
 *
 * Useful for tests, offline development, and ephemeral sessions.
 */

import type { BoardData, BoardStore } from './types.js'
import { DEFAULT_BOARD } from './constants.js'

export class InMemoryBoardStore implements BoardStore {
  private boards = new Map<string, BoardData>()
  private listeners = new Map<string, Set<(board: BoardData | null) => void>>()

  private key(buildingId: string | null): string {
    return buildingId ?? 'default'
  }

  async load(buildingId: string | null): Promise<{ success: boolean; board?: BoardData }> {
    const board = this.boards.get(this.key(buildingId))
    return { success: true, board: board ? JSON.parse(JSON.stringify(board)) : undefined }
  }

  async save(board: BoardData, buildingId: string | null): Promise<{ success: boolean }> {
    const k = this.key(buildingId)
    const copy = JSON.parse(JSON.stringify(board)) as BoardData
    this.boards.set(k, copy)
    // Notify subscribers
    const subs = this.listeners.get(k)
    if (subs) {
      for (const cb of subs) cb(copy)
    }
    return { success: true }
  }

  async list(): Promise<{ success: boolean; boards: string[] }> {
    return { success: true, boards: [...this.boards.keys()] }
  }

  subscribe(buildingId: string | null, callback: (board: BoardData | null) => void): () => void {
    const k = this.key(buildingId)
    if (!this.listeners.has(k)) this.listeners.set(k, new Set())
    const subs = this.listeners.get(k)!
    subs.add(callback)
    return () => { subs.delete(callback) }
  }
}
