/**
 * Local (SQLite/IPC) board operations.
 */

const { ipcRenderer } = window.require('electron')

import type { BoardData } from './boardTypes'

let _projectDir: string | null = null
export function setBoardProjectDir(dir: string | null) { _projectDir = dir }

export async function loadBoardFromRtdb(
  buildingId: string | null,
): Promise<{ success: boolean; board: BoardData | null; error?: string }> {
  return ipcRenderer.invoke('board-load', { projectDir: _projectDir, buildingId })
}

export async function listBoardsFromRtdb(): Promise<{ success: boolean; boards: string[]; error?: string }> {
  return ipcRenderer.invoke('board-list', { projectDir: _projectDir })
}

export async function saveBoardToRtdb(
  board: BoardData,
  buildingId: string | null,
): Promise<{ success: boolean; error?: string }> {
  return ipcRenderer.invoke('board-save', { board, projectDir: _projectDir, buildingId })
}

/** Local subscription: boards don't need push — load on demand. */
export function subscribeToBoardUpdates(
  buildingId: string | null,
  callback: (board: BoardData | null) => void,
): () => void {
  ipcRenderer.invoke('board-load', { projectDir: _projectDir, buildingId }).then((result: any) => {
    callback(result.success ? result.board : null)
  }).catch(() => callback(null))
  return () => {}
}
