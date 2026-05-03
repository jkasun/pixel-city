import { isGitRepo } from './gitClient'

const fs = window.require('fs') as typeof import('fs')
const pathModule = window.require('path') as typeof import('path')

export interface DiscoveredRepo {
  name: string
  path: string
  source: 'auto'
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.worktrees',
  '.pixelcity', '.claude', 'out', '.next', '__pycache__',
])

/** Synchronously scan projectCwd for nested git repos (1-2 levels deep). */
export function discoverRepos(projectCwd: string): DiscoveredRepo[] {
  const repos: DiscoveredRepo[] = []
  const seen = new Set<string>()

  const addRepo = (absPath: string, source: 'auto', label?: string) => {
    const resolved = pathModule.resolve(absPath)
    if (seen.has(resolved)) return
    seen.add(resolved)
    repos.push({ name: label || pathModule.basename(resolved), path: resolved, source })
  }

  // Check project root
  if (isGitRepo(projectCwd)) {
    addRepo(projectCwd, 'auto')
  }

  // Scan children (level 1) and grandchildren (level 2)
  try {
    const children = fs.readdirSync(projectCwd, { withFileTypes: true })
    for (const child of children) {
      if (!child.isDirectory() || SKIP_DIRS.has(child.name) || child.name.startsWith('.')) continue
      const childPath = pathModule.join(projectCwd, child.name)

      if (fs.existsSync(pathModule.join(childPath, '.git'))) {
        addRepo(childPath, 'auto')
        continue // don't scan deeper if this is already a repo
      }

      // Level 2
      try {
        const grandchildren = fs.readdirSync(childPath, { withFileTypes: true })
        for (const gc of grandchildren) {
          if (!gc.isDirectory() || SKIP_DIRS.has(gc.name) || gc.name.startsWith('.')) continue
          const gcPath = pathModule.join(childPath, gc.name)
          if (fs.existsSync(pathModule.join(gcPath, '.git'))) {
            addRepo(gcPath, 'auto')
          }
        }
      } catch { /* permission errors etc */ }
    }
  } catch { /* permission errors etc */ }

  return repos
}

/** Async wrapper around discoverRepos. Kept for adapter compatibility. */
export async function discoverReposWithAssets(projectCwd: string): Promise<DiscoveredRepo[]> {
  return discoverRepos(projectCwd)
}
