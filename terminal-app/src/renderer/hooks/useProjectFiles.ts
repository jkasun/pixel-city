// ── Hook: shared project file index ─────────────────────────────
// Lazily loads project files via listFilesProgressive and caches them.
// Used by both QuickMenu (Cmd+P) and @-mention file autocomplete.
// Also derives unique folder paths from the file list.

import { useState, useEffect, useRef, useMemo } from 'react'
import { listFilesProgressive, type FileSearchPhase } from '../files/fileTreeBuilder.js'

const pathModule = window.require('path') as typeof import('path')

export interface UseProjectFilesReturn {
  /** Absolute file paths */
  filePaths: string[]
  /** Unique absolute folder paths (derived from files) */
  folderPaths: string[]
  /** Current loading phase */
  searchPhase: FileSearchPhase
  /** Name of nested repo currently being scanned */
  nestedRepoName: string | undefined
  /** Call to trigger loading (idempotent if already loaded for this cwd) */
  ensureLoaded: () => void
}

export function useProjectFiles(projectCwd: string | null): UseProjectFilesReturn {
  const [filePaths, setFilePaths] = useState<string[]>([])
  const [searchPhase, setSearchPhase] = useState<FileSearchPhase>('done')
  const [nestedRepoName, setNestedRepoName] = useState<string | undefined>()
  const loadedCwdRef = useRef<string | null>(null)
  const loadingRef = useRef(false)
  const cancelRef = useRef<(() => void) | null>(null)

  // Reset when cwd changes
  useEffect(() => {
    if (projectCwd !== loadedCwdRef.current) {
      setFilePaths([])
      loadedCwdRef.current = null
      loadingRef.current = false
      cancelRef.current?.()
      cancelRef.current = null
    }
  }, [projectCwd])

  // Cleanup on unmount
  useEffect(() => {
    return () => { cancelRef.current?.() }
  }, [])

  const ensureLoaded = () => {
    if (!projectCwd) return
    if (loadedCwdRef.current === projectCwd) return
    if (loadingRef.current) return

    loadingRef.current = true
    setFilePaths([])
    setSearchPhase('loading')
    setNestedRepoName(undefined)

    cancelRef.current = listFilesProgressive(projectCwd, ({ files, phase, nestedRepo }) => {
      if (files.length > 0) {
        setFilePaths(prev => [...prev, ...files])
      }
      setSearchPhase(phase)
      setNestedRepoName(nestedRepo)
      if (phase === 'done') {
        loadedCwdRef.current = projectCwd
        loadingRef.current = false
      }
    })
  }

  // Derive unique folder paths from file paths
  const folderPaths = useMemo(() => {
    if (!projectCwd || filePaths.length === 0) return []
    const folderSet = new Set<string>()
    for (const fp of filePaths) {
      let dir = pathModule.dirname(fp)
      // Walk up to projectCwd, collecting all intermediate dirs
      while (dir.length > projectCwd.length) {
        if (folderSet.has(dir)) break // already visited this branch
        folderSet.add(dir)
        dir = pathModule.dirname(dir)
      }
    }
    const sorted = [...folderSet]
    sorted.sort((a, b) => a.localeCompare(b))
    return sorted
  }, [filePaths, projectCwd])

  return { filePaths, folderPaths, searchPhase, nestedRepoName, ensureLoaded }
}
