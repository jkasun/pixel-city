import { useState, useRef, useEffect, useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { Task } from './boardTypes'
import { initials } from './boardTypes'
import { CharacterAvatar } from '../CharacterAvatar.js'
import { AgentPicker } from './TaskEditDialog'
import { useBoardContext } from './BoardContext'

interface CardProps {
  task: Task
  columnKey: string
  onCardClick?: (taskId: string, colKey: string) => void
}

export function Card({ task, columnKey, onCardClick }: CardProps) {
  const {
    agentOptions, draggingTaskId, assigneeWorkerStatusMap, highlightedTaskId,
    handleDragStart, handleAssign, handleOpenDetail,
    handleEditStoryDetail, handleDeleteTask, handleArchiveTask,
    handleSendToBacklog, handleRestoreFromBacklog,
  } = useBoardContext()

  const [showPicker, setShowPicker] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const ctxRef = useRef<HTMLDivElement>(null)
  const agent = agentOptions.find(a => a.key === task.assignee)

  // Resolve agent worker status (idle/working/tool)
  const workerStatus = task.assignee ? assigneeWorkerStatusMap.get(task.assignee) : undefined

  useEffect(() => {
    if (!ctxMenu) return
    const handler = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [ctxMenu])

  const isStory = task.type === 'story'
  const subtaskStats = useMemo(() => {
    if (!isStory || !task.subtasks?.columns) return null
    let total = 0
    let closed = 0
    for (const [col, tasks] of Object.entries(task.subtasks.columns)) {
      total += tasks.length
      if (col === 'closed') closed += tasks.length
    }
    return { total, closed }
  }, [isStory, task.subtasks])

  const descHtml = useMemo(() => {
    if (!task.description || !expanded) return ''
    return DOMPurify.sanitize(marked.parse(task.description) as string)
  }, [task.description, expanded])

  const isHighlighted = highlightedTaskId === task.id
  const isDragging = draggingTaskId === task.id

  return (
    <div
      data-testid={`board-task-card-${task.id}`}
      className={[
        // board-card kept for DOM queries in BoardContext (.board-card selector)
        'board-card group bg-bg border border-border rounded-[4px] px-[7px] py-[6px] cursor-grab active:cursor-grabbing transition-[border-color,background] duration-[0.12s] ease-[ease] relative',
        // story variant
        isStory ? 'border-l-[2px] border-l-[#7c6f9b]' : '',
        // hover
        'hover:border-accent-dim hover:bg-bg-hover',
        // dragging
        isDragging ? 'opacity-30' : '',
        // highlight animation
        isHighlighted ? 'animate-[board-card-highlight_3s_ease-out]' : '',
      ].filter(Boolean).join(' ')}
      data-task-id={task.id}
      draggable
      onClick={() => (onCardClick ?? handleOpenDetail)(task.id, columnKey)}
      onContextMenu={(e) => {
        e.preventDefault()
        setCtxMenu({ x: e.clientX, y: e.clientY })
      }}
      onDragStart={(e) => {
        handleDragStart(task.id, columnKey)
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', task.id)
      }}
    >
      {/* top row: avatar + title/id */}
      <div className="flex items-center gap-2">
        {/* assignee wrap */}
        <div className={`relative shrink-0${workerStatus === 'working' || workerStatus === 'tool' ? ' [&_.character-avatar]:animate-[agent-border-pulse_1.8s_ease-in-out_infinite] [&_.character-avatar]:border-[#5ac88c]!' : ''}`}>
          <button
            className={[
              'w-8 h-8 rounded-full bg-bg-hover border-[1.5px] border-border flex items-center justify-center text-[8px] text-text-dim font-semibold shrink-0 cursor-pointer p-0 font-[inherit] transition-[border-color,background] duration-[0.12s] overflow-hidden',
              'hover:border-accent-dim hover:bg-bg-card',
              // has character avatar: no border/bg
              '[&:has(.character-avatar)]:border-none [&:has(.character-avatar)]:bg-transparent',
              // empty: hidden by default, visible on parent card hover
              !task.assignee ? 'border-dashed text-text-dim opacity-0 text-[9px] group-hover:opacity-100' : '',
            ].filter(Boolean).join(' ')}
            style={agent ? { borderColor: agent.color } : undefined}
            onClick={(e) => { e.stopPropagation(); setShowPicker(v => !v) }}
            title={agent ? `Assigned to ${agent.name}${workerStatus ? ` (${workerStatus})` : ''}` : 'Assign agent'}
          >
            {agent ? (agent.palette != null ? <CharacterAvatar palette={agent.palette} size={32} style={{ border: `2px solid ${agent.color}` }} workerStatus={workerStatus} /> : initials(agent.name)) : '+'}
          </button>
          {showPicker && (
            <AgentPicker
              agents={agentOptions}
              current={task.assignee}
              onSelect={(id) => { handleAssign(task.id, columnKey, id); setShowPicker(false) }}
              onClose={() => setShowPicker(false)}
            />
          )}
        </div>

        {/* card header content */}
        <div className="flex-1 min-w-0">
          {/* id row */}
          <div className="text-[8px] text-text-dim tabular-nums tracking-[0.02em] mb-0.5">
            {isStory && (
              <span className="inline-block bg-[rgba(124,111,155,0.25)] text-[#a99bc7] text-[7px] px-1 rounded-[2px] mr-1 uppercase tracking-[0.05em]">story</span>
            )}
            {task.id}
          </div>
          {/* title */}
          <div data-testid={`board-task-title-${task.id}`} className="text-[10.5px] text-text-bright leading-[1.35]">{task.title}</div>
          {/* collapsed description (single line) */}
          {task.description && !expanded && (
            <div className="mt-[3px] flex items-center gap-1">
              <div className="text-[9px] text-text-dim leading-[1.3] overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0">{task.description}</div>
              <button
                className="shrink-0 bg-none border-none text-accent text-[8px] cursor-pointer p-0 font-[inherit] opacity-60 hover:opacity-100 transition-opacity duration-100"
                onClick={(e) => { e.stopPropagation(); setExpanded(true) }}
              >more</button>
            </div>
          )}
          {/* meta: tags */}
          <div className="flex items-center gap-1 flex-wrap mt-[3px]">
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
      </div>

      {/* expanded description — full width below the top row, rendered as markdown */}
      {task.description && expanded && (
        <div className="mt-[5px] pt-[5px] border-t border-border">
          <div
            className="text-[9px] text-text-dim leading-[1.5] break-words [&_p]:mb-1.5 [&_p:last-child]:mb-0 [&_h1]:text-text-bright [&_h1]:mb-1 [&_h1]:text-[11px] [&_h1]:font-semibold [&_h2]:text-text-bright [&_h2]:mb-1 [&_h2]:text-[10px] [&_h2]:font-semibold [&_h3]:text-text-bright [&_h3]:mb-1 [&_h3]:text-[9.5px] [&_h3]:font-semibold [&_ul]:mb-1.5 [&_ul]:pl-3 [&_ol]:mb-1.5 [&_ol]:pl-3 [&_li]:mb-0.5 [&_code]:bg-white/[0.06] [&_code]:px-0.5 [&_code]:rounded-[2px] [&_code]:text-[8px] [&_pre]:bg-black/30 [&_pre]:rounded-[3px] [&_pre]:p-1.5 [&_pre]:mb-1.5 [&_pre]:overflow-x-auto [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_blockquote]:border-l-2 [&_blockquote]:border-accent-dim [&_blockquote]:mb-1.5 [&_blockquote]:py-0.5 [&_blockquote]:px-2 [&_blockquote]:text-text-muted [&_a]:text-accent [&_a]:no-underline [&_a:hover]:underline [&_hr]:border-none [&_hr]:border-t [&_hr]:border-border [&_hr]:my-1.5 [&_input[type=checkbox]]:mr-0.5"
            dangerouslySetInnerHTML={{ __html: descHtml }}
          />
          <button
            className="bg-none border-none text-accent text-[8px] cursor-pointer p-0 mt-[3px] font-[inherit] opacity-60 hover:opacity-100 transition-opacity duration-100"
            onClick={(e) => { e.stopPropagation(); setExpanded(false) }}
          >show less</button>
        </div>
      )}

      {/* subtask progress bar */}
      {subtaskStats && subtaskStats.total > 0 && (
        <div className="relative h-3 bg-white/[0.04] rounded-[3px] mt-1 overflow-hidden">
          <div
            className="absolute top-0 left-0 h-full bg-[rgba(90,200,140,0.3)] rounded-[3px] transition-[width] duration-200"
            style={{ width: `${(subtaskStats.closed / subtaskStats.total) * 100}%` }}
          />
          <span className="relative z-[1] flex items-center justify-center h-full text-[7px] text-text-dim">{subtaskStats.closed}/{subtaskStats.total}</span>
        </div>
      )}

      {/* context menu */}
      {ctxMenu && (
        <div
          ref={ctxRef}
          className="fixed z-[200] min-w-[100px] bg-bg-card border border-border rounded-[5px] p-[3px] shadow-[0_6px_20px_rgba(0,0,0,0.5)]"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
        >
          <button
            className="block w-full bg-none border-none text-text font-[inherit] text-[10px] px-[10px] py-[5px] text-left cursor-pointer rounded-[3px] transition-[background] duration-100 hover:bg-white/[0.06]"
            onClick={(e) => { e.stopPropagation(); handleOpenDetail(task.id, columnKey); setCtxMenu(null) }}
          >{isStory ? 'Open Board' : 'Open'}</button>
          {isStory && (
            <button
              className="block w-full bg-none border-none text-text font-[inherit] text-[10px] px-[10px] py-[5px] text-left cursor-pointer rounded-[3px] transition-[background] duration-100 hover:bg-white/[0.06]"
              onClick={(e) => { e.stopPropagation(); handleEditStoryDetail(task.id, columnKey); setCtxMenu(null) }}
            >Edit Details</button>
          )}
          {columnKey !== 'backlog' ? (
            <button
              className="block w-full bg-none border-none text-text font-[inherit] text-[10px] px-[10px] py-[5px] text-left cursor-pointer rounded-[3px] transition-[background] duration-100 hover:bg-white/[0.06]"
              onClick={(e) => { e.stopPropagation(); handleSendToBacklog(task.id, columnKey); setCtxMenu(null) }}
            >Send to Backlog</button>
          ) : (
            <button
              className="block w-full bg-none border-none text-text font-[inherit] text-[10px] px-[10px] py-[5px] text-left cursor-pointer rounded-[3px] transition-[background] duration-100 hover:bg-white/[0.06]"
              onClick={(e) => { e.stopPropagation(); handleRestoreFromBacklog(task.id, 'planning'); setCtxMenu(null) }}
            >Move to Board</button>
          )}
          <button
            className="block w-full bg-none border-none text-text font-[inherit] text-[10px] px-[10px] py-[5px] text-left cursor-pointer rounded-[3px] transition-[background] duration-100 hover:bg-white/[0.06]"
            onClick={(e) => { e.stopPropagation(); handleArchiveTask(task.id, columnKey); setCtxMenu(null) }}
          >Archive</button>
          <button
            className="block w-full bg-none border-none text-[#c97b7b] font-[inherit] text-[10px] px-[10px] py-[5px] text-left cursor-pointer rounded-[3px] transition-[background] duration-100 hover:bg-[rgba(201,123,123,0.12)]"
            onClick={(e) => { e.stopPropagation(); handleDeleteTask(task.id, columnKey); setCtxMenu(null) }}
          >Delete</button>
        </div>
      )}
    </div>
  )
}
