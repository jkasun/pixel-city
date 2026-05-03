// ── Types ────────────────────────────────────────────────────────

export interface ChangedFile {
  path: string
  name: string
  status: 'M' | 'A' | 'D' | 'R' | 'U' | '?'
  staged: boolean
  origPath?: string
}

export interface BranchInfo {
  current: string
  tracking?: string
  ahead: number
  behind: number
}

export interface CommitEntry {
  hash: string
  shortHash: string
  message: string
  author: string
  relativeDate: string
}

export interface BranchEntry {
  name: string
  isCurrent: boolean
  isRemote: boolean
  commitHash: string
  commitMessage: string
  author: string
  relativeDate: string
  ahead: number
  behind: number
}

export interface DiscoveredRepo {
  name: string
  path: string
  source: 'auto' | 'asset'
}

export interface AgentFileGroup {
  agentId: number
  agentName: string
  agentPalette: number
  files: ChangedFile[]
}

// ── Status display helpers ───────────────────────────────────────

export const STATUS_COLORS: Record<string, string> = {
  M: 'var(--git-modified)', A: 'var(--git-added)', D: 'var(--git-deleted)', R: 'var(--git-added)', U: 'var(--git-unmerged)', '?': 'var(--git-added)',
}

export const STATUS_LABELS: Record<string, string> = {
  M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed', U: 'Unmerged', '?': 'Untracked',
}
