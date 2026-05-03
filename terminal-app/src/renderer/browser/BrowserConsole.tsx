import React from 'react'
import type { ConsoleEntry, BrowserTab } from './types.js'
import { ClearConsoleIcon } from '../icons/index.js'

interface BrowserConsoleProps {
  activeTab: BrowserTab
  filteredLogs: ConsoleEntry[]
  setConsoleFilter: (filter: ConsoleEntry['level'] | 'all') => void
  clearConsole: () => void
  consoleEndRef: React.RefObject<HTMLDivElement | null>
  height?: number
}

const LEVEL_COLORS: Record<string, string> = {
  log: 'var(--text-dim)',
  info: '#7aa2f7',
  warn: '#c49a3a',
  error: '#c53b53',
  debug: '#9d7cd8',
}

const ENTRY_BG: Record<string, string> = {
  error: 'rgba(197, 59, 83, 0.08)',
  warn: 'rgba(196, 154, 58, 0.08)',
}

export function BrowserConsole({ activeTab, filteredLogs, setConsoleFilter, clearConsole, consoleEndRef, height }: BrowserConsoleProps) {
  const navBtn = 'inline-flex items-center justify-center w-[28px] h-[28px] border-none bg-transparent text-text-dim cursor-pointer rounded-[5px] transition-[background,color] duration-[120ms] ease hover:bg-bg-hover hover:text-text relative'

  return (
    <div className="flex flex-col min-h-[80px] border-t border-border bg-bg shrink-0" data-testid="browser-console" style={height ? { height } : { height: 200 }}>
      <div className="flex items-center gap-[8px] px-[8px] py-[4px] bg-bg border-b border-border shrink-0">
        <span className="text-[10px] tracking-[0.1em] text-text-dim font-semibold uppercase shrink-0">Console</span>
        <div className="flex gap-[2px] flex-1">
          {(['all', 'log', 'warn', 'error', 'info', 'debug'] as const).map(level => (
            <button
              key={level}
              className={`bg-none border-none text-[10px] font-mono px-[6px] py-[1px] rounded-[3px] cursor-pointer capitalize${activeTab.consoleFilter === level ? ' text-text-bright bg-bg-hover' : ' text-text-dim hover:text-text hover:bg-bg-hover'}`}
              onClick={() => setConsoleFilter(level)}
            >
              {level}
            </button>
          ))}
        </div>
        <button className={navBtn} onClick={clearConsole} title="Clear Console">
          <ClearConsoleIcon />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden font-mono text-[11px]">
        {filteredLogs.length === 0 && (
          <div className="p-[12px] text-text-dim italic text-[11px]">No console output</div>
        )}
        {filteredLogs.map((entry, i) => (
          <div
            key={i}
            className="flex items-start gap-[8px] px-[8px] py-[2px] border-b border-border-subtle break-words"
            style={ENTRY_BG[entry.level] ? { background: ENTRY_BG[entry.level] } : undefined}
          >
            <span
              className="shrink-0 text-[9px] font-semibold uppercase tracking-[0.05em] px-[4px] py-[1px] rounded-[2px] mt-[1px]"
              style={{ color: LEVEL_COLORS[entry.level] ?? LEVEL_COLORS.log }}
            >{entry.level}</span>
            <span className="flex-1 text-text whitespace-pre-wrap leading-[1.4]">{entry.message}</span>
            {entry.source && (
              <span className="shrink-0 text-text-dim text-[9px] mt-[2px]">
                {entry.source.split('/').pop()}:{entry.line}
              </span>
            )}
          </div>
        ))}
        <div ref={consoleEndRef} />
      </div>
    </div>
  )
}
