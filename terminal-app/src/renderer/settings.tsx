import React, { useState, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import type { TerminalSettings, NotificationSettings, EditorSettings } from './settings/settingsManager.js'
import { TerminalIcon, EditIcon, BellIcon } from './icons/index.js'
import {
  DEFAULT_SETTINGS, DEFAULT_NOTIFICATION_SETTINGS, DEFAULT_EDITOR_SETTINGS, FONT_OPTIONS,
  NOTIFICATION_COLUMNS,
  loadSettings, loadNotificationSettings, loadEditorSettings,
  savePixelCitySettings, saveNotificationSettings, saveEditorSettings,
} from './settings/settingsManager.js'

import { platform } from './platform/index.js'

// ── Settings Window App ─────────────────────────────────────────

type SettingsTab = 'terminal' | 'editor' | 'notifications'

function SettingsApp() {
  const [tab, setTab] = useState<SettingsTab>('terminal')
  const [termSettings, setTermSettings] = useState<TerminalSettings>(loadSettings)
  const [editorSettingsState, setEditorSettingsState] = useState<EditorSettings>(loadEditorSettings)
  const [notifSettings, setNotifSettings] = useState<NotificationSettings>(loadNotificationSettings)

  const updateTerminal = useCallback(<K extends keyof TerminalSettings>(key: K, val: TerminalSettings[K]) => {
    const next = { ...termSettings, [key]: val }
    setTermSettings(next)
    savePixelCitySettings({ terminalSettings: next })
    platform().settings.update({ terminalSettings: next })
  }, [termSettings])

  const updateNotification = useCallback(<K extends keyof NotificationSettings>(key: K, val: NotificationSettings[K]) => {
    const next = { ...notifSettings, [key]: val }
    setNotifSettings(next)
    saveNotificationSettings(next)
  }, [notifSettings])

  const resetTerminal = useCallback(() => {
    setTermSettings(DEFAULT_SETTINGS)
    savePixelCitySettings({ terminalSettings: DEFAULT_SETTINGS })
    platform().settings.update({ terminalSettings: DEFAULT_SETTINGS })
  }, [])

  const resetNotifications = useCallback(() => {
    setNotifSettings(DEFAULT_NOTIFICATION_SETTINGS)
    saveNotificationSettings(DEFAULT_NOTIFICATION_SETTINGS)
  }, [])

  const updateEditor = useCallback(<K extends keyof EditorSettings>(key: K, val: EditorSettings[K]) => {
    const next = { ...editorSettingsState, [key]: val }
    setEditorSettingsState(next)
    saveEditorSettings(next)
    platform().settings.update({ editorSettings: next })
  }, [editorSettingsState])

  const resetEditorSettings = useCallback(() => {
    setEditorSettingsState(DEFAULT_EDITOR_SETTINGS)
    saveEditorSettings(DEFAULT_EDITOR_SETTINGS)
    platform().settings.update({ editorSettings: DEFAULT_EDITOR_SETTINGS })
  }, [])

  const lineHeightOptions = [1.0, 1.2, 1.4, 1.6, 1.8, 2.0]

  return (
    <div className="sw-root">
      <div className="sw-sidebar">
        <div className="sw-sidebar-title">Settings</div>
        <button
          className={`sw-tab${tab === 'terminal' ? ' active' : ''}`}
          onClick={() => setTab('terminal')}
        >
          <TerminalIcon size={14} />
          Terminal
        </button>
        <button
          className={`sw-tab${tab === 'editor' ? ' active' : ''}`}
          onClick={() => setTab('editor')}
        >
          <EditIcon size={14} />
          Editor
        </button>
        <button
          className={`sw-tab${tab === 'notifications' ? ' active' : ''}`}
          onClick={() => setTab('notifications')}
        >
          <BellIcon size={14} />
          Notifications
        </button>
      </div>

      <div className="sw-content">
        {tab === 'terminal' && (
          <div className="sw-section">
            <div className="sw-section-title">Terminal</div>

            <div className="settings-row">
              <label>Font</label>
              <select
                className="settings-select"
                value={termSettings.fontFamily}
                onChange={e => updateTerminal('fontFamily', e.target.value)}
              >
                {FONT_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div className="settings-row">
              <label>Size</label>
              <div className="settings-stepper">
                <button
                  className="stepper-btn"
                  onClick={() => updateTerminal('fontSize', Math.max(8, termSettings.fontSize - 1))}
                  disabled={termSettings.fontSize <= 8}
                >-</button>
                <span className="stepper-value">{termSettings.fontSize}</span>
                <button
                  className="stepper-btn"
                  onClick={() => updateTerminal('fontSize', Math.min(28, termSettings.fontSize + 1))}
                  disabled={termSettings.fontSize >= 28}
                >+</button>
              </div>
            </div>

            <div className="settings-row">
              <label>Line height</label>
              <div className="settings-segments">
                {lineHeightOptions.map(h => (
                  <button
                    key={h}
                    className={`seg-btn${termSettings.lineHeight === h ? ' active' : ''}`}
                    onClick={() => updateTerminal('lineHeight', h)}
                  >{h.toFixed(1)}</button>
                ))}
              </div>
            </div>

            <div className="settings-row">
              <label>Cursor</label>
              <div className="settings-segments">
                {(['bar', 'block', 'underline'] as const).map(style => (
                  <button
                    key={style}
                    className={`seg-btn${termSettings.cursorStyle === style ? ' active' : ''}`}
                    onClick={() => updateTerminal('cursorStyle', style)}
                  >{style}</button>
                ))}
              </div>
            </div>

            <div className="settings-row">
              <label>Blink</label>
              <button
                className={`toggle-btn${termSettings.cursorBlink ? ' active' : ''}`}
                onClick={() => updateTerminal('cursorBlink', !termSettings.cursorBlink)}
              >
                <span className="toggle-thumb" />
              </button>
            </div>

            <div className="settings-row">
              <label>Scrollback</label>
              <select
                className="settings-select settings-select-sm"
                value={termSettings.scrollback}
                onChange={e => updateTerminal('scrollback', Number(e.target.value))}
              >
                {[1000, 2000, 5000, 10000, 20000].map(n => (
                  <option key={n} value={n}>{n.toLocaleString()}</option>
                ))}
              </select>
            </div>

            <div className="settings-row settings-row-reset">
              <button className="reset-btn" onClick={resetTerminal}>
                Reset to defaults
              </button>
            </div>
          </div>
        )}

        {tab === 'editor' && (
          <div className="sw-section">
            <div className="sw-section-title">Editor</div>

            <div className="settings-row">
              <label>Font</label>
              <select
                className="settings-select"
                value={editorSettingsState.fontFamily}
                onChange={e => updateEditor('fontFamily', e.target.value)}
              >
                {FONT_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
                <option value="'JetBrains Mono', 'Fira Code', monospace">JetBrains + Fira</option>
              </select>
            </div>

            <div className="settings-row">
              <label>Size</label>
              <div className="settings-stepper">
                <button
                  className="stepper-btn"
                  onClick={() => updateEditor('fontSize', Math.max(8, editorSettingsState.fontSize - 1))}
                  disabled={editorSettingsState.fontSize <= 8}
                >-</button>
                <span className="stepper-value">{editorSettingsState.fontSize}</span>
                <button
                  className="stepper-btn"
                  onClick={() => updateEditor('fontSize', Math.min(28, editorSettingsState.fontSize + 1))}
                  disabled={editorSettingsState.fontSize >= 28}
                >+</button>
              </div>
            </div>

            <div className="settings-row">
              <label>Tab size</label>
              <div className="settings-segments">
                {[2, 4, 8].map(s => (
                  <button
                    key={s}
                    className={`seg-btn${editorSettingsState.tabSize === s ? ' active' : ''}`}
                    onClick={() => updateEditor('tabSize', s)}
                  >{s}</button>
                ))}
              </div>
            </div>

            <div className="settings-row">
              <label>Word wrap</label>
              <div className="settings-segments">
                {(['off', 'on'] as const).map(w => (
                  <button
                    key={w}
                    className={`seg-btn${editorSettingsState.wordWrap === w ? ' active' : ''}`}
                    onClick={() => updateEditor('wordWrap', w)}
                  >{w}</button>
                ))}
              </div>
            </div>

            <div className="settings-row">
              <label>Line numbers</label>
              <div className="settings-segments">
                {(['on', 'off', 'relative'] as const).map(ln => (
                  <button
                    key={ln}
                    className={`seg-btn${editorSettingsState.lineNumbers === ln ? ' active' : ''}`}
                    onClick={() => updateEditor('lineNumbers', ln)}
                  >{ln}</button>
                ))}
              </div>
            </div>

            <div className="settings-row">
              <label>Whitespace</label>
              <select
                className="settings-select"
                value={editorSettingsState.renderWhitespace}
                onChange={e => updateEditor('renderWhitespace', e.target.value as EditorSettings['renderWhitespace'])}
              >
                {(['none', 'boundary', 'selection', 'all'] as const).map(w => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </select>
            </div>

            <div className="settings-row">
              <label>Minimap</label>
              <button
                className={`toggle-btn${editorSettingsState.minimap ? ' active' : ''}`}
                onClick={() => updateEditor('minimap', !editorSettingsState.minimap)}
              >
                <span className="toggle-thumb" />
              </button>
            </div>

            <div className="settings-row">
              <label>Bracket colors</label>
              <button
                className={`toggle-btn${editorSettingsState.bracketPairColorization ? ' active' : ''}`}
                onClick={() => updateEditor('bracketPairColorization', !editorSettingsState.bracketPairColorization)}
              >
                <span className="toggle-thumb" />
              </button>
            </div>

            <div className="settings-row settings-row-reset">
              <button className="reset-btn" onClick={resetEditorSettings}>
                Reset to defaults
              </button>
            </div>
          </div>
        )}

        {tab === 'notifications' && (
          <div className="sw-section">
            <div className="sw-section-title">Notifications</div>
            <p className="sw-description">Control when system notifications are shown.</p>

            {NOTIFICATION_COLUMNS.map(({ key, label }) => (
              <div className="settings-row" key={key}>
                <label>{label}</label>
                <button
                  className={`toggle-btn${notifSettings[key as keyof NotificationSettings] ? ' active' : ''}`}
                  onClick={() => updateNotification(key as keyof NotificationSettings, !notifSettings[key as keyof NotificationSettings])}
                >
                  <span className="toggle-thumb" />
                </button>
              </div>
            ))}

            <div className="settings-row settings-row-reset">
              <button className="reset-btn" onClick={resetNotifications}>
                Reset to defaults
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Styles ──────────────────────────────────────────────────────

const style = document.createElement('style')
style.textContent = `
  :root {
    --bg: #0a0a0c;
    --bg-card: #131316;
    --bg-hover: #1a1a1e;
    --border: #2a2a2e;
    --text: #c8c5be;
    --text-muted: #7a7874;
    --text-dim: #5a5854;
    --text-bright: #eae7e0;
    --accent: #5c9a7d;
    --accent-dim: #3d6b55;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'JetBrains Mono', 'SF Mono', monospace;
    font-size: 11px;
    overflow: hidden;
    -webkit-app-region: no-drag;
  }
  .sw-root {
    display: flex;
    height: 100vh;
  }
  .sw-sidebar {
    width: 180px;
    background: var(--bg-card);
    border-right: 1px solid var(--border);
    padding: 12px 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex-shrink: 0;
  }
  .sw-sidebar-title {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
    padding: 4px 8px 10px;
  }
  .sw-tab {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    background: none;
    border: none;
    color: var(--text-muted);
    font-family: inherit;
    font-size: 11px;
    cursor: pointer;
    border-radius: 4px;
    text-align: left;
  }
  .sw-tab:hover { background: var(--bg-hover); color: var(--text); }
  .sw-tab.active { background: rgba(92, 154, 125, 0.12); color: var(--accent); }
  .sw-content {
    flex: 1;
    padding: 16px 20px;
    overflow-y: auto;
  }
  .sw-section-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-bright);
    margin-bottom: 16px;
  }
  .sw-description {
    color: var(--text-dim);
    font-size: 11px;
    margin-bottom: 14px;
    line-height: 1.5;
  }
  .settings-row {
    display: flex;
    align-items: center;
    padding: 5px 0;
    gap: 10px;
    min-height: 30px;
  }
  .settings-row label {
    width: 120px;
    flex-shrink: 0;
    color: var(--text-muted);
    font-size: 11px;
    letter-spacing: 0.02em;
  }
  .settings-row-reset {
    border-top: 1px solid var(--border);
    margin-top: 8px;
    padding-top: 12px;
  }
  .settings-select {
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    padding: 3px 6px;
    cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%237a7874'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 8px center;
    padding-right: 22px;
  }
  .settings-select:focus { outline: none; border-color: var(--accent-dim); }
  .settings-select-sm { flex: 0 0 80px; }
  .settings-stepper {
    display: flex;
    align-items: center;
    gap: 0;
    border: 1px solid var(--border);
  }
  .stepper-btn {
    width: 26px;
    height: 24px;
    background: var(--bg);
    border: none;
    color: var(--text-muted);
    font-family: 'JetBrains Mono', monospace;
    font-size: 14px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    line-height: 1;
  }
  .stepper-btn:hover:not(:disabled) { color: var(--text); background: var(--bg-hover); }
  .stepper-btn:disabled { opacity: 0.3; cursor: default; }
  .stepper-value {
    width: 32px;
    text-align: center;
    color: var(--text-bright);
    border-left: 1px solid var(--border);
    border-right: 1px solid var(--border);
    padding: 3px 0;
    background: var(--bg-card);
    font-size: 12px;
  }
  .settings-segments {
    display: flex;
    border: 1px solid var(--border);
  }
  .seg-btn {
    padding: 3px 8px;
    background: var(--bg);
    border: none;
    border-right: 1px solid var(--border);
    color: var(--text-muted);
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    cursor: pointer;
    white-space: nowrap;
    letter-spacing: 0.02em;
  }
  .seg-btn:last-child { border-right: none; }
  .seg-btn:hover:not(.active) { color: var(--text); background: var(--bg-hover); }
  .seg-btn.active { background: rgba(92, 154, 125, 0.15); color: var(--accent); }
  .toggle-btn {
    width: 34px;
    height: 18px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 9px;
    padding: 0;
    cursor: pointer;
    position: relative;
    transition: background 0.15s, border-color 0.15s;
    flex-shrink: 0;
  }
  .toggle-btn.active {
    background: rgba(92, 154, 125, 0.25);
    border-color: var(--accent-dim);
  }
  .toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    background: var(--text-dim);
    border-radius: 50%;
    transition: transform 0.15s, background 0.15s;
    display: block;
  }
  .toggle-btn.active .toggle-thumb {
    transform: translateX(16px);
    background: var(--accent);
  }
  .reset-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-dim);
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    padding: 5px 14px;
    cursor: pointer;
    letter-spacing: 0.02em;
  }
  .reset-btn:hover { color: var(--text); border-color: var(--text-dim); }
`
document.head.appendChild(style)

// ── Mount ───────────────────────────────────────────────────────

const root = createRoot(document.getElementById('root')!)
root.render(<SettingsApp />)
