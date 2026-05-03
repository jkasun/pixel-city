import React, { useEffect, useRef, useState } from 'react'
import type { SearchAddon } from '@xterm/addon-search'
import { SearchIcon, WholeWordIcon, ChevronUpIcon, ChevronDownIcon, CloseIcon } from '../icons/index.js'

interface TerminalSearchBarProps {
  searchAddon: SearchAddon | null
  onClose: () => void
}

export function TerminalSearchBar({ searchAddon, onClose }: TerminalSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [regex, setRegex] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const doSearch = (direction: 'next' | 'prev') => {
    if (!searchAddon || !query) return
    const opts = { caseSensitive, regex, wholeWord }
    if (direction === 'next') {
      searchAddon.findNext(query, opts)
    } else {
      searchAddon.findPrevious(query, opts)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      searchAddon?.clearDecorations()
      onClose()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      doSearch(e.shiftKey ? 'prev' : 'next')
    }
  }

  // Live search as user types
  useEffect(() => {
    if (!searchAddon) return
    if (query) {
      searchAddon.findNext(query, { caseSensitive, regex, wholeWord, incremental: true })
    } else {
      searchAddon.clearDecorations()
    }
  }, [query, caseSensitive, regex, wholeWord, searchAddon])

  return (
    <div className="absolute top-9 right-3 z-20 flex items-center gap-1 px-1.5 py-1 bg-card border border-border rounded-md shadow-[0_4px_16px_rgba(0,0,0,0.35)] animate-[search-bar-slide-in_0.15s_ease-out]">
      <div className="relative flex items-center">
        <SearchIcon className="absolute left-[7px] text-text-dim pointer-events-none" />
        <input
          ref={inputRef}
          className="w-[180px] pl-[26px] pr-2 py-1 text-xs font-mono text-text bg-bg border border-border rounded outline-none transition-[border-color] duration-150 placeholder:text-text-dim focus:border-accent"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search terminal..."
          spellCheck={false}
        />
      </div>

      <div className="flex gap-0.5">
        <button
          className={`flex items-center justify-center w-6 h-6 text-[11px] font-mono font-semibold border rounded cursor-pointer transition-all duration-[0.12s] ${caseSensitive ? 'bg-accent text-bg border-accent' : 'text-text-dim bg-transparent border-transparent hover:bg-bg hover:text-text'}`}
          onClick={() => setCaseSensitive(v => !v)}
          title="Case Sensitive"
        >
          Aa
        </button>
        <button
          className={`flex items-center justify-center w-6 h-6 text-[11px] font-mono font-semibold border rounded cursor-pointer transition-all duration-[0.12s] ${wholeWord ? 'bg-accent text-bg border-accent' : 'text-text-dim bg-transparent border-transparent hover:bg-bg hover:text-text'}`}
          onClick={() => setWholeWord(v => !v)}
          title="Whole Word"
        >
          <WholeWordIcon />
        </button>
        <button
          className={`flex items-center justify-center w-6 h-6 text-[11px] font-mono font-semibold border rounded cursor-pointer transition-all duration-[0.12s] ${regex ? 'bg-accent text-bg border-accent' : 'text-text-dim bg-transparent border-transparent hover:bg-bg hover:text-text'}`}
          onClick={() => setRegex(v => !v)}
          title="Regex"
        >
          .*
        </button>
      </div>

      <div className="flex gap-0.5">
        <button
          className="flex items-center justify-center w-[22px] h-[22px] text-text-dim bg-transparent border-none rounded-[3px] cursor-pointer transition-all duration-[0.12s] hover:bg-bg hover:text-text"
          onClick={() => doSearch('prev')}
          title="Previous Match (Shift+Enter)"
        >
          <ChevronUpIcon />
        </button>
        <button
          className="flex items-center justify-center w-[22px] h-[22px] text-text-dim bg-transparent border-none rounded-[3px] cursor-pointer transition-all duration-[0.12s] hover:bg-bg hover:text-text"
          onClick={() => doSearch('next')}
          title="Next Match (Enter)"
        >
          <ChevronDownIcon />
        </button>
      </div>

      <button
        className="flex items-center justify-center w-[22px] h-[22px] text-text-dim bg-transparent border-none rounded-[3px] cursor-pointer ml-0.5 transition-all duration-[0.12s] hover:bg-bg hover:text-text"
        onClick={() => { searchAddon?.clearDecorations(); onClose() }}
        title="Close (Escape)"
      >
        <CloseIcon />
      </button>
    </div>
  )
}
