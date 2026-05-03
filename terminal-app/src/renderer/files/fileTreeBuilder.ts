import type { FileNode } from './fileTypes'
import { IGNORED } from './fileTypes'
import { isGitRepo } from '../git/gitClient.js'

const fs = window.require('fs') as typeof import('fs')
const fsPromises = fs.promises
const pathModule = window.require('path') as typeof import('path')
const { execFileSync, execFile } = window.require('child_process') as typeof import('child_process')

// ── Symlink-aware directory detection ──────────────────────────
//
// Dirent.isDirectory() returns false for symlinks even when the target is a
// directory. We must follow the link via stat() to classify symlinked folders
// correctly; otherwise they render as files (or get hidden by sort logic).

async function isDirOrLinkToDirAsync(entry: import('fs').Dirent, fullPath: string): Promise<boolean> {
  if (entry.isDirectory()) return true
  if (entry.isSymbolicLink()) {
    try { return (await fsPromises.stat(fullPath)).isDirectory() } catch { return false }
  }
  return false
}

function isDirOrLinkToDirSync(entry: import('fs').Dirent, fullPath: string): boolean {
  if (entry.isDirectory()) return true
  if (entry.isSymbolicLink()) {
    try { return fs.statSync(fullPath).isDirectory() } catch { return false }
  }
  return false
}

// ── Git-based tree builder (fast, no depth limit) ──────────────

let _lastGitCwd = ''
let _lastGitOutput = ''
let _lastGitTree: FileNode[] | null = null

function getGitDeletedFiles(cwd: string): Set<string> {
  try {
    const output = execFileSync('git', ['ls-files', '--deleted'], { cwd, encoding: 'utf8', timeout: 5000 })
    return new Set(output.split('\n').filter(Boolean))
  } catch { return new Set() }
}

function getGitFileList(cwd: string): string | null {
  try {
    if (!isGitRepo(cwd)) return null
    const output = execFileSync('git', [
      'ls-files', '--cached', '--others', '--exclude-standard',
    ], { cwd, encoding: 'utf8', timeout: 10000, maxBuffer: 50 * 1024 * 1024 })

    // Filter out files deleted from disk but still in git index
    const deleted = getGitDeletedFiles(cwd)
    if (deleted.size === 0) return output
    return output.split('\n').filter(line => line && !deleted.has(line)).join('\n')
  } catch { return null }
}

function buildTreeFromPaths(cwd: string, relativePaths: string[]): FileNode[] {
  // Build a nested map structure, then convert to FileNode[]
  interface DirEntry {
    files: Map<string, null>            // name -> null (leaf file)
    dirs: Map<string, DirEntry>         // name -> subtree
  }
  const root: DirEntry = { files: new Map(), dirs: new Map() }

  for (const relPath of relativePaths) {
    const parts = relPath.split('/')
    let current = root

    // Single-segment path that is actually a directory (e.g. git submodule)
    if (parts.length === 1) {
      const fullPath = pathModule.join(cwd, relPath)
      try {
        if (fs.statSync(fullPath).isDirectory()) {
          if (!current.dirs.has(relPath)) {
            current.dirs.set(relPath, { files: new Map(), dirs: new Map() })
          }
          continue
        }
      } catch { /* stat failed, treat as file */ }
    }

    for (let i = 0; i < parts.length - 1; i++) {
      const dirName = parts[i]
      if (!current.dirs.has(dirName)) {
        current.dirs.set(dirName, { files: new Map(), dirs: new Map() })
      }
      current = current.dirs.get(dirName)!
    }
    const fileName = parts[parts.length - 1]
    if (fileName) current.files.set(fileName, null)
  }

  // Convert DirEntry to sorted FileNode[]
  function toNodes(entry: DirEntry, parentPath: string): FileNode[] {
    const nodes: FileNode[] = []
    // Folders first (sorted)
    const sortedDirs = [...entry.dirs.keys()].sort((a, b) => a.localeCompare(b))
    for (const dirName of sortedDirs) {
      const fullPath = pathModule.join(parentPath, dirName)
      nodes.push({
        id: fullPath,
        name: dirName,
        isFolder: true,
        children: toNodes(entry.dirs.get(dirName)!, fullPath),
      })
    }
    // Files second (sorted)
    const sortedFiles = [...entry.files.keys()].sort((a, b) => a.localeCompare(b))
    for (const fileName of sortedFiles) {
      nodes.push({
        id: pathModule.join(parentPath, fileName),
        name: fileName,
        isFolder: false,
      })
    }
    return nodes
  }

  return toNodes(root, cwd)
}

/**
 * Merge directories that exist on disk but are missing from the git tree,
 * and populate submodule dirs that git listed as empty entries.
 * This handles nested git repos and submodules that `git ls-files` skips.
 */
function mergeNestedRepos(tree: FileNode[], dirPath: string): FileNode[] {
  // Populate submodule/nested repo folders that are in the tree but have no children
  for (const node of tree) {
    if (node.isFolder && (!node.children || node.children.length === 0)) {
      const fullPath = pathModule.join(dirPath, node.name)
      const nestedGitTree = buildTreeFromGitFiles(fullPath, true)
      node.children = nestedGitTree ?? readDirTree(fullPath)
    }
  }

  // Recursively merge disk entries into git-built tree at all levels.
  // This ensures empty folders and gitignored files appear everywhere, not just root.
  mergeDiskEntries(tree, dirPath)

  return tree
}

/**
 * Recursively merge entries from disk that are missing from the git-based tree.
 * This ensures empty folders and gitignored files appear at all nesting levels.
 * Nodes whose children were populated by readDirTree are already complete and
 * won't gain duplicates (knownNames filters them), but we skip recursing into
 * newly-added nodes since readDirTree already provides the full subtree.
 */
function mergeDiskEntries(tree: FileNode[], dirPath: string): void {
  // Track which folder nodes existed before we add new ones from disk —
  // these came from buildTreeFromPaths (git) and need recursive merging.
  // Newly added dirs come from readDirTree and are already complete.
  const gitBuiltFolders = new Set(
    tree.filter(n => n.isFolder).map(n => n.name),
  )

  const knownNames = new Set(tree.map(n => n.name))

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      if (IGNORED.has(entry.name) || entry.name === '.DS_Store') continue
      if (knownNames.has(entry.name)) continue

      const fullPath = pathModule.join(dirPath, entry.name)

      if (isDirOrLinkToDirSync(entry, fullPath)) {
        const nestedGitTree = buildTreeFromGitFiles(fullPath, true)
        tree.push({
          id: fullPath,
          name: entry.name,
          isFolder: true,
          children: nestedGitTree ?? readDirTree(fullPath),
        })
      } else {
        tree.push({
          id: fullPath,
          name: entry.name,
          isFolder: false,
        })
      }
    }
  } catch { /* permission error or similar */ }

  // Only recurse into folders that were built from git paths (not readDirTree)
  for (const node of tree) {
    if (node.isFolder && node.children && gitBuiltFolders.has(node.name)) {
      const fullPath = pathModule.join(dirPath, node.name)
      mergeDiskEntries(node.children, fullPath)
    }
  }

  // Re-sort: folders first, then alphabetical
  tree.sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

/**
 * Build file tree from `git ls-files` output. Returns null if not a git repo
 * or if the output hasn't changed since last call (memoized).
 * Pass `skipMemo: true` to force a rebuild.
 */
export function buildTreeFromGitFiles(cwd: string, skipMemo = false): FileNode[] | null {
  const output = getGitFileList(cwd)
  if (output === null) return null

  // Memoization: skip rebuild if output unchanged AND same cwd
  if (!skipMemo && cwd === _lastGitCwd && output === _lastGitOutput && _lastGitTree) {
    return _lastGitTree
  }

  const paths = output.split('\n').filter(Boolean)
  const tree = buildTreeFromPaths(cwd, paths)

  // Merge directories missing from git (nested repos, submodules)
  mergeNestedRepos(tree, cwd)

  _lastGitCwd = cwd
  _lastGitOutput = output
  _lastGitTree = tree
  return tree
}

// ── Flat file list (for Ctrl+P search) ──────────────────────────

function flattenTree(nodes: FileNode[]): string[] {
  const result: string[] = []
  const stack = [...nodes]
  while (stack.length > 0) {
    const node = stack.shift()!
    if (node.isFolder) {
      if (node.children) stack.push(...node.children)
    } else {
      result.push(node.id)
    }
  }
  return result
}

export function listAllFiles(cwd: string): string[] {
  const gitOutput = getGitFileList(cwd)
  if (gitOutput !== null) {
    return gitOutput.split('\n').filter(Boolean).map(f => pathModule.resolve(cwd, f))
  }
  return flattenTree(readDirTree(cwd))
}

// ── Progressive async file listing ─────────────────────────────
//
// Fully non-blocking. Calls `onFiles` with batches as they arrive:
//   Phase 1 ('root'):   root repo files via async git ls-files
//   Phase 2 ('nested'): each nested sub-repo discovered on disk
//   Phase 3 ('done'):   signals completion
//
// Each sub-repo's `git ls-files --exclude-standard` respects
// that repo's own .gitignore automatically.

export type FileSearchPhase = 'loading' | 'nested' | 'done'

export interface ProgressiveFileResult {
  files: string[]
  phase: FileSearchPhase
  /** Name of nested repo being scanned (only during 'nested' phase) */
  nestedRepo?: string
}

/** Run `git ls-files --deleted` asynchronously to find files missing from disk. */
function gitDeletedFilesAsync(cwd: string): Promise<Set<string>> {
  return new Promise((resolve) => {
    execFile('git', ['ls-files', '--deleted'], { cwd, encoding: 'utf8', timeout: 5000 }, (err, stdout) => {
      if (err || !stdout) { resolve(new Set()); return }
      resolve(new Set(stdout.split('\n').filter(Boolean)))
    })
  })
}

/** Run `git ls-files` asynchronously on a single directory. */
async function gitLsFilesAsync(cwd: string): Promise<string[]> {
  const [files, deleted] = await Promise.all([
    new Promise<string[]>((resolve) => {
      execFile('git', [
        'ls-files', '--cached', '--others', '--exclude-standard',
      ], { cwd, encoding: 'utf8', timeout: 15000, maxBuffer: 50 * 1024 * 1024 }, (err, stdout) => {
        if (err || !stdout) { resolve([]); return }
        resolve(stdout.split('\n').filter(Boolean))
      })
    }),
    gitDeletedFilesAsync(cwd),
  ])
  if (deleted.size === 0) return files
  return files.filter(f => !deleted.has(f))
}

/** Fast check for .git directory — no subprocess, no blocking. */
function hasGitDir(dirPath: string): boolean {
  try {
    return fs.existsSync(pathModule.join(dirPath, '.git'))
  } catch { return false }
}

/**
 * Progressively list all files from a project, including nested git repos.
 * Calls `onBatch` with file batches as each phase completes.
 * Returns a cancel function.
 */
export function listFilesProgressive(
  cwd: string,
  onBatch: (result: ProgressiveFileResult) => void,
): () => void {
  let cancelled = false

  ;(async () => {
    // Phase 1: root repo files
    const relPaths = hasGitDir(cwd) ? await gitLsFilesAsync(cwd) : []

    if (cancelled) return

    if (relPaths.length > 0) {
      const rootFiles = relPaths
        .filter(f => f.includes('/')) // multi-segment paths are always files
        .map(f => pathModule.resolve(cwd, f))

      // Single-segment entries might be submodule dirs — filter async
      for (const f of relPaths) {
        if (!f.includes('/')) {
          const full = pathModule.resolve(cwd, f)
          try {
            if (!fs.statSync(full).isDirectory()) rootFiles.push(full)
          } catch { rootFiles.push(full) }
        }
      }

      // Also include gitignored root-level files (e.g. .env)
      try {
        const diskEntries = fs.readdirSync(cwd, { withFileTypes: true })
        const gitSet = new Set(relPaths)
        for (const entry of diskEntries) {
          if (entry.name === '.DS_Store') continue
          if (gitSet.has(entry.name)) continue
          const fullPath = pathModule.resolve(cwd, entry.name)
          if (isDirOrLinkToDirSync(entry, fullPath)) continue
          rootFiles.push(fullPath)
        }
      } catch { /* ignore */ }

      onBatch({ files: rootFiles, phase: 'loading' })
    } else if (!hasGitDir(cwd)) {
      // Non-git repo: fallback to sync tree (already fast for small dirs)
      onBatch({ files: flattenTree(readDirTree(cwd)), phase: 'done' })
      return
    }

    if (cancelled) return

    // Phase 2: discover nested git repos
    const knownTopDirs = new Set<string>()
    for (const rel of relPaths) {
      const slash = rel.indexOf('/')
      if (slash !== -1) knownTopDirs.add(rel.substring(0, slash))
    }

    try {
      const entries = fs.readdirSync(cwd, { withFileTypes: true })
      for (const entry of entries) {
        if (cancelled) return
        if (IGNORED.has(entry.name) || entry.name === '.DS_Store') continue

        const fullPath = pathModule.join(cwd, entry.name)
        if (!isDirOrLinkToDirSync(entry, fullPath)) continue

        // Skip dirs already covered by root git ls-files (they have files under them)
        if (knownTopDirs.has(entry.name)) {
          // Unless it's a bare submodule entry (listed as single name, is a dir)
          if (!relPaths.includes(entry.name)) continue
        }

        if (!hasGitDir(fullPath)) continue

        // Nested git repo — scan it (respects its own .gitignore)
        const nestedRel = await gitLsFilesAsync(fullPath)
        if (cancelled) return

        if (nestedRel.length > 0) {
          const nestedFiles = nestedRel
            .filter(f => {
              if (f.includes('/')) return true
              try { return !fs.statSync(pathModule.join(fullPath, f)).isDirectory() }
              catch { return true }
            })
            .map(f => pathModule.resolve(fullPath, f))

          onBatch({ files: nestedFiles, phase: 'nested', nestedRepo: entry.name })
        }
      }
    } catch { /* permission error */ }

    if (!cancelled) {
      onBatch({ files: [], phase: 'done' })
    }
  })()

  return () => { cancelled = true }
}

// ── Recursive tree (fallback for non-git repos) ────────────────

export function readDirTree(dirPath: string, depth = 0): FileNode[] {
  if (depth > 30) return []
  try {
    const rawEntries = fs.readdirSync(dirPath, { withFileTypes: true })
    const enriched = rawEntries
      .filter(e => !IGNORED.has(e.name) && e.name !== '.DS_Store')
      .map(entry => {
        const fullPath = pathModule.join(dirPath, entry.name)
        return { entry, fullPath, isDir: isDirOrLinkToDirSync(entry, fullPath) }
      })
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
        return a.entry.name.localeCompare(b.entry.name)
      })

    const nodes: FileNode[] = []
    for (const { entry, fullPath, isDir } of enriched) {
      if (isDir) {
        nodes.push({
          id: fullPath,
          name: entry.name,
          isFolder: true,
          children: readDirTree(fullPath, depth + 1),
        })
      } else {
        nodes.push({
          id: fullPath,
          name: entry.name,
          isFolder: false,
        })
      }
    }
    return nodes
  } catch {
    return []
  }
}

// ── Async tree builder (non-blocking) ─────────────────────────
//
// Fully async version of buildTreeFromGitFiles that never blocks the
// renderer thread. Uses execFile (callback-based, async) and fs.promises
// instead of their sync counterparts.

async function readDirTreeAsync(dirPath: string, depth = 0): Promise<FileNode[]> {
  if (depth > 30) return []
  try {
    const rawEntries = await fsPromises.readdir(dirPath, { withFileTypes: true })
    const filtered = rawEntries.filter(e => !IGNORED.has(e.name) && e.name !== '.DS_Store')
    const enriched = await Promise.all(filtered.map(async entry => {
      const fullPath = pathModule.join(dirPath, entry.name)
      return { entry, fullPath, isDir: await isDirOrLinkToDirAsync(entry, fullPath) }
    }))
    enriched.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.entry.name.localeCompare(b.entry.name)
    })

    const nodes: FileNode[] = []
    for (const { entry, fullPath, isDir } of enriched) {
      if (isDir) {
        nodes.push({
          id: fullPath,
          name: entry.name,
          isFolder: true,
          children: await readDirTreeAsync(fullPath, depth + 1),
        })
      } else {
        nodes.push({
          id: fullPath,
          name: entry.name,
          isFolder: false,
        })
      }
    }
    return nodes
  } catch {
    return []
  }
}

async function buildTreeFromGitFilesAsync(cwd: string): Promise<FileNode[]> {
  // Phase 1: get git file list asynchronously
  const relPaths = hasGitDir(cwd) ? await gitLsFilesAsync(cwd) : []

  if (relPaths.length === 0 && !hasGitDir(cwd)) {
    return readDirTreeAsync(cwd)
  }

  // Phase 2: build tree structure from paths (CPU-only, fast)
  const tree = buildTreeFromPaths(cwd, relPaths.length > 0 ? relPaths : [])

  // Phase 3: merge nested repos asynchronously
  await mergeNestedReposAsync(tree, cwd)

  // Update memo cache so subsequent watcher calls can use the sync fast-path
  _lastGitCwd = cwd
  _lastGitOutput = relPaths.join('\n')
  _lastGitTree = tree

  return tree
}

async function mergeNestedReposAsync(tree: FileNode[], dirPath: string): Promise<void> {
  // Populate submodule/nested repo folders that are in the tree but have no children
  for (const node of tree) {
    if (node.isFolder && (!node.children || node.children.length === 0)) {
      const fullPath = pathModule.join(dirPath, node.name)
      if (hasGitDir(fullPath)) {
        const nestedPaths = await gitLsFilesAsync(fullPath)
        if (nestedPaths.length > 0) {
          node.children = buildTreeFromPaths(fullPath, nestedPaths)
        } else {
          node.children = await readDirTreeAsync(fullPath)
        }
      } else {
        node.children = await readDirTreeAsync(fullPath)
      }
    }
  }

  await mergeDiskEntriesAsync(tree, dirPath)
}

async function mergeDiskEntriesAsync(tree: FileNode[], dirPath: string): Promise<void> {
  const gitBuiltFolders = new Set(
    tree.filter(n => n.isFolder).map(n => n.name),
  )
  const knownNames = new Set(tree.map(n => n.name))

  try {
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      if (IGNORED.has(entry.name) || entry.name === '.DS_Store') continue
      if (knownNames.has(entry.name)) continue

      const fullPath = pathModule.join(dirPath, entry.name)

      if (await isDirOrLinkToDirAsync(entry, fullPath)) {
        let children: FileNode[]
        if (hasGitDir(fullPath)) {
          const nestedPaths = await gitLsFilesAsync(fullPath)
          children = nestedPaths.length > 0
            ? buildTreeFromPaths(fullPath, nestedPaths)
            : await readDirTreeAsync(fullPath)
        } else {
          children = await readDirTreeAsync(fullPath)
        }
        tree.push({
          id: fullPath,
          name: entry.name,
          isFolder: true,
          children,
        })
      } else {
        tree.push({
          id: fullPath,
          name: entry.name,
          isFolder: false,
        })
      }
    }
  } catch { /* permission error */ }

  // Recurse into git-built folders
  for (const node of tree) {
    if (node.isFolder && node.children && gitBuiltFolders.has(node.name)) {
      const fullPath = pathModule.join(dirPath, node.name)
      await mergeDiskEntriesAsync(node.children, fullPath)
    }
  }

  // Re-sort: folders first, then alphabetical
  tree.sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

/**
 * Async version of buildTreeFromGitFiles for use on app init.
 * Never blocks the renderer thread — uses async git + fs operations.
 * Falls back to async readDirTree for non-git repos.
 */
export { buildTreeFromGitFilesAsync }

/**
 * Read a single directory's entries (shallow, non-recursive) asynchronously.
 * Returns FileNode[] for the immediate children only — folders have empty children arrays.
 * Used by per-folder watchers to update expanded folders without blocking the UI.
 */
export async function readDirShallowAsync(dirPath: string): Promise<FileNode[]> {
  try {
    const rawEntries = await fsPromises.readdir(dirPath, { withFileTypes: true })
    const filtered = rawEntries.filter(e => !IGNORED.has(e.name) && e.name !== '.DS_Store')
    const enriched = await Promise.all(filtered.map(async entry => {
      const fullPath = pathModule.join(dirPath, entry.name)
      return { entry, fullPath, isDir: await isDirOrLinkToDirAsync(entry, fullPath) }
    }))
    enriched.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.entry.name.localeCompare(b.entry.name)
    })

    const nodes: FileNode[] = []
    for (const { entry, fullPath, isDir } of enriched) {
      if (isDir) {
        nodes.push({ id: fullPath, name: entry.name, isFolder: true, children: [] })
      } else {
        nodes.push({ id: fullPath, name: entry.name, isFolder: false })
      }
    }
    return nodes
  } catch {
    return []
  }
}
