import type { PluginManifest } from '@pixel-city/core/plugin'
import { GitMergeIcon } from '@pixel-city/ui'

// ── Plugin manifest ─────────────────────────────────────────────

export const gitManifest: PluginManifest = {
  id: 'git',
  name: 'Git',
  icon: GitMergeIcon,
  order: 50,
  description: 'Git history and diff viewer',
  builtIn: true,
}

// ── DI exports ──────────────────────────────────────────────────

export { getGitAdapter, setGitAdapter } from './adapter/index.js'
export type { GitAdapter } from './adapter/index.js'

// ── Types ───────────────────────────────────────────────────────

export type {
  ChangedFile,
  BranchInfo,
  CommitEntry,
  BranchEntry,
  DiscoveredRepo,
  AgentFileGroup,
} from './types.js'

export { STATUS_COLORS, STATUS_LABELS } from './types.js'

// ── Utils ───────────────────────────────────────────────────────

export { getLanguage, posixBasename, posixResolve } from './utils.js'
