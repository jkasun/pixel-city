import type { ChangedFile, BranchInfo, CommitEntry } from './gitTypes'

const { execFileSync } = window.require('child_process') as typeof import('child_process')
const pathModule = window.require('path') as typeof import('path')
const fs = window.require('fs') as typeof import('fs')

// ── Core git helper ──────────────────────────────────────────────

function git(args: string[], cwd: string): string {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 10000 }).trimEnd()
  } catch { return '' }
}

// ── Queries ──────────────────────────────────────────────────────

export function getGitRoot(cwd: string): string {
  return git(['rev-parse', '--show-toplevel'], cwd) || cwd
}

export function isGitRepo(cwd: string): boolean {
  return git(['rev-parse', '--is-inside-work-tree'], cwd) === 'true'
}

export function getBranchInfo(cwd: string): BranchInfo {
  const current = git(['branch', '--show-current'], cwd) || 'HEAD'
  const tracking = git(['for-each-ref', '--format=%(upstream:short)', `refs/heads/${current}`], cwd) || undefined
  let ahead = 0, behind = 0
  if (tracking) {
    const ab = git(['rev-list', '--left-right', '--count', `${current}...${tracking}`], cwd)
    if (ab) {
      const parts = ab.split(/\s+/)
      ahead = parseInt(parts[0]) || 0
      behind = parseInt(parts[1]) || 0
    }
  }
  return { current, tracking, ahead, behind }
}

export function getChangedFiles(cwd: string): ChangedFile[] {
  const output = git(['status', '--porcelain', '-u', '--ignore-submodules'], cwd)
  if (!output) return []
  const files: ChangedFile[] = []
  for (const line of output.split('\n')) {
    if (line.length < 4) continue
    const x = line[0]
    const y = line[1]
    const rest = line.substring(3)
    const parts = rest.split(' -> ')
    const filePath = parts[parts.length - 1].trim().replace(/^"(.*)"$/, '$1')
    const origPath = parts.length > 1 ? parts[0].trim().replace(/^"(.*)"$/, '$1') : undefined
    const name = pathModule.basename(filePath)

    if (x !== ' ' && x !== '?') {
      files.push({ path: filePath, name, status: x as ChangedFile['status'], staged: true, origPath })
    }
    if (y !== ' ' || x === '?') {
      files.push({ path: filePath, name, status: x === '?' ? '?' : y as ChangedFile['status'], staged: false, origPath })
    }
  }
  return files
}

// ── Branch operations ────────────────────────────────────────────

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

export function listBranches(cwd: string): BranchEntry[] {
  const current = git(['branch', '--show-current'], cwd) || ''

  // Local branches with details
  const localFormat = '%(refname:short)\t%(objectname:short)\t%(subject)\t%(authorname)\t%(creatordate:relative)\t%(upstream:short)'
  const localOutput = git(['for-each-ref', '--format=' + localFormat, '--sort=-creatordate', 'refs/heads/'], cwd)
  const branches: BranchEntry[] = []

  if (localOutput) {
    for (const line of localOutput.split('\n')) {
      const [name, commitHash, commitMessage, author, relativeDate, tracking] = line.split('\t')
      if (!name) continue
      let ahead = 0, behind = 0
      if (tracking) {
        const ab = git(['rev-list', '--left-right', '--count', `${name}...${tracking}`], cwd)
        if (ab) {
          const parts = ab.split(/\s+/)
          ahead = parseInt(parts[0]) || 0
          behind = parseInt(parts[1]) || 0
        }
      }
      branches.push({
        name, isCurrent: name === current, isRemote: false,
        commitHash: commitHash || '', commitMessage: commitMessage || '',
        author: author || '', relativeDate: relativeDate || '',
        ahead, behind,
      })
    }
  }

  // Remote branches
  const remoteFormat = '%(refname:short)\t%(objectname:short)\t%(subject)\t%(authorname)\t%(creatordate:relative)'
  const remoteOutput = git(['for-each-ref', '--format=' + remoteFormat, '--sort=-creatordate', 'refs/remotes/'], cwd)

  if (remoteOutput) {
    for (const line of remoteOutput.split('\n')) {
      const [name, commitHash, commitMessage, author, relativeDate] = line.split('\t')
      if (!name || name.endsWith('/HEAD')) continue
      // Skip remotes that have a corresponding local branch
      const localName = name.replace(/^[^/]+\//, '')
      if (branches.some(b => b.name === localName)) continue
      branches.push({
        name, isCurrent: false, isRemote: true,
        commitHash: commitHash || '', commitMessage: commitMessage || '',
        author: author || '', relativeDate: relativeDate || '',
        ahead: 0, behind: 0,
      })
    }
  }

  return branches
}

export function checkoutBranch(cwd: string, branchName: string): { success: boolean; error?: string } {
  try {
    execFileSync('git', ['checkout', branchName], { cwd, encoding: 'utf8', timeout: 15000 })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.stderr?.trim() || e.message || 'Checkout failed' }
  }
}

export function createBranch(cwd: string, branchName: string): { success: boolean; error?: string } {
  try {
    execFileSync('git', ['checkout', '-b', branchName], { cwd, encoding: 'utf8', timeout: 15000 })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.stderr?.trim() || e.message || 'Failed to create branch' }
  }
}

// ── Commit log ──────────────────────────────────────────────────

export function getCommitLog(cwd: string, count = 20): CommitEntry[] {
  const format = '%H\t%h\t%s\t%an\t%cr'
  const output = git(['log', `--format=${format}`, `-${count}`, '--no-merges'], cwd)
  if (!output) return []
  const entries: CommitEntry[] = []
  for (const line of output.split('\n')) {
    const [hash, shortHash, message, author, relativeDate] = line.split('\t')
    if (!hash) continue
    entries.push({ hash, shortHash, message, author, relativeDate })
  }
  return entries
}

export function getCommitFiles(cwd: string, commitHash: string): ChangedFile[] {
  const output = git(['diff-tree', '--no-commit-id', '-r', '--name-status', commitHash], cwd)
  if (!output) return []
  const files: ChangedFile[] = []
  for (const line of output.split('\n')) {
    if (!line.trim()) continue
    const parts = line.split('\t')
    const statusChar = parts[0][0]
    const filePath = parts.length > 2 ? parts[2] : parts[1]
    const origPath = parts.length > 2 ? parts[1] : undefined
    const name = pathModule.basename(filePath)
    const status = statusChar === 'C' ? 'A' : statusChar as ChangedFile['status']
    files.push({ path: filePath, name, status, staged: false, origPath })
  }
  return files
}

export function getCommitFileContent(cwd: string, commitHash: string, filePath: string): string {
  return git(['show', `${commitHash}:${filePath}`], cwd)
}

export function getCommitParentFileContent(cwd: string, commitHash: string, filePath: string): string {
  return git(['show', `${commitHash}^:${filePath}`], cwd)
}

// ── Staging / unstaging ──────────────────────────────────────────

export function stageFile(cwd: string, filePath: string) {
  git(['add', '--', filePath], cwd)
}

export function stageFiles(cwd: string, filePaths: string[]) {
  if (filePaths.length === 0) return
  git(['add', '--', ...filePaths], cwd)
}

export function unstageFile(cwd: string, filePath: string) {
  git(['reset', 'HEAD', '--', filePath], cwd)
}

export function unstageFiles(cwd: string, filePaths: string[]) {
  if (filePaths.length === 0) return
  git(['reset', 'HEAD', '--', ...filePaths], cwd)
}

export function unstageAll(cwd: string) {
  git(['reset', 'HEAD'], cwd)
}

export function discardChanges(cwd: string, filePath: string, isUntracked: boolean) {
  if (isUntracked) {
    const gitRoot = getGitRoot(cwd)
    const absPath = pathModule.resolve(gitRoot, filePath)
    try {
      const stat = fs.statSync(absPath)
      if (stat.isDirectory()) fs.rmSync(absPath, { recursive: true })
      else fs.unlinkSync(absPath)
    } catch { /* already gone */ }
  } else {
    git(['checkout', '--', filePath], cwd)
  }
}

export function discardMultiple(cwd: string, files: ChangedFile[]) {
  const untracked = files.filter(f => f.status === '?')
  const tracked = files.filter(f => f.status !== '?')
  for (const f of untracked) discardChanges(cwd, f.path, true)
  if (tracked.length > 0) {
    git(['checkout', '--', ...tracked.map(f => f.path)], cwd)
  }
}

// ── Diff helpers ─────────────────────────────────────────────────

export function getOriginalContent(cwd: string, filePath: string, staged: boolean): string {
  if (staged) return git(['show', `HEAD:${filePath}`], cwd)
  return git(['show', `:${filePath}`], cwd)
}

export function getModifiedContent(cwd: string, filePath: string, staged: boolean): string {
  if (staged) return git(['show', `:${filePath}`], cwd)
  // filePath from git status is relative to git root, not cwd
  const gitRoot = getGitRoot(cwd)
  const absPath = pathModule.resolve(gitRoot, filePath)
  try { return fs.readFileSync(absPath, 'utf8') } catch { return '' }
}

// ── Language detection ───────────────────────────────────────────

export function getLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    json: 'json', md: 'markdown', css: 'css', scss: 'scss', less: 'less',
    html: 'html', xml: 'xml', yaml: 'yaml', yml: 'yaml',
    py: 'python', rs: 'rust', go: 'go', java: 'java',
    sh: 'shell', bash: 'shell', zsh: 'shell', sql: 'sql',
    svelte: 'html', vue: 'html', php: 'php', rb: 'ruby',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
    swift: 'swift', kt: 'kotlin', dart: 'dart',
  }
  return map[ext] || 'plaintext'
}
