/**
 * Board data manager -- terminal-app entry point.
 *
 * Re-exports pure operations from @pixel-city/plugin-board.
 * Persistence functions delegate to the local SQLite/IPC store.
 */

import { loadBoardFromRtdb, saveBoardToRtdb } from './taskDbLocal'
import { listEmployeesFromRtdb } from '../employee/employeeDbLocal'
import type { BoardData } from '@pixel-city/plugin-board'

// -- Board persistence (local SQLite via IPC) --

export async function loadBoard(_projectDir: string | null, buildingId: string | null): Promise<{ success: boolean; board?: BoardData }> {
  const result = await loadBoardFromRtdb(buildingId)
  return { success: result.success, board: result.board ?? undefined }
}

export async function saveBoard(board: BoardData, _projectDir: string | null, buildingId: string | null): Promise<void> {
  await saveBoardToRtdb(board, buildingId)
}

// -- Employee loading --

export async function loadEmployees(_projectCwd: string | null): Promise<Array<{ id: string; name: string; palette: number }>> {
  const result = await listEmployeesFromRtdb()
  if (result.success) {
    return result.employees.map(emp => ({
      id: emp.id,
      name: emp.settings.name,
      palette: emp.settings.palette ?? 0,
    }))
  }
  return []
}

// Re-export pure operations from plugin
export {
  resolveBoard,
  updateNestedBoard,
  createTask,
  updateTask,
  deleteTask,
  moveTask,
  assignTask,
  dispatchBoardUpdate,
} from '@pixel-city/plugin-board'
