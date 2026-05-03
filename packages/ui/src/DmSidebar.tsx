/**
 * DmSidebar — agent sidebar shared between desktop and web.
 *
 * Platform seams replaced with props:
 *   llmRegistry       → availableModels: ModelPickerEntry[]
 *   MiniMapOverview   → renderMiniMap?: () => React.ReactNode
 */

import React, { useState, useRef, useEffect } from 'react'
import { AgentIcon } from './AgentIcon.js'
import { StatusDisplay } from './StatusDisplay.js'
import { ModelChip } from './ModelChip.js'
import type { ChipDescriptor } from '@pixel-city/core/llm'
import type { QuickAction, ModelPickerEntry, BottomPanelKind, ActiveView } from '@pixel-city/core/session'
import { FolderIcon, TerminalPromptIcon, TerminalIcon, QuickActionIcon, EditSmallIcon } from './icons/index.js'

export interface InactiveFloorGroup {
  floorLabel: string
  employees: Array<{ id: string; name: string; palette: number; hueShift?: number; model?: string }>
}

export interface DmSidebarProps {
  projectBasename: string

  // Inactive permanent employees (no active session), grouped by floor
  inactiveEmployeesByFloor: InactiveFloorGroup[]
  onStartEmployee?: (employeeId: string) => void
  /** When true, Start buttons are disabled (office still initialising). */
  officeReady?: boolean

  // Shell state
  shellIds: number[]
  activeView: ActiveView
  activeShellId: number | null
  shellsCollapsed: boolean
  shellNames: Record<number, string>
  onShellsCollapsedToggle: () => void
  onAddShell: () => void
  onRemoveShell: (id: number) => void
  onSelectShell: (id: number) => void

  // Agent state
  agentIds: string[]
  activeAgentId: string | null
  agentPalettes: Map<string, number>
  agentHueShiftMap?: Map<string, number>
  agentNames: Map<string, string>
  agentModels: Map<string, string>
  agentStatusMap: Map<string, string>
  agentStatusStartMap: Map<string, number>
  agentTokensMap: Map<string, number>
  agentBuildingMap: Map<string, string>
  agentNotes: Map<string, string>
  editingNoteId: string | null
  currentBuildingId: string | null
  onSelectAgent: (id: string) => void
  onRemoveAgent: (id: string) => void
  onSetEditingNoteId: (id: string | null) => void
  onSetAgentNotes: React.Dispatch<React.SetStateAction<Map<string, string>>>

  // Quick actions
  quickActions: QuickAction[]
  onAddQuickAction: (title: string, description: string, type: 'ai' | 'terminal', command?: string) => void
  onRemoveQuickAction: (id: string) => void
  onUpdateQuickAction: (id: string, title: string, description: string, type: 'ai' | 'terminal', command?: string) => void
  onRunQuickAction: (action: QuickAction) => void

  // Add agent — model picker abstraction
  availableModels: ModelPickerEntry[]
  onAddAgent: (model: string) => void

  /**
   * Resolve a model ID to its sidebar chip descriptor. Null → UI falls back
   * to first-char + neutral grey. Injected by the host (desktop/web) so this
   * component stays agnostic to the provider registry.
   */
  getChipDescriptor: (modelId: string) => ChipDescriptor | null

  // Footer
  bottomPanel?: BottomPanelKind
  onSetBottomPanel?: (v: BottomPanelKind) => void

  // Render slots — platform-specific sub-components
  renderMiniMap?: () => React.ReactNode

  // Optional callbacks (desktop-only features; web can omit)
  onChangeFolder?: () => void
}

export function DmSidebar(props: DmSidebarProps) {
  const {
    projectBasename: projName,
    inactiveEmployeesByFloor, onStartEmployee, officeReady,
    shellIds, activeView, activeShellId, shellsCollapsed, shellNames,
    onShellsCollapsedToggle, onAddShell, onRemoveShell, onSelectShell,
    agentIds, activeAgentId, agentPalettes, agentHueShiftMap, agentNames, agentModels,
    agentStatusMap, agentStatusStartMap, agentTokensMap,
    agentBuildingMap, agentNotes, editingNoteId, currentBuildingId,
    onSelectAgent, onRemoveAgent, onSetEditingNoteId, onSetAgentNotes,
    quickActions, onAddQuickAction, onRemoveQuickAction, onUpdateQuickAction, onRunQuickAction,
    availableModels, onAddAgent, getChipDescriptor,
    renderMiniMap,
  } = props

  const [showAgentPicker, setShowAgentPicker] = useState(false)
  const [agentsCollapsed, setAgentsCollapsed] = useState(false)
  const agentPickerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!showAgentPicker) return
    const handler = (e: MouseEvent) => {
      if (agentPickerRef.current && !agentPickerRef.current.contains(e.target as Node)) {
        setShowAgentPicker(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showAgentPicker])

  const buildingAgentIds = currentBuildingId
    ? agentIds.filter(id => agentBuildingMap.get(id) === currentBuildingId)
    : agentIds.filter(id => !agentBuildingMap.has(id))

  return (
    <>
      {/* dm-sidebar-header */}
      <div id="dm-sidebar-header" data-testid="dm-sidebar-header" className="flex items-center gap-[7px] px-3 py-[10px] border-b border-border shrink-0">
        <FolderIcon size={10} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        {/* dm-workspace-name */}
        <span data-testid="dm-workspace-name" className="text-[11px] font-semibold text-text-bright tracking-[0.02em] whitespace-nowrap overflow-hidden text-ellipsis flex-1 min-w-0">{projName}</span>
      </div>

      {/* Quick Actions — pinned between header and scroll, always visible */}
      <div className="shrink-0 border-b border-border">
        <QuickActionsSection
          actions={quickActions}
          onAdd={onAddQuickAction}
          onRemove={onRemoveQuickAction}
          onUpdate={onUpdateQuickAction}
          onRun={onRunQuickAction}
        />
      </div>

      {/* dm-list-section */}
      <div id="dm-list-section" className="flex-1 flex flex-col overflow-y-auto overflow-x-hidden pt-1 [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent]">
        {/* Terminals section */}
        <button className="flex items-center gap-1 w-full px-[10px] py-[5px] bg-transparent border-none cursor-pointer select-none shrink-0 hover:bg-bg-hover" onClick={onShellsCollapsedToggle}>
          <span className="text-[9px] text-text-dim w-[10px] text-center shrink-0">{shellsCollapsed ? '▶' : '▼'}</span>
          <span className="text-[9px] uppercase tracking-[0.18em] text-text-dim shrink-0">Terminals</span>
          <span
            className="ml-auto text-[14px] text-text-dim leading-none px-[2px] rounded-[2px] transition-colors duration-100 hover:text-accent"
            onClick={e => { e.stopPropagation(); onAddShell() }}
            title="New terminal"
          >+</span>
        </button>
        {!shellsCollapsed && (
          <div id="dm-list" className="overflow-y-visible">
            {shellIds.length === 0 ? (
              <div className="px-[10px] pl-[24px] py-[6px] text-[10px] text-text-dim italic">
                No terminals
              </div>
            ) : shellIds.map(id => (
              <button
                key={`shell-${id}`}
                data-active={activeView === 'shell' && activeShellId === id ? 'true' : undefined}
                className="dm-row flex items-center gap-2 w-full px-[10px] py-[5px] border-none cursor-pointer text-left select-none [-webkit-tap-highlight-color:transparent] [touch-action:manipulation] relative group"
                onClick={() => onSelectShell(id)}
              >
                <div className="relative shrink-0 w-[26px] h-[26px] flex items-center justify-center">
                  <TerminalPromptIcon size={16} style={{ color: 'var(--text-muted)' }} />
                </div>
                <div className="flex-1 min-w-0 flex flex-col gap-[1px]">
                  <span className="text-[11px] text-text whitespace-nowrap overflow-hidden text-ellipsis">{shellNames[id] ?? `Terminal ${id + 1}`}</span>
                </div>
                <span
                  className="opacity-0 bg-transparent border-none text-text-dim text-[9px] cursor-pointer px-[3px] py-[2px] rounded-[2px] shrink-0 transition-[opacity,color] duration-100 leading-none group-hover:opacity-100 hover:text-[#c97b7b]"
                  onClick={e => { e.stopPropagation(); onRemoveShell(id) }}
                  title="Close"
                >✕</span>
              </button>
            ))}
          </div>
        )}

        {/* Agents — flat list with header + add button */}
        <button
          className="flex items-center gap-1 w-full px-[10px] py-[5px] bg-transparent border-none cursor-pointer select-none shrink-0 hover:bg-bg-hover"
          style={{ position: 'relative' }}
          ref={agentPickerRef}
          onClick={() => setAgentsCollapsed(v => !v)}
        >
          <span className="text-[9px] text-text-dim w-[10px] text-center shrink-0">{agentsCollapsed ? '▶' : '▼'}</span>
          <span className="text-[9px] uppercase tracking-[0.18em] text-text-dim shrink-0">Agents</span>
          <span
            className="ml-auto text-[14px] text-text-dim leading-none px-[2px] rounded-[2px] transition-colors duration-100 hover:text-accent cursor-pointer"
            onClick={e => { e.stopPropagation(); setShowAgentPicker(v => !v) }}
            title="New agent"
          >+</span>
          {showAgentPicker && (
            <div
              onClick={e => e.stopPropagation()}
              style={{
              position: 'absolute',
              top: '100%',
              right: 4,
              zIndex: 100,
              background: 'var(--bg-popup)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 4,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            }}>
              {availableModels.map(({ providerId, providerDisplayName, models }) => (
                <React.Fragment key={providerId}>
                  <div style={{
                    padding: '4px 14px 2px',
                    fontSize: '9px',
                    color: 'rgba(255,255,255,0.35)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    borderTop: providerId !== availableModels[0]?.providerId ? '1px solid rgba(255,255,255,0.08)' : undefined,
                    marginTop: providerId !== availableModels[0]?.providerId ? 2 : 0,
                  }}>
                    {providerDisplayName}
                  </div>
                  {models.map(m => (
                    <button
                      key={m.id}
                      onClick={e => { e.stopPropagation(); onAddAgent(m.id); setShowAgentPicker(false) }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        padding: '6px 14px',
                        cursor: 'pointer',
                        fontSize: '11px',
                        color: m.color,
                        textAlign: 'left',
                        whiteSpace: 'nowrap',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.07)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      {m.label}
                    </button>
                  ))}
                </React.Fragment>
              ))}
            </div>
          )}
        </button>

        {!agentsCollapsed && (
        <div>
          {buildingAgentIds.map(id => {
            const note = agentNotes.get(id) ?? ''
            const isEditingNote = editingNoteId === id
            const modelId = agentModels.get(id)
            return (
              <div key={id} className="relative group/agent">
                <button
                  data-testid={`dm-sidebar-agent-${id}`}
                  data-active={activeView === 'agent' && activeAgentId === id ? 'true' : undefined}
                  className="dm-row flex items-center gap-2 w-full px-[10px] py-[5px] border-none cursor-pointer text-left select-none [-webkit-tap-highlight-color:transparent] [touch-action:manipulation] relative group"
                  onClick={() => onSelectAgent(id)}
                >
                  <div className="relative shrink-0 w-[26px] h-[26px] flex items-center justify-center">
                    <AgentIcon palette={agentPalettes.get(id) ?? 0} hueShift={agentHueShiftMap?.get(id) ?? 0} />
                    <span className={`absolute bottom-0 right-0 w-[7px] h-[7px] rounded-full border-[1.5px] border-bg-card${agentStatusMap.has(id) ? ' bg-accent' : ' bg-text-dim'}`} />
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col gap-[1px]">
                    <span className={`text-[11px] whitespace-nowrap overflow-hidden text-ellipsis flex items-center gap-[5px]${activeView === 'agent' && activeAgentId === id ? ' text-text-bright' : ' text-text'}`}>
                      {agentNames.get(id) ?? `Agent ${id}`}
                      <ModelChip modelId={modelId} descriptor={modelId ? getChipDescriptor(modelId) : null} />
                    </span>
                    {agentStatusMap.get(id) && (
                      <span className={`text-[10px] whitespace-nowrap overflow-hidden text-ellipsis px-[5px] py-[1px] rounded-[3px] mt-[1px]${activeView === 'agent' && activeAgentId === id ? ' text-accent bg-[rgba(90,200,140,0.08)]' : ' text-text-muted bg-[rgba(255,255,255,0.04)]'}`}>
                        <StatusDisplay text={agentStatusMap.get(id)!} startedAt={agentStatusStartMap.get(id)} tokens={agentTokensMap.get(id)} />
                      </span>
                    )}
                    {note && !isEditingNote && (
                      <span className="text-[9px] text-text-dim whitespace-nowrap overflow-hidden text-ellipsis opacity-75 italic">{note}</span>
                    )}
                  </div>
                  <span
                    className="opacity-0 text-[11px] text-text-dim shrink-0 px-[3px] py-[2px] cursor-pointer leading-none transition-[opacity,color] duration-100 mr-[2px] group-hover/agent:opacity-100 hover:text-accent"
                    onClick={e => { e.stopPropagation(); onSetEditingNoteId(isEditingNote ? null : id) }}
                    title={note ? 'Edit note' : 'Add note'}
                  >✎</span>
                  <span
                    className="opacity-0 bg-transparent border-none text-text-dim text-[9px] cursor-pointer px-[3px] py-[2px] rounded-[2px] shrink-0 transition-[opacity,color] duration-100 leading-none group-hover:opacity-100 hover:text-[#c97b7b]"
                    onClick={e => { e.stopPropagation(); onRemoveAgent(id) }}
                    title="Close"
                  >✕</span>
                </button>
                {isEditingNote && (
                  <textarea
                    className="w-full min-h-[52px] max-h-[120px] resize-y bg-[rgba(255,255,255,0.04)] border-none border-t border-t-border border-b border-b-border text-text font-[inherit] text-[10px] leading-[1.5] pt-[6px] pr-[10px] pb-[6px] pl-[26px] outline-none block caret-accent placeholder:text-text-dim placeholder:italic focus:bg-[rgba(92,154,125,0.04)] focus:border-t-accent-dim focus:border-b-accent-dim"
                    autoFocus
                    value={note}
                    placeholder="What's this agent working on?"
                    onChange={e => onSetAgentNotes(prev => new Map(prev).set(id, e.target.value))}
                    onBlur={() => onSetEditingNoteId(null)}
                    onKeyDown={e => { if (e.key === 'Escape') onSetEditingNoteId(null) }}
                  />
                )}
              </div>
            )
          })}
        </div>
        )}

        {/* Offline permanent employees grouped by floor */}
        {inactiveEmployeesByFloor.length > 0 && (
          <OfflineEmployeesSection groups={inactiveEmployeesByFloor} onStartEmployee={onStartEmployee} disabled={!officeReady} getChipDescriptor={getChipDescriptor} />
        )}
      </div>

      {/* dm-sidebar-footer */}
      <div id="dm-sidebar-footer" className="border-t border-border shrink-0 flex flex-col relative">
        {renderMiniMap && (
          <div className="pt-[2px] px-[6px] pb-[6px] flex justify-center overflow-hidden [&>div]:max-w-full [&>div]:box-border [&_canvas]:max-w-full [&_canvas]:h-auto! [&_canvas]:block">
            {renderMiniMap()}
          </div>
        )}
      </div>
    </>
  )
}

// ── Quick Actions Section ────────────────────────────────────

interface QuickActionsSectionProps {
  actions: QuickAction[]
  onAdd: (title: string, description: string, type: 'ai' | 'terminal', command?: string) => void
  onRemove: (id: string) => void
  onUpdate: (id: string, title: string, description: string, type: 'ai' | 'terminal', command?: string) => void
  onRun: (action: QuickAction) => void
}

function QuickActionsSection({ actions, onAdd, onRemove, onUpdate, onRun }: QuickActionsSectionProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formTitle, setFormTitle] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formType, setFormType] = useState<'ai' | 'terminal'>('ai')
  const [formCommand, setFormCommand] = useState('')
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null)

  const handleSubmit = () => {
    const title = formTitle.trim()
    if (!title) return
    if (formType === 'terminal') {
      const cmd = formCommand.trim()
      if (!cmd) return
      if (editingId) {
        onUpdate(editingId, title, formDesc.trim(), 'terminal', cmd)
      } else {
        onAdd(title, formDesc.trim(), 'terminal', cmd)
      }
    } else {
      const desc = formDesc.trim()
      if (!desc) return
      if (editingId) {
        onUpdate(editingId, title, desc, 'ai')
      } else {
        onAdd(title, desc, 'ai')
      }
    }
    setFormTitle('')
    setFormDesc('')
    setFormCommand('')
    setFormType('ai')
    setShowForm(false)
    setEditingId(null)
  }

  const handleEdit = (action: QuickAction, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingId(action.id)
    setFormTitle(action.title)
    setFormDesc(action.description)
    setFormType(action.type || 'ai')
    setFormCommand(action.command || '')
    setShowForm(true)
  }

  const handleCancel = () => {
    setShowForm(false)
    setEditingId(null)
    setFormTitle('')
    setFormDesc('')
    setFormCommand('')
    setFormType('ai')
  }

  return (
    <>
      <button className="flex items-center gap-1 w-full px-[10px] py-[5px] bg-transparent border-none cursor-pointer select-none shrink-0 hover:bg-bg-hover" onClick={() => setCollapsed(v => !v)}>
        <span className="text-[9px] text-text-dim w-[10px] text-center shrink-0">{collapsed ? '▶' : '▼'}</span>
        <span className="text-[9px] uppercase tracking-[0.18em] text-text-dim shrink-0">Quick Actions</span>
        <span
          className="ml-auto text-[14px] text-text-dim leading-none px-[2px] rounded-[2px] transition-colors duration-100 hover:text-accent"
          onClick={e => { e.stopPropagation(); setEditingId(null); setFormTitle(''); setFormDesc(''); setShowForm(true) }}
          title="Add quick action"
        >+</span>
      </button>
      {!collapsed && (
        <div className="pb-1">
          {actions.length === 0 && !showForm && (
            <div className="py-[6px] px-2 pl-6 text-[10px] text-text-dim italic">
              No quick actions
            </div>
          )}
          {actions.map(action => (
            <button
              key={action.id}
              className="flex items-center gap-2 w-full py-[5px] px-2 pl-6 bg-transparent border-none text-text text-[10px] font-[inherit] cursor-pointer text-left transition-[background] duration-100 relative hover:bg-bg-hover group"
              onClick={() => onRun(action)}
              title={action.type === 'terminal' ? (action.command || action.title) : (action.description || action.title)}
            >
              {action.type === 'terminal'
                ? <TerminalIcon size={11} className="shrink-0 text-[#4ec990] opacity-80" />
                : <QuickActionIcon className="shrink-0 text-accent opacity-70" />
              }
              <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{action.title}</span>
              <span
                className="opacity-0 shrink-0 text-text-dim cursor-pointer text-[10px] transition-[opacity,color] duration-100 flex items-center group-hover:opacity-100 hover:text-accent"
                onClick={e => handleEdit(action, e)}
                title="Edit"
              >
                <EditSmallIcon />
              </span>
              {pendingRemoveId === action.id ? (
                <span className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                  <span
                    className="text-[9px] text-[#ee5555] cursor-pointer px-[3px] py-[1px] rounded hover:bg-[rgba(238,85,85,0.15)]"
                    onClick={e => { e.stopPropagation(); onRemove(action.id); setPendingRemoveId(null) }}
                  >Remove</span>
                  <span
                    className="text-[9px] text-text-dim cursor-pointer px-[3px] py-[1px] rounded hover:bg-bg-hover"
                    onClick={e => { e.stopPropagation(); setPendingRemoveId(null) }}
                  >Cancel</span>
                </span>
              ) : (
                <span
                  className="opacity-0 shrink-0 text-text-dim cursor-pointer text-[10px] transition-[opacity,color] duration-100 flex items-center group-hover:opacity-100 hover:text-[#ee5555]"
                  onClick={e => { e.stopPropagation(); setPendingRemoveId(action.id) }}
                  title="Remove"
                >✕</span>
              )}
            </button>
          ))}
          {showForm && (
            <div className="py-[6px] px-2 pl-6 flex flex-col gap-1">
              <div className="flex gap-1">
                {(['ai', 'terminal'] as const).map(t => (
                  <button
                    key={t}
                    type="button"
                    className={`flex-1 flex items-center justify-center gap-1 py-[4px] rounded text-[10px] font-semibold cursor-pointer transition-all duration-100 border ${
                      formType === t
                        ? t === 'terminal'
                          ? 'border-[#4ec990] bg-[#4ec990] text-white'
                          : 'border-accent bg-accent text-white'
                        : 'border-border bg-bg-input text-text-dim hover:text-text hover:bg-bg-hover'
                    }`}
                    onClick={() => setFormType(t)}
                  >
                    {t === 'terminal'
                      ? <><TerminalIcon size={10} /><span>Terminal</span></>
                      : <><QuickActionIcon size={10} /><span>AI Agent</span></>
                    }
                  </button>
                ))}
              </div>
              <input
                className="w-full py-[5px] px-2 bg-bg border border-border rounded text-text text-[10px] font-[inherit] outline-none resize-y focus:border-accent-dim"
                autoFocus
                placeholder="Action title"
                value={formTitle}
                onChange={e => setFormTitle(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && formType === 'terminal') handleSubmit()
                  if (e.key === 'Escape') handleCancel()
                }}
              />
              {formType === 'terminal' ? (
                <input
                  className="w-full py-[5px] px-2 bg-bg border border-border rounded text-text text-[10px] font-mono outline-none focus:border-[#4ec990]"
                  placeholder="Command (e.g. cd terminal-app && npm run dev)"
                  value={formCommand}
                  onChange={e => setFormCommand(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSubmit()
                    if (e.key === 'Escape') handleCancel()
                  }}
                />
              ) : (
                <textarea
                  className="w-full py-[5px] px-2 bg-bg border border-border rounded text-text text-[10px] font-[inherit] outline-none resize-y min-h-12 focus:border-accent-dim"
                  placeholder="Prompt / description (required)"
                  value={formDesc}
                  onChange={e => setFormDesc(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Escape') handleCancel()
                  }}
                  rows={3}
                />
              )}
              <div className="flex gap-1 justify-end">
                <button className="py-[3px] px-[10px] border border-accent-dim rounded text-[10px] font-[inherit] cursor-pointer bg-accent-dim text-text-bright transition-[background,color] duration-100 hover:bg-accent" onClick={handleSubmit}>
                  {editingId ? 'Update' : 'Add'}
                </button>
                <button className="py-[3px] px-[10px] border border-border rounded text-[10px] font-[inherit] cursor-pointer bg-transparent text-text-dim transition-[background,color] duration-100 hover:text-text hover:bg-bg-hover" onClick={handleCancel}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}

// ── Offline Employees Section ───────────────────────────────

function OfflineEmployeesSection({ groups, onStartEmployee, disabled, getChipDescriptor }: {
  groups: InactiveFloorGroup[]
  onStartEmployee?: (employeeId: string) => void
  disabled?: boolean
  getChipDescriptor: (modelId: string) => ChipDescriptor | null
}) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <>
      <button className="flex items-center gap-1 w-full px-[10px] py-[5px] bg-transparent border-none cursor-pointer select-none shrink-0 hover:bg-bg-hover" onClick={() => setCollapsed(v => !v)}>
        <span className="text-[9px] text-text-dim w-[10px] text-center shrink-0">{collapsed ? '▶' : '▼'}</span>
        <span className="text-[9px] uppercase tracking-[0.18em] text-text-dim shrink-0">Offline</span>
        {disabled && <span className="text-[8px] text-text-dim opacity-50 ml-1">loading…</span>}
      </button>
      {!collapsed && groups.map(group => (
        <div key={group.floorLabel}>
          <div className="px-[10px] pl-[22px] py-[2px] text-[9px] uppercase tracking-[0.18em] text-text-dim opacity-50">
            {group.floorLabel}
          </div>
          {group.employees.map(emp => (
            <OfflineEmployeeRow key={emp.id} id={emp.id} name={emp.name} palette={emp.palette} hueShift={emp.hueShift} model={emp.model} onClick={onStartEmployee} disabled={disabled} getChipDescriptor={getChipDescriptor} />
          ))}
        </div>
      ))}
    </>
  )
}

function OfflineEmployeeRow({ id, name, palette, hueShift, model, onClick, disabled, getChipDescriptor }: {
  id: string
  name: string
  palette: number
  hueShift?: number
  model?: string
  onClick?: (id: string) => void
  disabled?: boolean
  getChipDescriptor: (modelId: string) => ChipDescriptor | null
}) {
  return (
    <button
      className="flex items-center gap-2 w-full px-[10px] py-[5px] bg-transparent border-none text-left transition-[background] duration-100 select-none hover:bg-bg-hover"
      style={{ cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1 }}
      onClick={() => !disabled && onClick?.(id)}
      title={disabled ? 'Office is loading…' : `Start session for ${name}`}
    >
      <div className="relative shrink-0 w-[26px] h-[26px] flex items-center justify-center opacity-50">
        <AgentIcon palette={palette} hueShift={hueShift} />
        <span className="absolute bottom-0 right-0 w-[7px] h-[7px] rounded-full border-[1.5px] border-bg-card bg-text-dim" />
      </div>
      <div className="flex-1 min-w-0 flex items-center gap-[5px]">
        <span className="text-[11px] text-text-dim whitespace-nowrap overflow-hidden text-ellipsis">{name}</span>
        <ModelChip modelId={model} descriptor={model ? getChipDescriptor(model) : null} muted />
      </div>
    </button>
  )
}
