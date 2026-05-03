/**
 * Board module entry point.
 *
 * Exports a singleton BoardStore instance. The consuming app
 * calls setBoardStore() at startup to provide the implementation
 * (RtdbBoardStore, InMemoryBoardStore, etc.)
 */

import { InMemoryBoardStore } from './inMemoryBoardStore.js'
import type { BoardStore } from './types.js'

let store: BoardStore | null = null

export function getBoardStore(): BoardStore {
  if (!store) store = new InMemoryBoardStore()
  return store
}

export function setBoardStore(s: BoardStore): void {
  store = s
}

// Types
export type {
  ChangelogEntry,
  Task,
  Column,
  BoardData,
  AgentOption,
  SpawnedAgent,
  BoardViewProps,
  AgentTaskPanelProps,
  BoardStore,
} from './types.js'

// Constants & utilities
export {
  PALETTE_COLORS,
  paletteColor,
  COLUMN_DEFS,
  BACKLOG_COL,
  DEFAULT_BOARD,
  initials,
  formatTimestamp,
} from './constants.js'

// Pure operations
export {
  resolveBoard,
  updateNestedBoard,
  createTask,
  updateTask,
  deleteTask,
  moveTask,
  assignTask,
  dispatchBoardUpdate,
} from './operations.js'

export { InMemoryBoardStore } from './inMemoryBoardStore.js'
