import type { GitAdapter } from './types.js'

let _adapter: GitAdapter | null = null

export function getGitAdapter(): GitAdapter {
  if (!_adapter) throw new Error('[plugin-git] No GitAdapter registered. Call setGitAdapter() at app startup.')
  return _adapter
}

export function setGitAdapter(adapter: GitAdapter): void {
  _adapter = adapter
}

export type { GitAdapter } from './types.js'
