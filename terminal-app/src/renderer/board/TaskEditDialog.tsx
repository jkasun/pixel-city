import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { Task, AgentOption } from './boardTypes'
import { CharacterAvatar } from '../CharacterAvatar.js'

marked.setOptions({ breaks: true, gfm: true })
import { initials, formatTimestamp } from './boardTypes'

export function AgentPicker({ agents, current, onSelect, onClose, anchorRef }: {
  agents: AgentOption[]
  current?: string
  onSelect: (agentKey: string | undefined) => void
  onClose: () => void
  anchorRef?: React.RefObject<HTMLElement | null>
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [fixedStyle, setFixedStyle] = useState<React.CSSProperties | undefined>(undefined)

  // When inside the detail overlay, position fixed relative to the anchor button
  useEffect(() => {
    if (!anchorRef?.current || !ref.current) return
    const btnRect = anchorRef.current.getBoundingClientRect()
    const pickerH = ref.current.offsetHeight
    const spaceBelow = window.innerHeight - btnRect.bottom - 8
    const top = spaceBelow >= pickerH
      ? btnRect.bottom + 4
      : Math.max(4, btnRect.top - pickerH - 4)
    setFixedStyle({ position: 'fixed', top, left: btnRect.left, right: 'auto', bottom: 'auto' })
  }, [anchorRef])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const employees = agents.filter(a => a.type === 'employee')
  const spawned = agents.filter(a => a.type === 'spawned')
  const temp = agents.filter(a => a.type === 'temp')

  const renderItem = (agent: AgentOption) => (
    <button
      key={agent.key}
      className={`flex items-center gap-[7px] w-full px-[6px] py-1 bg-none border-none rounded-[3px] cursor-pointer font-[inherit] transition-[background] duration-100 hover:bg-bg-hover${current === agent.key ? ' bg-[rgba(92,154,125,0.1)]' : ''}`}
      onClick={(e) => { e.stopPropagation(); onSelect(agent.key) }}
    >
      {agent.palette != null
        ? <CharacterAvatar palette={agent.palette} size={18} style={{ border: `1.5px solid ${agent.color}` }} />
        : <span className="w-4 h-4 rounded-full border-[1.5px] border-border bg-bg flex items-center justify-center text-[6px] font-semibold text-text-dim shrink-0" style={{ borderColor: agent.color }}>{initials(agent.name)}</span>
      }
      <span className={`text-[9.5px] whitespace-nowrap${current === agent.key ? ' text-accent' : ' text-text'}`}>{agent.name}</span>
      <span className="ml-auto text-[7px] uppercase tracking-[0.06em] text-text-dim opacity-60">{agent.type === 'employee' ? 'emp' : agent.type === 'spawned' ? 'live' : agent.key === 'temp:opus' ? 'opus' : 'sonnet'}</span>
    </button>
  )

  return (
    <div
      className="absolute top-[calc(100%+4px)] left-0 z-50 min-w-[130px] max-h-[200px] overflow-y-auto bg-bg-card border border-border rounded-[5px] p-[3px] shadow-[0_6px_20px_rgba(0,0,0,0.5)] [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:rounded-[2px]"
      ref={ref}
      style={fixedStyle}
    >
      {employees.length > 0 && (
        <>
          <div className="text-[8px] uppercase tracking-[0.1em] text-text-dim px-[6px] pt-[5px] pb-[2px]">Employees</div>
          {employees.map(renderItem)}
        </>
      )}
      {spawned.length > 0 && (
        <>
          <div className="text-[8px] uppercase tracking-[0.1em] text-text-dim px-[6px] pt-[5px] pb-[2px]">Active Agents</div>
          {spawned.map(renderItem)}
        </>
      )}
      {temp.length > 0 && (
        <>
          <div className="text-[8px] uppercase tracking-[0.1em] text-text-dim px-[6px] pt-[5px] pb-[2px]">Create New</div>
          {temp.map(renderItem)}
        </>
      )}
      {agents.length === 0 && (
        <div className="text-[8px] uppercase tracking-[0.1em] text-text-dim" style={{ padding: '8px 6px' }}>No agents available</div>
      )}
      {current && (
        <button
          className="flex items-center gap-[7px] w-full px-[6px] py-[5px] bg-none border-none border-t border-border rounded-[0_0_3px_3px] mt-0.5 cursor-pointer font-[inherit] transition-[background] duration-100 hover:bg-bg-hover"
          onClick={(e) => { e.stopPropagation(); onSelect(undefined) }}
        >
          <span className="w-4 h-4 rounded-full border-[1.5px] border-border bg-bg flex items-center justify-center text-[6px] font-semibold text-text-dim shrink-0">--</span>
          <span className="text-[9.5px] whitespace-nowrap text-text-dim">Unassign</span>
        </button>
      )}
    </div>
  )
}

interface TaskDetailProps {
  task: Task
  columnKey: string
  agents: AgentOption[]
  onClose: () => void
  onUpdate: (taskId: string, colKey: string, updates: Partial<Task>) => void
  onAssign: (taskId: string, colKey: string, agentId: string | undefined) => void
  onDelete: (taskId: string, colKey: string) => void
}

export function TaskDetail({
  task,
  columnKey,
  agents,
  onClose,
  onUpdate,
  onAssign,
  onDelete,
}: TaskDetailProps) {
  const [description, setDescription] = useState(task.description ?? '')
  const [title, setTitle] = useState(task.title)
  const [showPicker, setShowPicker] = useState(false)
  const [editingDesc, setEditingDesc] = useState(!task.description)
  const descHtml = useMemo(() => DOMPurify.sanitize(marked.parse(description || '') as string), [description])
  const overlayRef = useRef<HTMLDivElement>(null)
  const assigneeBtnRef = useRef<HTMLButtonElement>(null)
  const agent = agents.find(a => a.key === task.assignee)

  const handleSave = useCallback(() => {
    onUpdate(task.id, columnKey, {
      title: title.trim() || task.title,
      description: description.trim() || undefined,
    })
    onClose()
  }, [task.id, columnKey, title, description, onUpdate, onClose])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleSave()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [handleSave])

  return (
    <div
      data-testid="board-task-dialog"
      className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center"
      ref={overlayRef}
      onMouseDown={(e) => { if (e.target === overlayRef.current) handleSave() }}
    >
      <div className="w-[520px] max-h-[85vh] overflow-y-auto bg-bg-card border border-border rounded-[6px] p-4 flex flex-col gap-3 shadow-[0_12px_40px_rgba(0,0,0,0.6)] [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:rounded-[2px]">

        {/* header */}
        <div className="flex items-center justify-between">
          <span className="text-[9px] text-text-dim tabular-nums tracking-[0.02em]">{task.id}</span>
          <button
            className="bg-none border-none text-text-dim font-[inherit] text-[12px] cursor-pointer px-[5px] py-0.5 leading-none transition-[color] duration-100 hover:text-text"
            onClick={handleSave}
          >x</button>
        </div>

        {/* title input */}
        <input
          data-testid="board-task-title-input"
          className="bg-transparent border-none border-b border-b-transparent text-text-bright font-[inherit] text-[13px] font-semibold py-0.5 outline-none caret-accent w-full transition-[border-color] duration-[0.12s] placeholder:text-text-dim placeholder:font-normal focus:border-b-accent-dim"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Task title..."
        />

        {/* description section */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label className="text-[8px] uppercase tracking-[0.1em] text-text-dim">Description</label>
            <button
              className="bg-none border border-border text-text-dim font-[inherit] text-[8px] px-2 py-0.5 rounded-[3px] cursor-pointer transition-all duration-[0.12s] hover:text-text hover:border-text-dim"
              onClick={() => setEditingDesc(v => !v)}
            >{editingDesc ? 'Preview' : 'Edit'}</button>
          </div>
          {editingDesc ? (
            <textarea
              className="bg-white/[0.03] border border-border rounded-[4px] text-text font-[inherit] text-[10.5px] leading-[1.5] p-2 resize-y outline-none caret-accent min-h-[60px] transition-[border-color] duration-[0.12s] placeholder:text-text-dim focus:border-accent-dim [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:rounded-[2px]"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Add a description (markdown supported)..."
              rows={8}
            />
          ) : (
            <div
              className="bg-white/[0.03] border border-border rounded-[4px] px-3 py-[10px] text-[10.5px] leading-[1.6] text-text min-h-[80px] overflow-y-auto max-h-[300px] [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:rounded-[2px] [&_p]:mb-2 [&_p:last-child]:mb-0 [&_h1]:text-text-bright [&_h1]:mb-1.5 [&_h1]:text-[14px] [&_h1]:font-semibold [&_h2]:text-text-bright [&_h2]:mb-1.5 [&_h2]:text-[12px] [&_h2]:font-semibold [&_h3]:text-text-bright [&_h3]:mb-1.5 [&_h3]:text-[11px] [&_h3]:font-semibold [&_ul]:mb-2 [&_ul]:pl-[18px] [&_ol]:mb-2 [&_ol]:pl-[18px] [&_li]:mb-0.5 [&_code]:bg-white/[0.06] [&_code]:px-1 [&_code]:rounded-[3px] [&_code]:text-[10px] [&_pre]:bg-black/30 [&_pre]:rounded-[4px] [&_pre]:p-2 [&_pre]:mb-2 [&_pre]:overflow-x-auto [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_blockquote]:border-l-2 [&_blockquote]:border-accent-dim [&_blockquote]:mb-2 [&_blockquote]:py-0.5 [&_blockquote]:px-[10px] [&_blockquote]:text-text-muted [&_a]:text-accent [&_a]:no-underline [&_a:hover]:underline [&_hr]:border-none [&_hr]:border-t [&_hr]:border-border [&_hr]:my-2 [&_input[type=checkbox]]:mr-1"
              dangerouslySetInnerHTML={{ __html: descHtml }}
              onClick={() => { if (!description) setEditingDesc(true) }}
            />
          )}
        </div>

        {/* assignee row */}
        <div className="flex gap-3">
          <div className="flex-1 flex flex-col gap-1">
            <label className="text-[8px] uppercase tracking-[0.1em] text-text-dim">Assignee</label>
            <div className="relative">
              <button
                ref={assigneeBtnRef}
                className={`bg-bg border-[1.5px] border-border text-text-muted font-[inherit] text-[9px] px-2 py-1 cursor-pointer rounded-[3px] transition-[border-color] duration-100 hover:border-accent-dim${!task.assignee ? ' border-dashed text-text-dim' : ''}`}
                style={agent ? { borderColor: agent.color } : undefined}
                onClick={() => setShowPicker(v => !v)}
              >
                {agent ? agent.name : 'Unassigned'}
              </button>
              {showPicker && (
                <AgentPicker
                  agents={agents}
                  current={task.assignee}
                  onSelect={(id) => { onAssign(task.id, columnKey, id); setShowPicker(false) }}
                  onClose={() => setShowPicker(false)}
                  anchorRef={assigneeBtnRef}
                />
              )}
            </div>
          </div>
        </div>

        {/* tags */}
        {task.tags.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-[8px] uppercase tracking-[0.1em] text-text-dim">Tags</label>
            <div className="flex gap-1 flex-wrap">
              {task.tags.map(tag => (
                <span
                  key={tag.label}
                  className={[
                    'text-[8px] tracking-[0.04em] px-1 rounded-[2px] border leading-[1.6]',
                    tag.color === 'accent' ? 'text-accent border-accent-dim bg-bg-card' :
                    tag.color === 'warm'   ? 'text-[#c49a6c] border-[#9a7d5c] bg-bg-card' :
                    tag.color === 'error'  ? 'text-[#c97b7b] border-[#6b3a3a] bg-bg-card' :
                                            'text-text-dim border-border bg-bg-card',
                  ].join(' ')}
                  data-color={tag.color}
                >{tag.label}</span>
              ))}
            </div>
          </div>
        )}

        {/* changelog */}
        {task.changelog && task.changelog.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-[8px] uppercase tracking-[0.1em] text-text-dim">Activity Log</label>
            <div className="flex flex-col gap-1 max-h-[160px] overflow-y-auto pr-1">
              {[...task.changelog].reverse().map((entry, i) => (
                <div key={i} className="flex items-center gap-[6px] text-[11px] text-[#888] py-[3px] border-b border-white/[0.04]">
                  <span className={[
                    'text-[9px] px-[5px] py-px rounded-[3px] font-semibold uppercase shrink-0',
                    entry.source === 'manual' ? 'bg-[rgba(90,200,140,0.15)] text-[#5ac88c]' :
                    entry.source === 'mcp'    ? 'bg-[rgba(106,155,196,0.15)] text-[#6a9bc4]' : '',
                  ].filter(Boolean).join(' ')}>{entry.source}</span>
                  <span className="text-[#aaa] flex-1 min-w-0">
                    {entry.action === 'created' && `Created in ${entry.to}`}
                    {entry.action === 'moved' && `Moved ${entry.from} → ${entry.to}`}
                    {entry.action === 'updated' && 'Updated'}
                    {entry.action === 'assigned' && `Assigned to ${entry.to ?? 'none'}`}
                    {!['created', 'moved', 'updated', 'assigned'].includes(entry.action) && entry.action}
                  </span>
                  <span className="text-[#777] shrink-0">by {entry.by}</span>
                  <span className="text-[#555] shrink-0 text-[10px]">{formatTimestamp(entry.at)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* footer */}
        <div className="flex items-end justify-between pt-2 border-t border-border">
          <div className="flex gap-3 text-[8px] text-text-dim">
            <span>Created {formatTimestamp(task.createdAt)}{task.createdBy ? ` by ${task.createdBy}` : ''}</span>
            {task.updatedAt !== task.createdAt && <span>Updated {formatTimestamp(task.updatedAt)}</span>}
          </div>
          <div className="flex gap-[6px]">
            {task.type !== 'story' && (
              <button
                className="bg-none border border-border text-text-dim text-[8px] px-[10px] py-[3px] rounded-[3px] cursor-pointer transition-all duration-150 hover:border-[#7c6f9b] hover:text-[#a99bc7]"
                onClick={() => {
                  onUpdate(task.id, columnKey, {
                    type: 'story',
                    subtasks: { columns: { planning: [], planned: [], todo: [], progress: [], testing: [], closed: [], archived: [], backlog: [] }, nextId: 1 },
                  })
                  onClose()
                }}
              >Convert to Story</button>
            )}
            <button
              data-testid="board-task-delete-btn"
              className="bg-none border border-border text-text-dim text-[8px] px-[10px] py-[3px] rounded-[3px] cursor-pointer transition-all duration-150 hover:border-[#c97b7b] hover:text-[#c97b7b]"
              onClick={() => { onDelete(task.id, columnKey); onClose() }}
            >Delete</button>
          </div>
        </div>
      </div>
    </div>
  )
}
