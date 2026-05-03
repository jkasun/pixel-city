import React, { useState, useEffect, useRef, useCallback } from 'react'
import type { TerminalSettings, EditorSettings, ThemeName } from './settings.js'
import { DEFAULT_SETTINGS, DEFAULT_EDITOR_SETTINGS, applyTheme, savePixelCitySettings, loadPixelCitySettings } from './settings.js'
import type { NotificationSettings } from './settings/settingsManager.js'
import {
  DEFAULT_NOTIFICATION_SETTINGS, FONT_OPTIONS,
  NOTIFICATION_COLUMNS,
  loadNotificationSettings, saveNotificationSettings,
} from './settings/settingsManager.js'
import { useWorldContext } from './contexts/WorldContext.js'
import { useOfficeContext } from './contexts/OfficeContext.js'
import { AppearanceIcon, TerminalIcon, EditIcon, BellIcon } from './icons/index.js'

import { platform } from './platform/index.js'

type SettingsTab = 'appearance' | 'terminal' | 'editor' | 'notifications'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { settings, setSettings, editorSettings, setEditorSettings, projectCwdRef } = useWorldContext()
  const { configCacheRef } = useOfficeContext()
  const [tab, setTab] = useState<SettingsTab>('appearance')
  const [theme, setTheme] = useState<ThemeName>(() => loadPixelCitySettings().theme ?? 'dark')
  const [notifSettings, setNotifSettings] = useState<NotificationSettings>(loadNotificationSettings)
  const [permissionMode, setPermissionMode] = useState<'bypass' | 'auto'>('bypass')
  const [globalClaudeConfigDir, setGlobalClaudeConfigDir] = useState<string>('')

  // Load permission mode + claude config from config when modal opens
  useEffect(() => {
    if (!open) return
    setPermissionMode(configCacheRef.current?.permissionMode ?? 'bypass')
    setGlobalClaudeConfigDir(loadPixelCitySettings().claudeConfigDir ?? '')
  }, [open, configCacheRef])
  const overlayRef = useRef<HTMLDivElement>(null)

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Close on overlay click
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose()
  }, [onClose])

  const updateTerminal = useCallback(<K extends keyof TerminalSettings>(key: K, val: TerminalSettings[K]) => {
    setSettings(prev => {
      const next = { ...prev, [key]: val }
      platform().settings.update({ terminalSettings: next })
      return next
    })
  }, [setSettings])

  const updateNotification = useCallback(<K extends keyof NotificationSettings>(key: K, val: NotificationSettings[K]) => {
    const next = { ...notifSettings, [key]: val }
    setNotifSettings(next)
    saveNotificationSettings(next)
  }, [notifSettings])

  const resetTerminal = useCallback(() => {
    setSettings(DEFAULT_SETTINGS)
    platform().settings.update({ terminalSettings: DEFAULT_SETTINGS })
  }, [setSettings])

  const resetNotifications = useCallback(() => {
    setNotifSettings(DEFAULT_NOTIFICATION_SETTINGS)
    saveNotificationSettings(DEFAULT_NOTIFICATION_SETTINGS)
  }, [])

  const updatePermissionMode = useCallback(async (mode: 'bypass' | 'auto') => {
    setPermissionMode(mode)
    if (configCacheRef.current) {
      (configCacheRef.current as any).permissionMode = mode
    }
    const projectDir = projectCwdRef.current
    if (projectDir) {
      try {
        const result = await platform().config.load(projectDir)
        const config = result?.config ?? {}
        await platform().config.save(projectDir, { ...config, permissionMode: mode })
      } catch { /* ignore */ }
    }
  }, [configCacheRef, projectCwdRef])

  const updateGlobalClaudeConfigDir = useCallback((dir: string) => {
    setGlobalClaudeConfigDir(dir)
    savePixelCitySettings({ claudeConfigDir: dir || undefined })
  }, [])

  const updateEditor =useCallback(<K extends keyof EditorSettings>(key: K, val: EditorSettings[K]) => {
    setEditorSettings(prev => {
      const next = { ...prev, [key]: val }
      platform().settings.update({ editorSettings: next })
      return next
    })
  }, [setEditorSettings])

  const resetEditor = useCallback(() => {
    setEditorSettings(DEFAULT_EDITOR_SETTINGS)
    platform().settings.update({ editorSettings: DEFAULT_EDITOR_SETTINGS })
  }, [setEditorSettings])

  const updateTheme = useCallback((newTheme: ThemeName) => {
    setTheme(newTheme)
    applyTheme(newTheme)
    savePixelCitySettings({ theme: newTheme })
    platform().settings.update({ theme: newTheme })
    window.dispatchEvent(new CustomEvent('pixelcity:theme-changed', { detail: { theme: newTheme } }))
  }, [])

  if (!open) return null

  const lineHeightOptions = [1.0, 1.2, 1.4, 1.6, 1.8, 2.0]

  return (
    <div
      data-testid="settings-modal"
      className="fixed inset-0 bg-[rgba(0,0,0,0.5)] flex items-center justify-center z-[200]"
      ref={overlayRef}
      onClick={handleOverlayClick}
    >
      <div data-testid="settings-panel" className="flex w-[520px] max-w-[90vw] h-[380px] max-h-[80vh] bg-bg border border-border rounded-[8px] shadow-[0_8px_32px_rgba(0,0,0,0.5)] overflow-hidden">
        <div className="w-[150px] bg-bg-card border-r border-border p-[10px_6px] flex flex-col gap-[2px] flex-shrink-0">
          <div className="text-[9px] uppercase tracking-[0.08em] text-text-dim p-[3px_8px_8px] font-ui">
            Settings
          </div>
          <button
            data-testid="settings-tab-appearance"
            className={`flex items-center gap-[7px] px-[8px] py-[6px] bg-transparent border-0 font-ui text-[11px] cursor-pointer rounded-[4px] text-left transition-colors ${
              tab === 'appearance'
                ? 'bg-[rgba(92,154,125,0.12)] text-accent'
                : 'text-text-muted hover:bg-bg-hover hover:text-text'
            }`}
            onClick={() => setTab('appearance')}
          >
            <AppearanceIcon size={14} />
            Appearance
          </button>
          <button
            data-testid="settings-tab-terminal"
            className={`flex items-center gap-[7px] px-[8px] py-[6px] bg-transparent border-0 font-ui text-[11px] cursor-pointer rounded-[4px] text-left transition-colors ${
              tab === 'terminal'
                ? 'bg-[rgba(92,154,125,0.12)] text-accent'
                : 'text-text-muted hover:bg-bg-hover hover:text-text'
            }`}
            onClick={() => setTab('terminal')}
          >
            <TerminalIcon />
            Terminal
          </button>
          <button
            data-testid="settings-tab-editor"
            className={`flex items-center gap-[7px] px-[8px] py-[6px] bg-transparent border-0 font-ui text-[11px] cursor-pointer rounded-[4px] text-left transition-colors ${
              tab === 'editor'
                ? 'bg-[rgba(92,154,125,0.12)] text-accent'
                : 'text-text-muted hover:bg-bg-hover hover:text-text'
            }`}
            onClick={() => setTab('editor')}
          >
            <EditIcon />
            Editor
          </button>
          <button
            data-testid="settings-tab-notifications"
            className={`flex items-center gap-[7px] px-[8px] py-[6px] bg-transparent border-0 font-ui text-[11px] cursor-pointer rounded-[4px] text-left transition-colors ${
              tab === 'notifications'
                ? 'bg-[rgba(92,154,125,0.12)] text-accent'
                : 'text-text-muted hover:bg-bg-hover hover:text-text'
            }`}
            onClick={() => setTab('notifications')}
          >
            <BellIcon />
            Notifications
          </button>

        </div>

        <div className="flex-1 p-[14px_18px] overflow-y-auto relative">
          <button
            className="absolute top-[8px] right-[10px] w-[20px] h-[20px] flex items-center justify-center border-0 bg-transparent text-text-dim text-[12px] cursor-pointer rounded-[3px] hover:bg-bg-hover hover:text-text"
            onClick={onClose}
          >
            ✕
          </button>

          {tab === 'appearance' && (
            <div>
              <div className="text-[12px] font-semibold text-text-bright mb-[12px] font-ui">Appearance</div>

              <div className="py-[5px]">
                <label className="text-text-muted text-[11px] tracking-[0.02em] mb-[8px] block">Theme</label>
                <div className="flex gap-[8px] flex-wrap">
                  {(['dark', 'light', 'creme', 'nord', 'monokai'] as const).map(t => {
                    const colors: Record<string, { bg: string; card: string; accent: string; text: string; dim: string }> = {
                      dark:    { bg: '#0a0a0c', card: '#0e0e11', accent: '#5c9a7d', text: '#eae7e0', dim: '#78756f' },
                      light:   { bg: '#f5f5f7', card: '#ffffff', accent: '#3a7a5f', text: '#1d1d1f', dim: '#636366' },
                      creme:   { bg: '#FFF7D0', card: '#FFF9E0', accent: '#c08a40', text: '#3a2e1a', dim: '#7a6a4a' },
                      nord:    { bg: '#2e3440', card: '#3b4252', accent: '#88c0d0', text: '#eceff4', dim: '#8790a0' },
                      monokai: { bg: '#272822', card: '#2d2e27', accent: '#a6e22e', text: '#f9f8f5', dim: '#90908a' },
                    }
                    const c = colors[t]
                    const selected = theme === t
                    return (
                      <button
                        key={t}
                        onClick={() => updateTheme(t)}
                        className="border-none p-0 cursor-pointer bg-transparent font-ui"
                        style={{ outline: selected ? `2px solid var(--accent)` : '2px solid transparent', borderRadius: 6, transition: 'outline-color 0.15s' }}
                      >
                        <div style={{ width: 72, borderRadius: 6, overflow: 'hidden', background: c.bg, border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}` }}>
                          {/* Mini preview */}
                          <div style={{ padding: '6px 5px 4px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {/* Title bar */}
                            <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                              <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#ff5f57' }} />
                              <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#febc2e' }} />
                              <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#28c840' }} />
                              <div style={{ flex: 1, height: 3, background: c.card, borderRadius: 1, marginLeft: 3 }} />
                            </div>
                            {/* Sidebar + editor mock */}
                            <div style={{ display: 'flex', gap: 2, height: 28 }}>
                              <div style={{ width: 16, background: c.card, borderRadius: 2, display: 'flex', flexDirection: 'column', gap: 2, padding: '3px 2px' }}>
                                <div style={{ height: 2, background: c.dim, borderRadius: 1, opacity: 0.5 }} />
                                <div style={{ height: 2, background: c.accent, borderRadius: 1, opacity: 0.7 }} />
                                <div style={{ height: 2, background: c.dim, borderRadius: 1, opacity: 0.5 }} />
                              </div>
                              <div style={{ flex: 1, background: c.card, borderRadius: 2, display: 'flex', flexDirection: 'column', gap: 2, padding: '3px 3px' }}>
                                <div style={{ height: 2, width: '80%', background: c.accent, borderRadius: 1, opacity: 0.6 }} />
                                <div style={{ height: 2, width: '60%', background: c.text, borderRadius: 1, opacity: 0.25 }} />
                                <div style={{ height: 2, width: '70%', background: c.text, borderRadius: 1, opacity: 0.25 }} />
                                <div style={{ height: 2, width: '45%', background: c.dim, borderRadius: 1, opacity: 0.4 }} />
                              </div>
                            </div>
                            {/* Terminal mock */}
                            <div style={{ height: 10, background: c.card, borderRadius: 2, padding: '2px 3px', display: 'flex', alignItems: 'center', gap: 2 }}>
                              <div style={{ width: 3, height: 3, background: c.accent, borderRadius: '50%' }} />
                              <div style={{ height: 2, width: '55%', background: c.dim, borderRadius: 1, opacity: 0.4 }} />
                            </div>
                          </div>
                          {/* Label */}
                          <div style={{ textAlign: 'center', padding: '3px 0 5px', fontSize: 9, color: selected ? c.accent : c.dim, fontWeight: selected ? 600 : 400, letterSpacing: '0.03em' }}>
                            {{ dark: 'Dark', light: 'Light', creme: 'Creme', nord: 'Nord', monokai: 'Monokai' }[t]}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {tab === 'terminal' && (
            <div>
              <div className="text-[12px] font-semibold text-text-bright mb-[12px] font-ui">Terminal</div>

              <div className="flex items-center py-[5px] gap-[10px] min-h-[30px]">
                <label className="w-[80px] shrink-0 text-text-muted text-[11px] tracking-[0.02em]">Font</label>
                <select
                  className="flex-1 bg-bg border border-border text-text font-ui text-[11px] px-[6px] py-[3px] cursor-pointer appearance-none bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A//www.w3.org/2000/svg%27%20width%3D%2710%27%20height%3D%276%27%20viewBox%3D%270%200%2010%206%27%3E%3Cpath%20d%3D%27M0%200l5%206%205-6z%27%20fill%3D%27%237a7874%27/%3E%3C/svg%3E')] bg-no-repeat bg-[right_8px_center] pr-[22px] focus:outline-none focus:border-accent-dim"
                  value={settings.fontFamily}
                  onChange={e => updateTerminal('fontFamily', e.target.value)}
                >
                  {FONT_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center py-[5px] gap-[10px] min-h-[30px]">
                <label className="w-[80px] shrink-0 text-text-muted text-[11px] tracking-[0.02em]">Size</label>
                <div className="flex items-center border border-border">
                  <button
                    className="w-[26px] h-[24px] bg-bg border-none text-text-muted font-ui text-[14px] cursor-pointer flex items-center justify-center shrink-0 leading-none hover:not-disabled:text-text hover:not-disabled:bg-bg-hover disabled:opacity-30 disabled:cursor-default"
                    onClick={() => updateTerminal('fontSize', Math.max(8, settings.fontSize - 1))}
                    disabled={settings.fontSize <= 8}
                  >-</button>
                  <span className="w-[32px] text-center text-text-bright border-l border-r border-border py-[3px] bg-bg-card text-[12px]">{settings.fontSize}</span>
                  <button
                    className="w-[26px] h-[24px] bg-bg border-none text-text-muted font-ui text-[14px] cursor-pointer flex items-center justify-center shrink-0 leading-none hover:not-disabled:text-text hover:not-disabled:bg-bg-hover disabled:opacity-30 disabled:cursor-default"
                    onClick={() => updateTerminal('fontSize', Math.min(28, settings.fontSize + 1))}
                    disabled={settings.fontSize >= 28}
                  >+</button>
                </div>
              </div>

              <div className="flex items-center py-[5px] gap-[10px] min-h-[30px]">
                <label className="w-[80px] shrink-0 text-text-muted text-[11px] tracking-[0.02em]">Line height</label>
                <div className="flex border border-border">
                  {lineHeightOptions.map(h => (
                    <button
                      key={h}
                      className={`px-[8px] py-[3px] bg-bg border-none border-r border-border text-[10px] font-ui cursor-pointer whitespace-nowrap tracking-[0.02em] last:border-r-0 ${settings.lineHeight === h ? 'bg-[rgba(92,154,125,0.15)] text-accent border-r-border' : 'text-text-muted hover:text-text hover:bg-bg-hover'}`}
                      onClick={() => updateTerminal('lineHeight', h)}
                    >{h.toFixed(1)}</button>
                  ))}
                </div>
              </div>

              <div className="flex items-center py-[5px] gap-[10px] min-h-[30px]">
                <label className="w-[80px] shrink-0 text-text-muted text-[11px] tracking-[0.02em]">Cursor</label>
                <div className="flex border border-border">
                  {(['bar', 'block', 'underline'] as const).map(style => (
                    <button
                      key={style}
                      className={`px-[8px] py-[3px] bg-bg border-none border-r border-border text-[10px] font-ui cursor-pointer whitespace-nowrap tracking-[0.02em] last:border-r-0 ${settings.cursorStyle === style ? 'bg-[rgba(92,154,125,0.15)] text-accent' : 'text-text-muted hover:text-text hover:bg-bg-hover'}`}
                      onClick={() => updateTerminal('cursorStyle', style)}
                    >{style}</button>
                  ))}
                </div>
              </div>

              <div className="flex items-center py-[5px] gap-[10px] min-h-[30px]">
                <label className="w-[80px] shrink-0 text-text-muted text-[11px] tracking-[0.02em]">Blink</label>
                <button
                  className={`w-[34px] h-[18px] border rounded-[9px] p-0 cursor-pointer relative transition-[background,border-color] duration-150 shrink-0 ${settings.cursorBlink ? 'bg-[rgba(92,154,125,0.25)] border-accent-dim [&_.toggle-thumb]:translate-x-[16px] [&_.toggle-thumb]:bg-accent' : 'bg-bg border-border'}`}
                  onClick={() => updateTerminal('cursorBlink', !settings.cursorBlink)}
                >
                  <span className="toggle-thumb absolute top-[2px] left-[2px] w-[12px] h-[12px] bg-text-dim rounded-full transition-[transform,background] duration-150 block" />
                </button>
              </div>

              <div className="flex items-center py-[5px] gap-[10px] min-h-[30px]">
                <label className="w-[80px] shrink-0 text-text-muted text-[11px] tracking-[0.02em]">Scrollback</label>
                <select
                  className="flex-[0_0_80px] bg-bg border border-border text-text font-ui text-[11px] px-[6px] py-[3px] cursor-pointer appearance-none bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A//www.w3.org/2000/svg%27%20width%3D%2710%27%20height%3D%276%27%20viewBox%3D%270%200%2010%206%27%3E%3Cpath%20d%3D%27M0%200l5%206%205-6z%27%20fill%3D%27%237a7874%27/%3E%3C/svg%3E')] bg-no-repeat bg-[right_8px_center] pr-[22px] focus:outline-none focus:border-accent-dim"
                  value={settings.scrollback}
                  onChange={e => updateTerminal('scrollback', Number(e.target.value))}
                >
                  {[1000, 2000, 5000, 10000, 20000].map(n => (
                    <option key={n} value={n}>{n.toLocaleString()}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center py-[5px] gap-[10px] min-h-[30px] border-t border-border mt-[8px] pt-[9px]">
                <label className="w-[80px] shrink-0 text-text-muted text-[11px] tracking-[0.02em]">Permissions</label>
                <div className="flex border border-border">
                  {([
                    { value: 'bypass' as const, label: 'Bypass' },
                    { value: 'auto' as const, label: 'Auto mode' },
                  ]).map(opt => (
                    <button
                      key={opt.value}
                      className={`px-[8px] py-[3px] bg-bg border-none border-r border-border text-[10px] font-ui cursor-pointer whitespace-nowrap tracking-[0.02em] last:border-r-0 ${permissionMode === opt.value ? 'bg-[rgba(92,154,125,0.15)] text-accent border-r-border' : 'text-text-muted hover:text-text hover:bg-bg-hover'}`}
                      onClick={() => updatePermissionMode(opt.value)}
                    >{opt.label}</button>
                  ))}
                </div>
              </div>
              <p className="text-text-dim text-[10px] leading-[1.5] font-ui" style={{ marginTop: 2, marginLeft: 90 }}>
                {permissionMode === 'bypass'
                  ? 'Skip all permission prompts (--dangerously-skip-permissions).'
                  : 'Auto-approve safe actions, block risky ones (--enable-auto-mode).'}
              </p>

              <div className="flex items-center py-[5px] gap-[10px] min-h-[30px] border-t border-border mt-[8px] pt-[9px]">
                <label className="w-[80px] shrink-0 text-text-muted text-[11px] tracking-[0.02em]">Claude config</label>
                <input
                  type="text"
                  className="flex-1 bg-bg border border-border text-text font-ui text-[11px] px-[6px] py-[3px] focus:outline-none focus:border-accent-dim"
                  placeholder="~/.claude (default)"
                  value={globalClaudeConfigDir}
                  onChange={e => updateGlobalClaudeConfigDir(e.target.value)}
                />
              </div>
              <p className="text-text-dim text-[10px] leading-[1.5] font-ui" style={{ marginTop: 2, marginLeft: 90 }}>
                {globalClaudeConfigDir
                  ? `Default subscription: ${globalClaudeConfigDir}. Right-click a building to assign a different one.`
                  : 'Default config (~/.claude). Right-click a building to assign a separate subscription.'}
              </p>

              <div className="flex items-center py-[5px] gap-[10px] min-h-[30px] mt-[4px] pt-[9px]">
                <button className="bg-transparent border border-border text-text-dim font-ui text-[10px] px-[10px] py-[4px] cursor-pointer tracking-[0.02em] transition-[color,border-color] duration-[120ms] hover:text-text hover:border-text-dim" onClick={resetTerminal}>
                  Reset to defaults
                </button>
              </div>
            </div>
          )}

          {tab === 'editor' && (
            <div>
              <div className="text-[12px] font-semibold text-text-bright mb-[12px] font-ui">Editor</div>

              <div className="flex items-center py-[5px] gap-[10px] min-h-[30px]">
                <label className="w-[80px] shrink-0 text-text-muted text-[11px] tracking-[0.02em]">Font</label>
                <select
                  className="flex-1 bg-bg border border-border text-text font-ui text-[11px] px-[6px] py-[3px] cursor-pointer appearance-none bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A//www.w3.org/2000/svg%27%20width%3D%2710%27%20height%3D%276%27%20viewBox%3D%270%200%2010%206%27%3E%3Cpath%20d%3D%27M0%200l5%206%205-6z%27%20fill%3D%27%237a7874%27/%3E%3C/svg%3E')] bg-no-repeat bg-[right_8px_center] pr-[22px] focus:outline-none focus:border-accent-dim"
                  value={editorSettings.fontFamily}
                  onChange={e => updateEditor('fontFamily', e.target.value)}
                >
                  {FONT_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                  <option value="'JetBrains Mono', 'Fira Code', monospace">JetBrains + Fira</option>
                </select>
              </div>

              <div className="flex items-center py-[5px] gap-[10px] min-h-[30px]">
                <label className="w-[80px] shrink-0 text-text-muted text-[11px] tracking-[0.02em]">Size</label>
                <div className="flex items-center border border-border">
                  <button
                    className="w-[26px] h-[24px] bg-bg border-none text-text-muted font-ui text-[14px] cursor-pointer flex items-center justify-center shrink-0 leading-none hover:not-disabled:text-text hover:not-disabled:bg-bg-hover disabled:opacity-30 disabled:cursor-default"
                    onClick={() => updateEditor('fontSize', Math.max(8, editorSettings.fontSize - 1))}
                    disabled={editorSettings.fontSize <= 8}
                  >-</button>
                  <span className="w-[32px] text-center text-text-bright border-l border-r border-border py-[3px] bg-bg-card text-[12px]">{editorSettings.fontSize}</span>
                  <button
                    className="w-[26px] h-[24px] bg-bg border-none text-text-muted font-ui text-[14px] cursor-pointer flex items-center justify-center shrink-0 leading-none hover:not-disabled:text-text hover:not-disabled:bg-bg-hover disabled:opacity-30 disabled:cursor-default"
                    onClick={() => updateEditor('fontSize', Math.min(28, editorSettings.fontSize + 1))}
                    disabled={editorSettings.fontSize >= 28}
                  >+</button>
                </div>
              </div>

              <div className="flex items-center py-[5px] gap-[10px] min-h-[30px]">
                <label className="w-[80px] shrink-0 text-text-muted text-[11px] tracking-[0.02em]">Tab size</label>
                <div className="flex border border-border">
                  {[2, 4, 8].map(s => (
                    <button
                      key={s}
                      className={`px-[8px] py-[3px] bg-bg border-none border-r border-border text-[10px] font-ui cursor-pointer whitespace-nowrap tracking-[0.02em] last:border-r-0 ${editorSettings.tabSize === s ? 'bg-[rgba(92,154,125,0.15)] text-accent' : 'text-text-muted hover:text-text hover:bg-bg-hover'}`}
                      onClick={() => updateEditor('tabSize', s)}
                    >{s}</button>
                  ))}
                </div>
              </div>

              <div className="flex items-center py-[5px] gap-[10px] min-h-[30px]">
                <label className="w-[80px] shrink-0 text-text-muted text-[11px] tracking-[0.02em]">Word wrap</label>
                <div className="flex border border-border">
                  {(['off', 'on'] as const).map(w => (
                    <button
                      key={w}
                      className={`px-[8px] py-[3px] bg-bg border-none border-r border-border text-[10px] font-ui cursor-pointer whitespace-nowrap tracking-[0.02em] last:border-r-0 ${editorSettings.wordWrap === w ? 'bg-[rgba(92,154,125,0.15)] text-accent' : 'text-text-muted hover:text-text hover:bg-bg-hover'}`}
                      onClick={() => updateEditor('wordWrap', w)}
                    >{w}</button>
                  ))}
                </div>
              </div>

              <div className="flex items-center py-[5px] gap-[10px] min-h-[30px]">
                <label className="w-[80px] shrink-0 text-text-muted text-[11px] tracking-[0.02em]">Line numbers</label>
                <div className="flex border border-border">
                  {(['on', 'off', 'relative'] as const).map(ln => (
                    <button
                      key={ln}
                      className={`px-[8px] py-[3px] bg-bg border-none border-r border-border text-[10px] font-ui cursor-pointer whitespace-nowrap tracking-[0.02em] last:border-r-0 ${editorSettings.lineNumbers === ln ? 'bg-[rgba(92,154,125,0.15)] text-accent' : 'text-text-muted hover:text-text hover:bg-bg-hover'}`}
                      onClick={() => updateEditor('lineNumbers', ln)}
                    >{ln}</button>
                  ))}
                </div>
              </div>

              <div className="flex items-center py-[5px] gap-[10px] min-h-[30px]">
                <label className="w-[80px] shrink-0 text-text-muted text-[11px] tracking-[0.02em]">Whitespace</label>
                <select
                  className="flex-1 bg-bg border border-border text-text font-ui text-[11px] px-[6px] py-[3px] cursor-pointer appearance-none bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A//www.w3.org/2000/svg%27%20width%3D%2710%27%20height%3D%276%27%20viewBox%3D%270%200%2010%206%27%3E%3Cpath%20d%3D%27M0%200l5%206%205-6z%27%20fill%3D%27%237a7874%27/%3E%3C/svg%3E')] bg-no-repeat bg-[right_8px_center] pr-[22px] focus:outline-none focus:border-accent-dim"
                  value={editorSettings.renderWhitespace}
                  onChange={e => updateEditor('renderWhitespace', e.target.value as EditorSettings['renderWhitespace'])}
                >
                  {(['none', 'boundary', 'selection', 'all'] as const).map(w => (
                    <option key={w} value={w}>{w}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center py-[5px] gap-[10px] min-h-[30px]">
                <label className="w-[80px] shrink-0 text-text-muted text-[11px] tracking-[0.02em]">Minimap</label>
                <button
                  className={`w-[34px] h-[18px] border rounded-[9px] p-0 cursor-pointer relative transition-[background,border-color] duration-150 shrink-0 ${editorSettings.minimap ? 'bg-[rgba(92,154,125,0.25)] border-accent-dim [&_.toggle-thumb]:translate-x-[16px] [&_.toggle-thumb]:bg-accent' : 'bg-bg border-border'}`}
                  onClick={() => updateEditor('minimap', !editorSettings.minimap)}
                >
                  <span className="toggle-thumb absolute top-[2px] left-[2px] w-[12px] h-[12px] bg-text-dim rounded-full transition-[transform,background] duration-150 block" />
                </button>
              </div>

              <div className="flex items-center py-[5px] gap-[10px] min-h-[30px]">
                <label className="w-[80px] shrink-0 text-text-muted text-[11px] tracking-[0.02em]">Bracket colors</label>
                <button
                  className={`w-[34px] h-[18px] border rounded-[9px] p-0 cursor-pointer relative transition-[background,border-color] duration-150 shrink-0 ${editorSettings.bracketPairColorization ? 'bg-[rgba(92,154,125,0.25)] border-accent-dim [&_.toggle-thumb]:translate-x-[16px] [&_.toggle-thumb]:bg-accent' : 'bg-bg border-border'}`}
                  onClick={() => updateEditor('bracketPairColorization', !editorSettings.bracketPairColorization)}
                >
                  <span className="toggle-thumb absolute top-[2px] left-[2px] w-[12px] h-[12px] bg-text-dim rounded-full transition-[transform,background] duration-150 block" />
                </button>
              </div>

              <div className="flex items-center py-[5px] gap-[10px] min-h-[30px] border-t border-border mt-[4px] pt-[9px]">
                <button className="bg-transparent border border-border text-text-dim font-ui text-[10px] px-[10px] py-[4px] cursor-pointer tracking-[0.02em] transition-[color,border-color] duration-[120ms] hover:text-text hover:border-text-dim" onClick={resetEditor}>
                  Reset to defaults
                </button>
              </div>
            </div>
          )}

          {tab === 'notifications' && (
            <div>
              <div className="text-[12px] font-semibold text-text-bright mb-[12px] font-ui">Notifications</div>
              <p className="text-text-dim text-[10.5px] mb-[10px] leading-[1.5] font-ui">Control when system notifications are shown.</p>

              {NOTIFICATION_COLUMNS.map(({ key, label }) => (
                <div className="flex items-center py-[5px] gap-[10px] min-h-[30px]" key={key}>
                  <label className="w-[80px] shrink-0 text-text-muted text-[11px] tracking-[0.02em]">{label}</label>
                  <button
                    className={`w-[34px] h-[18px] border rounded-[9px] p-0 cursor-pointer relative transition-[background,border-color] duration-150 shrink-0 ${notifSettings[key as keyof NotificationSettings] ? 'bg-[rgba(92,154,125,0.25)] border-accent-dim [&_.toggle-thumb]:translate-x-[16px] [&_.toggle-thumb]:bg-accent' : 'bg-bg border-border'}`}
                    onClick={() => updateNotification(key as keyof NotificationSettings, !notifSettings[key as keyof NotificationSettings])}
                  >
                    <span className="toggle-thumb absolute top-[2px] left-[2px] w-[12px] h-[12px] bg-text-dim rounded-full transition-[transform,background] duration-150 block" />
                  </button>
                </div>
              ))}

              <div className="flex items-center py-[5px] gap-[10px] min-h-[30px] border-t border-border mt-[4px] pt-[9px]">
                <button className="bg-transparent border border-border text-text-dim font-ui text-[10px] px-[10px] py-[4px] cursor-pointer tracking-[0.02em] transition-[color,border-color] duration-[120ms] hover:text-text hover:border-text-dim" onClick={resetNotifications}>
                  Reset to defaults
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
