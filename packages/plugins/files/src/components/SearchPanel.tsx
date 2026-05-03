import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { FileIcon } from './FileTreePanel.js'
import { RefreshAltIcon, SearchLargeIcon } from '../icons.js'
import { getFilesAdapter } from '../adapter/index.js'
import type { SearchResult, SearchFileResult, SearchMatch } from '../types.js'
import * as path from '../path.js'

// ── Toggle button ───────────────────────────────────────────────

function ToggleBtn({ active, title, onClick, children }: {
  active: boolean; title: string; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      className={`flex items-center justify-center w-[26px] h-[22px] rounded-[3px] border text-[11px] font-mono cursor-pointer transition-all duration-100 shrink-0
        ${active
          ? 'bg-accent/20 border-accent/50 text-accent'
          : 'bg-transparent border-transparent text-text-dim hover:text-text hover:bg-bg-hover'
        }`}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

// ── Search input row ────────────────────────────────────────────

interface SearchInputProps {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  placeholder: string
  inputRef?: React.RefObject<HTMLInputElement | null>
  children?: React.ReactNode
}

function SearchInput({ value, onChange, onSubmit, placeholder, inputRef, children }: SearchInputProps) {
  const testId = placeholder === 'Search' ? 'files-search-input' : placeholder === 'Replace' ? 'files-search-replace-input' : undefined
  return (
    <div className="flex items-center gap-1 px-2 h-[28px] bg-bg border border-border rounded-[4px] focus-within:border-accent/60 transition-colors duration-100">
      <input
        ref={inputRef}
        data-testid={testId}
        className="flex-1 min-w-0 bg-transparent border-none outline-none text-text text-[12px] font-ui placeholder:text-text-dim/50"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') onSubmit() }}
        placeholder={placeholder}
        spellCheck={false}
      />
      {children}
    </div>
  )
}

// ── Match line component ────────────────────────────────────────

function MatchLine({ match, onClick, onReplace, showReplace, replaceValue }: {
  match: SearchMatch
  onClick: () => void
  onReplace?: () => void
  showReplace: boolean
  replaceValue: string
}) {
  return (
    <div
      className="group flex items-center gap-1 px-2 pl-8 h-[22px] cursor-pointer text-[11px] font-ui text-text-dim hover:bg-bg-hover transition-colors duration-75 select-none"
      onClick={onClick}
    >
      <span className="text-text-dim/50 w-[32px] text-right shrink-0 text-[10px] tabular-nums">{match.line}</span>
      <span className="flex-1 min-w-0 overflow-hidden whitespace-nowrap text-ellipsis">
        <span className="text-text-dim">{match.beforeText}</span>
        <span className="bg-[#c08a4040] text-[#ffcc66] rounded-[2px] px-[1px]">{match.matchText}</span>
        <span className="text-text-dim">{match.afterText}</span>
      </span>
      {showReplace && onReplace && (
        <button
          className="hidden group-hover:flex items-center justify-center w-[18px] h-[16px] rounded-[2px] text-[10px] text-text-dim hover:text-text hover:bg-bg-hover shrink-0"
          title="Replace"
          onClick={(e) => { e.stopPropagation(); onReplace() }}
        >
          ↻
        </button>
      )}
    </div>
  )
}

// ── File group component ────────────────────────────────────────

function FileGroup({ file, collapsed, onToggle, onMatchClick, onReplace, onReplaceAll, showReplace, replaceValue }: {
  file: SearchFileResult
  collapsed: boolean
  onToggle: () => void
  onMatchClick: (match: SearchMatch) => void
  onReplace: (match: SearchMatch) => void
  onReplaceAll: () => void
  showReplace: boolean
  replaceValue: string
}) {
  const name = path.basename(file.filePath)
  const dir = path.dirname(file.relativePath)

  return (
    <div>
      <div
        className="group flex items-center gap-1 px-2 h-[24px] cursor-pointer text-[12px] font-ui text-text hover:bg-bg-hover transition-colors duration-75 select-none sticky top-0 bg-bg-card z-[1]"
        onClick={onToggle}
      >
        <span className="w-3 text-[10px] text-text-dim shrink-0 text-center">{collapsed ? '▸' : '▾'}</span>
        <span className="shrink-0 w-[16px] h-[16px] flex items-center justify-center">
          <FileIcon name={name} isFolder={false} />
        </span>
        <span className="whitespace-nowrap overflow-hidden text-ellipsis font-medium">{name}</span>
        {dir && dir !== '.' && (
          <span className="text-text-dim/50 text-[10px] whitespace-nowrap overflow-hidden text-ellipsis">{dir}</span>
        )}
        <span className="ml-auto text-[10px] text-text-dim/50 bg-bg-hover rounded-full px-[6px] py-[1px] shrink-0">{file.matches.length}</span>
        {showReplace && (
          <button
            className="hidden group-hover:flex items-center justify-center w-[18px] h-[16px] rounded-[2px] text-[10px] text-text-dim hover:text-text hover:bg-accent/15 shrink-0"
            title="Replace All in File"
            onClick={(e) => { e.stopPropagation(); onReplaceAll() }}
          >
            ⟲
          </button>
        )}
      </div>
      {!collapsed && file.matches.map((m, i) => (
        <MatchLine
          key={`${m.line}:${m.column}:${i}`}
          match={m}
          onClick={() => onMatchClick(m)}
          onReplace={() => onReplace(m)}
          showReplace={showReplace}
          replaceValue={replaceValue}
        />
      ))}
    </div>
  )
}

// ── Main SearchPanel ────────────────────────────────────────────

export interface SearchPanelProps {
  projectCwd: string
  width: number
  onOpenFile: (filePath: string, line?: number, column?: number) => void
  onRefreshTree: () => void
}

export function SearchPanel({ projectCwd, width, onOpenFile, onRefreshTree }: SearchPanelProps) {
  const adapter = getFilesAdapter()
  const [query, setQuery] = useState('')
  const [replaceValue, setReplaceValue] = useState('')
  const [showReplace, setShowReplace] = useState(false)
  const [isRegex, setIsRegex] = useState(false)
  const [isCaseSensitive, setIsCaseSensitive] = useState(false)
  const [isWholeWord, setIsWholeWord] = useState(false)
  const [includeGlob, setIncludeGlob] = useState('')
  const [excludeGlob, setExcludeGlob] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [searching, setSearching] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const doSearch = useCallback(() => {
    if (!query.trim() || !adapter.search) {
      setResult(null)
      return
    }
    setSearching(true)
    adapter.search({
      query: query.trim(),
      cwd: projectCwd,
      isRegex,
      isCaseSensitive,
      isWholeWord,
      includeGlob: includeGlob.trim() || undefined,
      excludeGlob: excludeGlob.trim() || undefined,
    }).then(r => {
      setResult(r)
      setSearching(false)
    }).catch(() => {
      setSearching(false)
    })
  }, [query, projectCwd, isRegex, isCaseSensitive, isWholeWord, includeGlob, excludeGlob, adapter])

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (!query.trim()) {
      setResult(null)
      return
    }
    searchTimerRef.current = setTimeout(doSearch, 300)
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current) }
  }, [query, isRegex, isCaseSensitive, isWholeWord, includeGlob, excludeGlob, doSearch])

  useEffect(() => {
    searchInputRef.current?.focus()
  }, [])

  const toggleCollapsed = useCallback((filePath: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(filePath)) next.delete(filePath)
      else next.add(filePath)
      return next
    })
  }, [])

  const collapseAll = useCallback(() => {
    if (!result) return
    setCollapsed(new Set(result.files.map(f => f.filePath)))
  }, [result])

  const expandAll = useCallback(() => {
    setCollapsed(new Set())
  }, [])

  const handleMatchClick = useCallback((filePath: string, match: SearchMatch) => {
    onOpenFile(filePath, match.line, match.column)
  }, [onOpenFile])

  // Replace operations — use adapter.writeFile to replace content
  const handleReplaceSingle = useCallback(async (file: SearchFileResult, match: SearchMatch) => {
    try {
      const { content } = await adapter.readFile(file.filePath)
      const lines = content.split('\n')
      const lineIdx = match.line - 1
      if (lineIdx < 0 || lineIdx >= lines.length) return
      const lineText = lines[lineIdx]
      const colIdx = match.column - 1
      lines[lineIdx] = lineText.substring(0, colIdx) + replaceValue + lineText.substring(colIdx + match.length)
      await adapter.writeFile(file.filePath, lines.join('\n'))
      doSearch()
      onRefreshTree()
    } catch { /* ignore */ }
  }, [replaceValue, doSearch, onRefreshTree, adapter])

  const handleReplaceAllInFile = useCallback(async (file: SearchFileResult) => {
    try {
      const { content } = await adapter.readFile(file.filePath)
      let pattern = isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (isWholeWord) pattern = `\\b${pattern}\\b`
      const flags = isCaseSensitive ? 'g' : 'gi'
      const re = new RegExp(pattern, flags)
      let count = 0
      const newContent = content.replace(re, () => { count++; return replaceValue })
      if (count > 0) {
        await adapter.writeFile(file.filePath, newContent)
        doSearch()
        onRefreshTree()
      }
    } catch { /* ignore */ }
  }, [query, replaceValue, isRegex, isCaseSensitive, isWholeWord, doSearch, onRefreshTree, adapter])

  const handleReplaceAll = useCallback(async () => {
    if (!result) return
    for (const file of result.files) {
      await handleReplaceAllInFile(file)
    }
  }, [result, handleReplaceAllInFile])

  const summaryText = useMemo(() => {
    if (searching) return 'Searching...'
    if (!result) return ''
    if (result.totalMatches === 0) return 'No results found'
    const fileCount = result.files.length
    const matchCount = result.totalMatches
    return `${matchCount.toLocaleString()} result${matchCount !== 1 ? 's' : ''} in ${fileCount.toLocaleString()} file${fileCount !== 1 ? 's' : ''}${result.truncated ? ' (results truncated)' : ''}`
  }, [result, searching])

  const searchSupported = !!adapter.search

  return (
    <div data-testid="files-search" className="files-sidebar flex flex-col min-w-[140px] max-w-[500px] bg-bg-card border-r border-border overflow-hidden" style={{ width }}>
      <div className="flex items-center justify-between px-3 h-[30px] shrink-0 border-b border-border">
        <span className="text-[10px] font-semibold tracking-[0.1em] text-text-dim font-ui">SEARCH</span>
        <div className="flex items-center gap-[2px]">
          {result && result.files.length > 0 && (
            <>
              <button
                className="bg-none border-none cursor-pointer text-text-dim p-[2px] flex items-center rounded-[3px] transition-[color,background] duration-[120ms] hover:text-text hover:bg-bg-hover text-[11px]"
                onClick={expandAll}
                title="Expand All"
              >⊞</button>
              <button
                className="bg-none border-none cursor-pointer text-text-dim p-[2px] flex items-center rounded-[3px] transition-[color,background] duration-[120ms] hover:text-text hover:bg-bg-hover text-[11px]"
                onClick={collapseAll}
                title="Collapse All"
              >⊟</button>
            </>
          )}
          <button
            className="bg-none border-none cursor-pointer text-text-dim p-[2px] flex items-center rounded-[3px] transition-[color,background] duration-[120ms] hover:text-text hover:bg-bg-hover"
            onClick={doSearch}
            title="Refresh Search"
          >
            <RefreshAltIcon />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-[6px] p-2 border-b border-border">
        <div className="flex items-start gap-1">
          <button
            className={`mt-[4px] flex items-center justify-center w-[18px] h-[18px] rounded-[3px] text-[10px] shrink-0 cursor-pointer transition-all duration-100 border-none
              ${showReplace ? 'text-accent bg-accent/15' : 'text-text-dim/50 bg-transparent hover:text-text-dim'}`}
            onClick={() => setShowReplace(!showReplace)}
            title="Toggle Replace"
          >
            ▸
          </button>
          <div className="flex-1 flex flex-col gap-[6px]">
            <SearchInput
              value={query}
              onChange={setQuery}
              onSubmit={doSearch}
              placeholder="Search"
              inputRef={searchInputRef}
            >
              <ToggleBtn active={isCaseSensitive} title="Match Case" onClick={() => setIsCaseSensitive(!isCaseSensitive)}>
                Aa
              </ToggleBtn>
              <ToggleBtn active={isWholeWord} title="Match Whole Word" onClick={() => setIsWholeWord(!isWholeWord)}>
                <span className="text-[10px] underline decoration-1">ab</span>
              </ToggleBtn>
              <ToggleBtn active={isRegex} title="Use Regular Expression" onClick={() => setIsRegex(!isRegex)}>
                .*
              </ToggleBtn>
            </SearchInput>

            {showReplace && (
              <div className="flex items-center gap-1">
                <SearchInput
                  value={replaceValue}
                  onChange={setReplaceValue}
                  onSubmit={() => {}}
                  placeholder="Replace"
                />
                <button
                  data-testid="files-search-replace-all"
                  className="flex items-center justify-center w-[24px] h-[24px] rounded-[3px] text-[12px] text-text-dim hover:text-text hover:bg-bg-hover cursor-pointer border-none bg-transparent shrink-0 transition-colors duration-100"
                  title="Replace All"
                  onClick={handleReplaceAll}
                >
                  ⟲
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 px-[2px]">
          <button
            className={`text-[10px] font-ui cursor-pointer border-none bg-transparent transition-colors duration-100 px-1 py-[1px] rounded-[2px]
              ${showFilters ? 'text-accent' : 'text-text-dim/50 hover:text-text-dim'}`}
            onClick={() => setShowFilters(!showFilters)}
          >
            ⋯ filters
          </button>
          {summaryText && (
            <span className="text-[10px] text-text-dim/50 font-ui ml-auto">{summaryText}</span>
          )}
        </div>

        {showFilters && (
          <div className="flex flex-col gap-[4px]">
            <input
              className="px-2 h-[24px] bg-bg border border-border rounded-[4px] outline-none text-text text-[11px] font-ui placeholder:text-text-dim/40 focus:border-accent/60 transition-colors duration-100"
              value={includeGlob}
              onChange={e => setIncludeGlob(e.target.value)}
              placeholder="files to include (e.g. *.ts, src/**)"
              spellCheck={false}
            />
            <input
              className="px-2 h-[24px] bg-bg border border-border rounded-[4px] outline-none text-text text-[11px] font-ui placeholder:text-text-dim/40 focus:border-accent/60 transition-colors duration-100"
              value={excludeGlob}
              onChange={e => setExcludeGlob(e.target.value)}
              placeholder="files to exclude (e.g. *.test.ts)"
              spellCheck={false}
            />
          </div>
        )}
      </div>

      <div data-testid="files-search-results" className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:rounded-[3px]">
        {searching && (
          <div className="h-[2px] w-full bg-border/30 overflow-hidden shrink-0">
            <div className="h-full w-[40%] bg-accent rounded-full animate-[search-loading_1s_ease-in-out_infinite]" />
          </div>
        )}

        {!searchSupported && (
          <div className="flex flex-col items-center justify-center py-8 gap-1 text-text-dim/40">
            <SearchLargeIcon size={32} style={{ opacity: 0.4 }} />
            <span className="text-[11px] font-ui">Search not available</span>
          </div>
        )}

        {searchSupported && !searching && result && result.totalMatches === 0 && query.trim() && (
          <div className="flex flex-col items-center justify-center py-8 gap-1 text-text-dim/40">
            <SearchLargeIcon size={32} style={{ opacity: 0.4 }} />
            <span className="text-[11px] font-ui">No results found</span>
          </div>
        )}

        {searchSupported && !searching && result && result.files.map(file => (
          <FileGroup
            key={file.filePath}
            file={file}
            collapsed={collapsed.has(file.filePath)}
            onToggle={() => toggleCollapsed(file.filePath)}
            onMatchClick={(m) => handleMatchClick(file.filePath, m)}
            onReplace={(m) => handleReplaceSingle(file, m)}
            onReplaceAll={() => handleReplaceAllInFile(file)}
            showReplace={showReplace}
            replaceValue={replaceValue}
          />
        ))}

        {searchSupported && !searching && !result && !query.trim() && (
          <div className="flex flex-col items-center justify-center py-8 gap-1 text-text-dim/30">
            <SearchLargeIcon size={32} style={{ opacity: 0.3 }} />
            <span className="text-[11px] font-ui">Search across files</span>
            <span className="text-[10px] font-ui text-text-dim/20">Type to search</span>
          </div>
        )}
      </div>
    </div>
  )
}
