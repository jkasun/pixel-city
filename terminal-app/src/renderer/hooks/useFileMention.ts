// ── Hook: @-mention file & folder autocomplete for chat input ───
// Detects '@' in a textarea, uses the shared project file index,
// and returns fuzzy-matched file + folder results for an inline dropdown.

import { useState, useEffect, useMemo, useCallback } from 'react'
import { fuzzyMatch, fuzzyMatchPath } from '../files/fuzzyScorer.js'
import type { FileSearchPhase } from '../files/fileTreeBuilder.js'
import type { UseProjectFilesReturn } from './useProjectFiles.js'

const pathModule = window.require('path') as typeof import('path')

const MAX_RESULTS = 12

export interface FileMentionResult {
  filePath: string
  relativePath: string
  fileName: string
  isFolder: boolean
  score: number
  indices: number[]
}

export interface UseFileMentionReturn {
  /** Whether the mention dropdown should be visible */
  isOpen: boolean
  /** The query string after '@' */
  mentionQuery: string
  /** Filtered & scored file/folder results */
  results: FileMentionResult[]
  /** Currently selected index in the dropdown */
  selectedIndex: number
  /** Whether files are still loading */
  searchPhase: FileSearchPhase
  /** Call when user selects a file/folder (by click or Enter) */
  selectFile: (result: FileMentionResult) => void
  /** Call on textarea keydown — returns true if the event was consumed */
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean
  /** Call on textarea value change */
  handleInputChange: (value: string, cursorPos: number) => void
  /** Dismiss the dropdown */
  dismiss: () => void
  /** Move selection */
  setSelectedIndex: (idx: number) => void
}

export function useFileMention(
  projectCwd: string | null,
  inputText: string,
  setInputText: (text: string) => void,
  inputRef: React.RefObject<HTMLTextAreaElement | null> | undefined,
  projectFiles?: UseProjectFilesReturn,
): UseFileMentionReturn {
  const [isOpen, setIsOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionStart, setMentionStart] = useState(-1) // index of '@' in inputText
  const [selectedIndex, setSelectedIndex] = useState(0)

  const filePaths = projectFiles?.filePaths ?? []
  const folderPaths = projectFiles?.folderPaths ?? []
  const searchPhase = projectFiles?.searchPhase ?? 'done'
  const ensureLoaded = projectFiles?.ensureLoaded

  // Trigger file loading when mention opens (lazy, idempotent)
  useEffect(() => {
    if (isOpen && ensureLoaded) ensureLoaded()
  }, [isOpen, ensureLoaded])

  // Score and filter results — files + folders combined
  const results = useMemo((): FileMentionResult[] => {
    if (!isOpen || !projectCwd) return []

    const query = mentionQuery.trim()
    const scored: FileMentionResult[] = []

    const hasPathSep = query.includes('/') || query.includes('\\')

    // Helper: score a single entry (file or folder)
    const scoreEntry = (fp: string, isFolder: boolean) => {
      const rel = pathModule.relative(projectCwd!, fp)
      const name = pathModule.basename(fp)

      if (!query) {
        scored.push({ filePath: fp, relativePath: rel, fileName: name, isFolder, score: 0, indices: [] })
        return
      }

      // Try path-aware matching first (when query has path separators)
      if (hasPathSep) {
        const pathMatch = fuzzyMatchPath(query, rel)
        if (pathMatch) {
          scored.push({ filePath: fp, relativePath: rel, fileName: name, isFolder, score: pathMatch.score, indices: pathMatch.indices })
          return
        }
      }

      // Fuzzy match against filename
      const nameMatch = fuzzyMatch(query, name)
      if (nameMatch) {
        // Offset indices to map to the relative path (filename is at the end)
        const nameStart = rel.length - name.length
        const indices = nameMatch.indices.map(i => nameStart + i)
        scored.push({ filePath: fp, relativePath: rel, fileName: name, isFolder, score: nameMatch.score, indices })
        return
      }

      // Fuzzy match against full relative path
      const relMatch = fuzzyMatch(query, rel)
      if (relMatch) {
        scored.push({ filePath: fp, relativePath: rel, fileName: name, isFolder, score: relMatch.score * 0.8, indices: relMatch.indices })
      }
    }

    // Score folders
    for (const fp of folderPaths) scoreEntry(fp, true)

    // Score files
    for (const fp of filePaths) scoreEntry(fp, false)

    if (query) {
      scored.sort((a, b) => b.score - a.score)
    }

    return scored.slice(0, MAX_RESULTS)
  }, [isOpen, projectCwd, mentionQuery, filePaths, folderPaths])

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0)
  }, [results])

  const handleInputChange = useCallback((value: string, cursorPos: number) => {
    // Walk backwards from cursor to find '@'
    let atIdx = -1
    for (let i = cursorPos - 1; i >= 0; i--) {
      const ch = value[i]
      if (ch === '@') {
        // Must be at start of input or preceded by whitespace
        if (i === 0 || /\s/.test(value[i - 1])) {
          atIdx = i
        }
        break
      }
      // Allow path characters (/, ., -, _) in query but stop at other whitespace
      if (/\s/.test(ch)) break
    }

    if (atIdx >= 0) {
      const query = value.slice(atIdx + 1, cursorPos)
      setIsOpen(true)
      setMentionStart(atIdx)
      setMentionQuery(query)
    } else {
      setIsOpen(false)
      setMentionQuery('')
      setMentionStart(-1)
    }
  }, [])

  const selectFile = useCallback((result: FileMentionResult) => {
    if (mentionStart < 0) return
    // Replace @query with @filepath (with a trailing space)
    const before = inputText.slice(0, mentionStart)
    const afterCursor = inputText.slice(mentionStart + 1 + mentionQuery.length)
    const path = result.isFolder ? result.relativePath + '/' : result.relativePath
    const insertion = `@${path} `
    const newText = `${before}${insertion}${afterCursor}`
    setInputText(newText)
    setIsOpen(false)
    setMentionQuery('')
    setMentionStart(-1)

    // Position cursor after the inserted path
    const cursorPos = mentionStart + insertion.length
    setTimeout(() => {
      const el = inputRef?.current
      if (el) {
        el.focus()
        el.setSelectionRange(cursorPos, cursorPos)
      }
    }, 0)
  }, [inputText, mentionStart, mentionQuery, setInputText, inputRef])

  const dismiss = useCallback(() => {
    setIsOpen(false)
    setMentionQuery('')
    setMentionStart(-1)
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!isOpen || results.length === 0) return false

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(i => Math.min(i + 1, results.length - 1))
        return true
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(i => Math.max(i - 1, 0))
        return true
      case 'Enter':
      case 'Tab':
        e.preventDefault()
        if (results[selectedIndex]) {
          selectFile(results[selectedIndex])
        }
        return true
      case 'Escape':
        e.preventDefault()
        dismiss()
        return true
    }
    return false
  }, [isOpen, results, selectedIndex, selectFile, dismiss])

  return {
    isOpen,
    mentionQuery,
    results,
    selectedIndex,
    searchPhase,
    selectFile,
    handleKeyDown,
    handleInputChange,
    dismiss,
    setSelectedIndex,
  }
}
