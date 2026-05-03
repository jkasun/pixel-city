import React from 'react'
import type { BrowserTab } from './types.js'
import { ArrowLeftIcon, ArrowRightIcon, StopIcon, ReloadIcon, HomeIcon, MinusIcon, ZoomPlusIcon, ConsoleIcon } from '../icons/index.js'

interface BrowserToolbarProps {
  activeTab: BrowserTab
  inputUrl: string
  setInputUrl: (url: string) => void
  goBack: () => void
  goForward: () => void
  reloadActive: () => void
  goHome: () => void
  navigateActive: (url: string) => void
  toggleConsole: () => void
  errorCount: number
  warnCount: number
  zoomLevel: number
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  isRecording?: boolean
}

export function BrowserToolbar({ activeTab, inputUrl, setInputUrl, goBack, goForward, reloadActive, goHome, navigateActive, toggleConsole, errorCount, warnCount, zoomLevel, onZoomIn, onZoomOut, onZoomReset, isRecording }: BrowserToolbarProps) {
  const zoomPercent = Math.round(Math.pow(1.2, zoomLevel * 2) * 100)
  // Shared nav button classes
  const navBtn = 'inline-flex items-center justify-center w-[28px] h-[28px] border-none bg-transparent text-text-dim cursor-pointer rounded-[5px] transition-[background,color] duration-[120ms] ease enabled:hover:bg-bg-hover enabled:hover:text-text disabled:opacity-25 disabled:cursor-default relative'

  return (
    <div className="flex items-center gap-[6px] px-[8px] py-[6px] bg-bg border-b border-border shrink-0" data-testid="browser-toolbar">
      <div className="flex items-center gap-[2px] shrink-0">
        <button className={navBtn} data-testid="browser-back-btn" onClick={goBack} disabled={!activeTab.canGoBack} title="Back">
          <ArrowLeftIcon size={14} />
        </button>
        <button className={navBtn} data-testid="browser-forward-btn" onClick={goForward} disabled={!activeTab.canGoForward} title="Forward">
          <ArrowRightIcon size={14} />
        </button>
        <button className={navBtn} data-testid="browser-reload-btn" onClick={reloadActive} title={activeTab.isLoading ? 'Stop' : 'Reload'}>
          {activeTab.isLoading ? (
            <StopIcon size={14} />
          ) : (
            <ReloadIcon size={14} />
          )}
        </button>
        <button className={navBtn} onClick={goHome} title="Home">
          <HomeIcon size={14} />
        </button>
      </div>
      <form className="flex-1 flex min-w-0" onSubmit={(e) => { e.preventDefault(); navigateActive(inputUrl) }}>
        <input
          className="w-full bg-bg border border-border rounded-[5px] text-text px-[10px] py-[4px] text-[11px] font-mono outline-none transition-[border-color] duration-[120ms] ease focus:border-accent-dim"
          data-testid="browser-url-input"
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          onFocus={(e) => e.target.select()}
          spellCheck={false}
          placeholder="Search Google or enter URL..."
        />
      </form>
      <div className="inline-flex items-center gap-[2px] mx-[2px] bg-[rgba(255,255,255,0.06)] rounded-[4px] px-[2px] shrink-0" title={`${zoomPercent}% — Click to reset`}>
        <button className={`${navBtn} !w-[20px] !h-[20px] !p-0`} onClick={onZoomOut} title="Zoom out (⌘-)">
          <MinusIcon size={12} />
        </button>
        <span className="text-[10px] font-mono text-text-dim min-w-[32px] text-center cursor-pointer select-none hover:text-text" onClick={onZoomReset}>{zoomPercent}%</span>
        <button className={`${navBtn} !w-[20px] !h-[20px] !p-0`} onClick={onZoomIn} title="Zoom in (⌘+)">
          <ZoomPlusIcon size={12} />
        </button>
      </div>
      {isRecording && (
        <div className="inline-flex items-center gap-[4px] px-[8px] py-[2px] rounded-[4px] bg-[rgba(220,38,38,0.15)] shrink-0" title="Recording GIF...">
          <span className="w-[8px] h-[8px] rounded-full bg-[#ef4444] animate-[browser-rec-pulse_1s_ease-in-out_infinite]" />
          <span className="text-[10px] font-semibold text-[#ef4444] tracking-[0.5px]">REC</span>
        </div>
      )}
      <button
        className={`${navBtn}${activeTab.consoleOpen ? ' !text-accent' : ''}`}
        onClick={toggleConsole}
        title="Toggle Console"
      >
        <ConsoleIcon size={14} />
        {errorCount > 0 && <span className="absolute top-[2px] right-[2px] text-[8px] min-w-[12px] h-[12px] leading-[12px] rounded-[6px] text-center font-mono font-bold px-[2px] bg-[#c53b53] text-white">{errorCount}</span>}
        {warnCount > 0 && !errorCount && <span className="absolute top-[2px] right-[2px] text-[8px] min-w-[12px] h-[12px] leading-[12px] rounded-[6px] text-center font-mono font-bold px-[2px] bg-[#c49a3a] text-white">{warnCount}</span>}
      </button>
    </div>
  )
}
