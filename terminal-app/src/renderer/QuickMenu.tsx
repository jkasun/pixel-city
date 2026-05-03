import React, { useState, useEffect, useRef, useMemo, useCallback, useDeferredValue } from 'react'
import type { ScoredItem } from './files/fuzzyScorer.js'
import type { FileSearchPhase } from './files/fileTreeBuilder.js'
import { useSearchWorker } from './hooks/useSearchWorker.js'

export interface QuickMenuItem {
  id: string
  label: string
  description?: string
  category: 'agent' | 'shell' | 'view' | 'action' | 'file'
  icon?: React.ReactNode
  onSelect: () => void
}

interface QuickMenuProps {
  open: boolean
  onClose: () => void
  items: QuickMenuItem[]
  searchPhase?: FileSearchPhase
  nestedRepoName?: string
}

const CATEGORY_LABELS: Record<string, string> = {
  agent: 'Agent Sessions',
  shell: 'Terminals',
  view: 'Views',
  action: 'Actions',
  file: 'Files',
}

const CATEGORY_ORDER = ['agent', 'shell', 'view', 'action', 'file']

// ── Match highlighting ──────────────────────────────────────────

function HighlightedText({ text, indices }: { text: string; indices: number[] }) {
  if (!indices.length) return <>{text}</>
  const set = new Set(indices)
  const parts: React.ReactNode[] = []
  let run = ''
  let inMatch = false
  for (let i = 0; i < text.length; i++) {
    const isMatch = set.has(i)
    if (isMatch !== inMatch && run) {
      parts.push(inMatch ? <span key={i} className="text-accent font-semibold">{run}</span> : run)
      run = ''
    }
    run += text[i]
    inMatch = isMatch
  }
  if (run) parts.push(inMatch ? <span key={text.length} className="text-accent font-semibold">{run}</span> : run)
  return <>{parts}</>
}

export function QuickMenu({ open, onClose, items, searchPhase = 'done', nestedRepoName }: QuickMenuProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const mouseActiveRef = useRef(false)
  const queryTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      mouseActiveRef.current = false
      // Clear input value directly (uncontrolled)
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.value = ''
          inputRef.current.focus()
        }
      }, 10)
    }
  }, [open])

  // Uncontrolled input handler — browser renders chars instantly,
  // React state updates on next frame for search
  const handleInput = useCallback(() => {
    const val = inputRef.current?.value ?? ''
    // Micro-debounce: batch rapid keystrokes, update state on next frame
    clearTimeout(queryTimerRef.current)
    queryTimerRef.current = setTimeout(() => {
      setQuery(val)
      setSelectedIndex(0)
    }, 16) // ~1 frame
  }, [])

  // Defer query so result rendering never blocks input
  const deferredQuery = useDeferredValue(query)
  const isSearching = query !== deferredQuery

  // Filter, score, and sort items — offloaded to Web Worker
  const scoredItems = useSearchWorker(items, deferredQuery)

  // Group by category, maintaining order (but when searching, don't group — show flat ranked)
  const grouped = useMemo(() => {
    if (deferredQuery.trim()) {
      if (scoredItems.length === 0) return []
      return [{ category: 'results', items: scoredItems }]
    }
    const groups: Array<{ category: string; items: ScoredItem[] }> = []
    const map = new Map<string, ScoredItem[]>()
    for (const scored of scoredItems) {
      const arr = map.get(scored.item.category) ?? []
      arr.push(scored)
      map.set(scored.item.category, arr)
    }
    for (const cat of CATEGORY_ORDER) {
      const arr = map.get(cat)
      if (arr?.length) groups.push({ category: cat, items: arr })
    }
    return groups
  }, [scoredItems, deferredQuery])

  // Flat list for keyboard navigation
  const flatItems = useMemo(() => grouped.flatMap(g => g.items), [grouped])

  // Reset to first item whenever the filtered list changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [flatItems])

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector('.quick-menu-item.selected') as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const handleSelect = useCallback((scored: ScoredItem) => {
    onClose()
    scored.item.onSelect()
  }, [onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        e.stopPropagation()
        setSelectedIndex(i => Math.min(i + 1, flatItems.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        e.stopPropagation()
        setSelectedIndex(i => Math.max(i - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        e.stopPropagation()
        if (flatItems[selectedIndex]) handleSelect(flatItems[selectedIndex])
        break
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        onClose()
        break
    }
  }, [flatItems, selectedIndex, handleSelect, onClose])

  if (!open) return null

  let flatIdx = 0

  return (
    <div
      data-testid="quick-menu"
      className="fixed inset-0 bg-black/50 z-[9999] flex justify-center pt-[15vh]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-[520px] max-h-[420px] bg-bg-card border border-border rounded-[10px] shadow-[0_16px_48px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.04)] flex flex-col overflow-hidden animate-[quick-menu-in_0.12s_ease-out]">
        <div className="flex items-center px-4 py-3 border-b border-border gap-[10px]">
          <svg className="shrink-0 text-text-dim" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5L14 14" />
          </svg>
          <input
            ref={inputRef}
            data-testid="quick-menu-search"
            className="flex-1 bg-transparent border-none outline-none font-ui text-[13px] text-text-bright caret-accent placeholder:text-text-dim"
            type="text"
            placeholder="Type to search..."
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            autoFocus
          />
        </div>
        <div
          className="flex-1 overflow-y-auto py-1.5 [&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:rounded-[3px]"
          ref={listRef}
          onMouseMove={() => { mouseActiveRef.current = true }}
        >
          {flatItems.length === 0 && query.trim() && (
            <div className="px-4 py-6 text-center text-text-dim text-[12px]">
              {searchPhase !== 'done' || isSearching ? 'Searching...' : 'No matches found'}
            </div>
          )}
          {grouped.map(group => (
            <div key={group.category} className="mb-0.5">
              {!query.trim() && (
                <div className="text-[10px] font-semibold uppercase tracking-[0.5px] text-text-dim px-4 pt-2 pb-1">
                  {CATEGORY_LABELS[group.category] ?? group.category}
                </div>
              )}
              {group.items.map(scored => {
                const idx = flatIdx++
                const isSelected = idx === selectedIndex
                const hasQuery = !!query.trim()
                return (
                  <div
                    key={scored.item.id}
                    className={`quick-menu-item flex items-center gap-[10px] px-4 py-[7px] cursor-pointer transition-[background] duration-[60ms] hover:bg-bg-hover${isSelected ? ' selected' : ''}`}
                    style={isSelected ? { background: 'rgba(92, 154, 125, 0.12)' } : undefined}
                    onMouseEnter={() => { if (mouseActiveRef.current) setSelectedIndex(idx) }}
                    onMouseDown={(e) => { e.preventDefault(); handleSelect(scored) }}
                  >
                    {scored.item.icon && (
                      <span className="shrink-0 flex items-center justify-center w-5 h-5 text-text-muted [&_img]:h-5 [&_img]:w-auto [&_img]:[image-rendering:pixelated] [&_img]:mr-0">
                        {scored.item.icon}
                      </span>
                    )}
                    <span className="text-[12.5px] text-text-bright whitespace-nowrap overflow-hidden text-ellipsis">
                      {hasQuery ? <HighlightedText text={scored.item.label} indices={scored.labelIndices} /> : scored.item.label}
                    </span>
                    {scored.item.description && (
                      <span className="text-[11px] text-text-dim whitespace-nowrap overflow-hidden text-ellipsis shrink min-w-0">
                        {hasQuery ? <HighlightedText text={scored.item.description} indices={scored.descriptionIndices} /> : scored.item.description}
                      </span>
                    )}
                    {!hasQuery && (
                      <span className="ml-auto text-[10px] text-text-dim opacity-60 whitespace-nowrap shrink-0">{CATEGORY_LABELS[scored.item.category]}</span>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
          {searchPhase !== 'done' && (
            <div className="flex items-center justify-center gap-1.5 px-4 py-1.5 text-[10px] text-text-dim border-t border-border/50">
              <span className="inline-block w-[6px] h-[6px] rounded-full bg-accent/50 animate-pulse" />
              <span>
                {searchPhase === 'loading' && 'Indexing files...'}
                {searchPhase === 'nested' && (nestedRepoName
                  ? `Scanning ${nestedRepoName}...`
                  : 'Scanning nested repos...'
                )}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
