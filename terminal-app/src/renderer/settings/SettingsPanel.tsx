import React, { useRef, useEffect } from 'react'
import type { TerminalSettings } from './settingsManager.js'
import { DEFAULT_SETTINGS, FONT_OPTIONS } from './settingsManager.js'

// ── Settings Panel ───────────────────────────────────────────────

export interface SettingsPanelProps {
  settings: TerminalSettings
  onChange: (s: TerminalSettings) => void
  onClose: () => void
  anchorRef: React.RefObject<HTMLButtonElement | null>
}

export function SettingsPanel({ settings, onChange, onClose, anchorRef }: SettingsPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose, anchorRef])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const set = <K extends keyof TerminalSettings>(key: K, val: TerminalSettings[K]) =>
    onChange({ ...settings, [key]: val })

  const lineHeightOptions = [1.0, 1.2, 1.4, 1.6, 1.8, 2.0]

  // Shared select styles (appearance-none + custom chevron bg)
  const selectCls = [
    'flex-1 bg-bg border border-border text-text font-ui text-[11px]',
    'py-[3px] px-[6px] pr-[22px] cursor-pointer appearance-none',
    'focus:outline-none focus:border-accent-dim',
    '[background-image:url("data:image/svg+xml,%3Csvg%20xmlns%3D\'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg\'%20width%3D\'10\'%20height%3D\'6\'%20viewBox%3D\'0%200%2010%206\'%3E%3Cpath%20d%3D\'M0%200l5%206%205-6z\'%20fill%3D\'%237a7874\'%2F%3E%3C%2Fsvg%3E")]',
    '[background-repeat:no-repeat] [background-position:right_8px_center]',
  ].join(' ')

  return (
    <div
      ref={panelRef}
      className="absolute bottom-full left-0 z-100 w-[280px] bg-bg-card border border-border border-t-0 font-ui text-[11px] text-text shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border text-text-muted tracking-[0.06em] uppercase text-[10px]">
        <span>Terminal Settings</span>
        <button
          className="bg-transparent border-none text-text-dim cursor-pointer font-[inherit] text-[11px] px-0.5 leading-none hover:text-text"
          onClick={onClose}
        >✕</button>
      </div>

      {/* Body */}
      <div className="py-2">
        {/* Font Family */}
        <div className="flex items-center px-3 py-[5px] gap-[10px] min-h-[30px]">
          <label className="w-20 shrink-0 text-text-muted text-[11px] tracking-[0.02em]">Font</label>
          <select
            className={selectCls}
            value={settings.fontFamily}
            onChange={e => set('fontFamily', e.target.value)}
          >
            {FONT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Font Size */}
        <div className="flex items-center px-3 py-[5px] gap-[10px] min-h-[30px]">
          <label className="w-20 shrink-0 text-text-muted text-[11px] tracking-[0.02em]">Size</label>
          <div className="flex items-center border border-border">
            <button
              className="w-[26px] h-[24px] bg-bg border-none text-text-muted font-ui text-[14px] cursor-pointer flex items-center justify-center shrink-0 leading-none hover:not-disabled:text-text hover:not-disabled:bg-bg-hover disabled:opacity-30 disabled:cursor-default"
              onClick={() => set('fontSize', Math.max(8, settings.fontSize - 1))}
              disabled={settings.fontSize <= 8}
            >−</button>
            <span className="w-8 text-center text-text-bright border-l border-r border-border py-[3px] bg-bg-card text-[12px]">
              {settings.fontSize}
            </span>
            <button
              className="w-[26px] h-[24px] bg-bg border-none text-text-muted font-ui text-[14px] cursor-pointer flex items-center justify-center shrink-0 leading-none hover:not-disabled:text-text hover:not-disabled:bg-bg-hover disabled:opacity-30 disabled:cursor-default"
              onClick={() => set('fontSize', Math.min(28, settings.fontSize + 1))}
              disabled={settings.fontSize >= 28}
            >+</button>
          </div>
        </div>

        {/* Line Height */}
        <div className="flex items-center px-3 py-[5px] gap-[10px] min-h-[30px]">
          <label className="w-20 shrink-0 text-text-muted text-[11px] tracking-[0.02em]">Line height</label>
          <div className="flex border border-border">
            {lineHeightOptions.map(h => (
              <button
                key={h}
                className={[
                  'py-[3px] px-2 border-none border-r border-border font-ui text-[10px] cursor-pointer whitespace-nowrap tracking-[0.02em]',
                  'last:border-r-0',
                  settings.lineHeight === h
                    ? 'bg-[rgba(92,154,125,0.15)] text-accent'
                    : 'bg-bg text-text-muted hover:text-text hover:bg-bg-hover',
                ].join(' ')}
                onClick={() => set('lineHeight', h)}
              >{h.toFixed(1)}</button>
            ))}
          </div>
        </div>

        {/* Cursor Style */}
        <div className="flex items-center px-3 py-[5px] gap-[10px] min-h-[30px]">
          <label className="w-20 shrink-0 text-text-muted text-[11px] tracking-[0.02em]">Cursor</label>
          <div className="flex border border-border">
            {(['bar', 'block', 'underline'] as const).map(style => (
              <button
                key={style}
                className={[
                  'py-[3px] px-2 border-none border-r border-border font-ui text-[10px] cursor-pointer whitespace-nowrap tracking-[0.02em]',
                  'last:border-r-0',
                  settings.cursorStyle === style
                    ? 'bg-[rgba(92,154,125,0.15)] text-accent'
                    : 'bg-bg text-text-muted hover:text-text hover:bg-bg-hover',
                ].join(' ')}
                onClick={() => set('cursorStyle', style)}
              >{style}</button>
            ))}
          </div>
        </div>

        {/* Cursor Blink */}
        <div className="flex items-center px-3 py-[5px] gap-[10px] min-h-[30px]">
          <label className="w-20 shrink-0 text-text-muted text-[11px] tracking-[0.02em]">Blink</label>
          <button
            className={[
              'w-[34px] h-[18px] border rounded-[9px] p-0 cursor-pointer relative shrink-0 transition-[background,border-color] duration-150',
              settings.cursorBlink
                ? 'bg-[rgba(92,154,125,0.25)] border-accent-dim'
                : 'bg-bg border-border',
            ].join(' ')}
            onClick={() => set('cursorBlink', !settings.cursorBlink)}
          >
            <span
              className={[
                'absolute top-0.5 left-0.5 w-3 h-3 rounded-full block transition-[transform,background] duration-150',
                settings.cursorBlink ? 'translate-x-4 bg-accent' : 'bg-text-dim',
              ].join(' ')}
            />
          </button>
        </div>

        {/* Scrollback */}
        <div className="flex items-center px-3 py-[5px] gap-[10px] min-h-[30px]">
          <label className="w-20 shrink-0 text-text-muted text-[11px] tracking-[0.02em]">Scrollback</label>
          <select
            className={selectCls.replace('flex-1', 'flex-[0_0_80px]')}
            value={settings.scrollback}
            onChange={e => set('scrollback', Number(e.target.value))}
          >
            {[1000, 2000, 5000, 10000, 20000].map(n => (
              <option key={n} value={n}>{n.toLocaleString()}</option>
            ))}
          </select>
        </div>

        {/* Reset */}
        <div className="flex items-center px-3 py-[5px] gap-[10px] min-h-[30px] border-t border-border mt-1 pt-[9px]">
          <button
            className="bg-transparent border border-border text-text-dim font-ui text-[10px] py-1 px-[10px] cursor-pointer tracking-[0.02em] transition-[color,border-color] duration-[120ms] hover:text-text hover:border-text-dim"
            onClick={() => onChange(DEFAULT_SETTINGS)}
          >
            Reset to defaults
          </button>
        </div>
      </div>
    </div>
  )
}
