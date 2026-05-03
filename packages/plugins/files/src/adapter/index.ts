import type { FilesAdapter } from './types.js'

export type { FilesAdapter, FsEntry, FsListResult } from './types.js'

// ── DI singleton ────────────────────────────────────────────────

let _adapter: FilesAdapter | null = null

export function getFilesAdapter(): FilesAdapter {
  if (!_adapter) throw new Error('[plugin-files] No FilesAdapter registered. Call setFilesAdapter() at app startup.')
  return _adapter
}

export function setFilesAdapter(adapter: FilesAdapter): void {
  _adapter = adapter
}
