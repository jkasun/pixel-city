/**
 * WorkspaceLayout — shared workspace container structure.
 *
 * Provides the canonical 3-column layout used by both desktop and web:
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ toolbar (slot)                               │
 *   ├────────────┬──┬──────────┬──────────────────┤
 *   │ PluginPanel│  │DmSidebar │TerminalMain      │
 *   │ (iconBar + │G │          │ (tab bar +        │
 *   │  content)  │U │          │  terminal area)   │
 *   │            │T │          │                   │
 *   │            │T │          │                   │
 *   │            │E │          │                   │
 *   │            │R │          │                   │
 *   ├────────────┴──┴──────────┴──────────────────┤
 *   │ statusBar (slot)                             │
 *   └──────────────────────────────────────────────┘
 *
 * Each app provides its own resize logic:
 * - Desktop: Split.js (imperative, ref-based gutters)
 * - Web: useState + mouseMove handler
 *
 * This component only provides the flex container structure.
 * Refs are forwarded so apps can attach their own resize logic.
 */

import React, { forwardRef } from 'react'

// ── Styles (inline to avoid CSS file dependency) ────────────────────

const ROOT_STYLE: React.CSSProperties = {
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}

const BODY_STYLE: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  overflow: 'hidden',
  minHeight: 0,
}

const PLUGIN_PANEL_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'row',
  overflow: 'hidden',
  minWidth: 0,
}

const AGENT_PANEL_STYLE: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'row',
  overflow: 'hidden',
  minWidth: 0,
}

const DM_SIDEBAR_STYLE: React.CSSProperties = {
  minWidth: 140,
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg-card)',
  borderRight: '1px solid var(--border)',
  overflow: 'visible',
  position: 'relative',
}

const TERMINAL_MAIN_STYLE: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  minWidth: 0,
  minHeight: 0,
}

// ── Props ───────────────────────────────────────────────────────────

export interface WorkspaceLayoutProps {
  /** Top toolbar slot */
  toolbar?: React.ReactNode
  /** Bottom status bar slot */
  statusBar?: React.ReactNode

  /** Plugin icon bar (the narrow icon column) */
  pluginIconBar: React.ReactNode
  /** Plugin panel content (the wider content area next to icons) */
  pluginContent: React.ReactNode

  /** DM sidebar content (agent selector) */
  dmSidebar: React.ReactNode
  /** Terminal main content (tab bar + terminal area) */
  terminalMain: React.ReactNode

  /**
   * Optional element(s) between plugin panel and agent panel.
   * Desktop: Split.js creates its own gutter element.
   * Web: renders a <ResizeHandle /> here.
   */
  resizeHandle?: React.ReactNode

  /**
   * Plugin panel width in px.
   * When set, the plugin panel gets a fixed width and the agent panel fills the rest.
   * When omitted, both panels are flex children (desktop uses Split.js to manage sizes).
   */
  pluginPanelWidth?: number

  /** When false, the agent panel (DM sidebar + terminal) is hidden and the plugin panel fills the space. */
  agentPanelVisible?: boolean

  /** Extra className on root */
  className?: string
  /** Extra style on root */
  style?: React.CSSProperties
}

export interface WorkspaceLayoutRef {
  pluginPanel: HTMLDivElement | null
  agentPanel: HTMLDivElement | null
  dmSidebar: HTMLDivElement | null
  terminalMain: HTMLDivElement | null
}

/**
 * WorkspaceLayout renders the shared container structure.
 *
 * Refs are exposed via `useImperativeHandle` so both apps can attach
 * their own resize logic (Split.js or state-based).
 */
export const WorkspaceLayout = forwardRef<WorkspaceLayoutRef, WorkspaceLayoutProps>(
  function WorkspaceLayout(
    {
      toolbar,
      statusBar,
      pluginIconBar,
      pluginContent,
      dmSidebar,
      terminalMain,
      resizeHandle,
      pluginPanelWidth,
      agentPanelVisible = true,
      className,
      style,
    },
    ref,
  ) {
    const pluginPanelEl = React.useRef<HTMLDivElement>(null)
    const agentPanelEl = React.useRef<HTMLDivElement>(null)
    const dmSidebarEl = React.useRef<HTMLDivElement>(null)
    const terminalMainEl = React.useRef<HTMLDivElement>(null)

    React.useImperativeHandle(ref, () => ({
      get pluginPanel() { return pluginPanelEl.current },
      get agentPanel() { return agentPanelEl.current },
      get dmSidebar() { return dmSidebarEl.current },
      get terminalMain() { return terminalMainEl.current },
    }))

    return (
      <div className={className} style={{ ...ROOT_STYLE, ...style }}>
        {toolbar}

        <div style={BODY_STYLE}>
          {/* LEFT: Plugin panel (icon bar + content) */}
          <div ref={pluginPanelEl} data-testid="app-main-panel" style={{
            ...PLUGIN_PANEL_STYLE,
            ...(pluginPanelWidth != null ? { width: pluginPanelWidth, flexShrink: 0 } : { flex: 1 }),
          }}>
            {pluginIconBar}
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, overflow: 'hidden' }}>
              {pluginContent}
            </div>
          </div>

          {agentPanelVisible && resizeHandle}

          {/* RIGHT: Agent panel (DM sidebar + terminal main) */}
          <div ref={agentPanelEl} data-testid="agent-panel" style={{ ...AGENT_PANEL_STYLE, ...(agentPanelVisible ? {} : { display: 'none' }) }}>
            <div ref={dmSidebarEl} data-testid="dm-sidebar" style={DM_SIDEBAR_STYLE}>
              {dmSidebar}
            </div>
            <div ref={terminalMainEl} data-testid="terminal-main" style={TERMINAL_MAIN_STYLE}>
              {terminalMain}
            </div>
          </div>
        </div>

        {statusBar}
      </div>
    )
  },
)
