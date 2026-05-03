/**
 * StatusBar — thin wrapper around shared @pixel-city/ui StatusBar.
 * Reads from desktop contexts and platform APIs, passes as props.
 */

import React, { useEffect, useState } from 'react'
import { StatusBar as SharedStatusBar } from '@pixel-city/ui'
import { useWorldContext } from './contexts/WorldContext.js'
import { useOfficeContext } from './contexts/OfficeContext.js'
import { projectBasename } from './settings.js'
import { APP_VERSION } from '../version.js'
import { isGitRepo, getBranchInfo, getChangedFiles } from './git/gitClient.js'
import { discoverRepos } from './git/repoDiscovery.js'

function useGitStatus(cwd: string | null) {
  const [info, setInfo] = useState<{ branch: string | null; status: string | null }>({ branch: null, status: null })

  useEffect(() => {
    if (!cwd) {
      setInfo({ branch: null, status: null })
      return
    }

    let cancelled = false
    const resolveRepo = (): string | null => {
      try {
        if (isGitRepo(cwd)) return cwd
        const nested = discoverRepos(cwd)
        return nested[0]?.path ?? null
      } catch { return null }
    }

    const refresh = () => {
      try {
        const repo = resolveRepo()
        if (!repo) {
          if (!cancelled) setInfo({ branch: null, status: null })
          return
        }
        const branch = getBranchInfo(repo).current || null
        const changed = getChangedFiles(repo)
        const uniquePaths = new Set(changed.map(f => f.path))
        const count = uniquePaths.size
        const status = count === 0 ? 'clean' : `${count} uncommitted file${count === 1 ? '' : 's'}`
        if (!cancelled) setInfo({ branch, status })
      } catch {
        if (!cancelled) setInfo({ branch: null, status: null })
      }
    }

    refresh()
    const id = setInterval(refresh, 5000)
    return () => { cancelled = true; clearInterval(id) }
  }, [cwd])

  return info
}

export function StatusBar() {
  const { projectCwd, activeView, setActiveView } = useWorldContext()
  const {
    agentIds, activeAgentId, setActiveAgentId,
    agentPalettes, agentNames, agentStatusMap,
  } = useOfficeContext()

  const appVersion = APP_VERSION
  const { branch: gitBranch, status: gitStatus } = useGitStatus(projectCwd ?? null)

  if (!projectCwd) return null

  return (
    <SharedStatusBar
      projectName={projectBasename(projectCwd)}
      gitBranch={gitBranch}
      gitStatus={gitStatus}
      appVersion={appVersion}
      agentIds={agentIds}
      activeAgentId={activeAgentId}
      agentPalettes={agentPalettes}
      agentNames={agentNames}
      agentStatusMap={agentStatusMap}
      activeView={activeView}
      onSelectAgent={(id) => {
        setActiveAgentId(id)
        setActiveView('agent')
      }}
    />
  )
}
