/**
 * Board Plugin Package
 *
 * Exports board types, constants, pure operations, and the BoardStore
 * abstraction. The UI components (BoardContext, BoardView, TaskCard, etc.)
 * remain in the consuming app due to deep context coupling.
 *
 * The plugin manifest is exported so consuming apps can register it
 * with their own Component/AgentTab implementations.
 */

import { BoardIcon } from './icons.js'
import type { PluginManifest } from '@pixel-city/core'

export const boardManifest: PluginManifest = {
  id: 'board',
  name: 'Board',
  icon: BoardIcon,
  order: 20,
  description: 'Task board with kanban columns',
  builtIn: true,
}

// Board store DI
export { getBoardStore, setBoardStore } from './board/index.js'
export { InMemoryBoardStore } from './board/inMemoryBoardStore.js'

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
} from './board/types.js'

// Constants & utilities
export {
  PALETTE_COLORS,
  paletteColor,
  COLUMN_DEFS,
  BACKLOG_COL,
  DEFAULT_BOARD,
  initials,
  formatTimestamp,
} from './board/constants.js'

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
} from './board/operations.js'

export { BoardIcon } from './icons.js'
