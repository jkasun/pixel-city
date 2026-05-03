import React, { useState, useRef, useEffect } from 'react'
import type { Task, Column } from './boardTypes'
import { Card } from './TaskCard'
import { useBoardContext } from './BoardContext'
import { useConfirm } from '../components/ConfirmDialog.js'

const CARD_CLICK_COLUMNS = new Set(['todo', 'progress', 'testing'])

// ── AddTaskForm ──

function AddTaskForm({ columnKey, onAdd, onCancel }: {
  columnKey: string
  onAdd: (title: string, type: 'task' | 'story') => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState<'task' | 'story'>('task')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const handleSubmit = () => {
    if (!title.trim()) return
    onAdd(title.trim(), type)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit()
    if (e.key === 'Escape') onCancel()
  }

  return (
    <div data-testid="board-add-task-form" className="flex flex-col gap-1 p-[5px] bg-bg border border-accent-dim rounded-[4px]">
      <input
        data-testid="board-add-task-title-input"
        ref={inputRef}
        className="bg-transparent border-none text-text-bright font-[inherit] text-[10.5px] px-0.5 py-[3px] outline-none caret-accent placeholder:text-text-dim"
        placeholder={type === 'story' ? 'Story title...' : 'Task title...'}
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="flex items-center gap-1">
        <select
          className="bg-bg-card border border-border text-text-muted font-[inherit] text-[8px] px-1 py-0.5 cursor-pointer appearance-none rounded-[2px]"
          value={type}
          onChange={e => setType(e.target.value as 'task' | 'story')}
        >
          <option value="task">Task</option>
          <option value="story">Story</option>
        </select>
        <div className="ml-auto flex gap-[3px]">
          <button data-testid="board-add-task-cancel-btn" className="bg-none border border-border text-text-dim font-[inherit] text-[8px] px-1.5 py-0.5 cursor-pointer rounded-[2px] transition-[color,border-color] duration-100 hover:text-text" onClick={onCancel}>Cancel</button>
          <button data-testid="board-add-task-submit-btn" className="bg-none border border-accent-dim text-accent font-[inherit] text-[8px] px-1.5 py-0.5 cursor-pointer rounded-[2px] transition-[color,border-color] duration-100 hover:not-disabled:bg-[rgba(92,154,125,0.1)] disabled:opacity-40 disabled:cursor-default" onClick={handleSubmit} disabled={!title.trim()}>Add</button>
        </div>
      </div>
    </div>
  )
}

// ── ColumnDrop ──

interface ColumnDropProps {
  col: Column
}

export function ColumnDrop({ col }: ColumnDropProps) {
  const confirm = useConfirm()
  const {
    columns,
    dragOverCol, dropIndex, draggingTaskId,
    handleDragOver, handleDragLeave, handleDrop,
    addingToCol, setAddingToCol, handleAddTask,
    handleArchiveAllClosed, handleOpenAgentSession,
  } = useBoardContext()

  const tasks = columns[col.key] ?? []
  const isOver = dragOverCol === col.key
  const isAdding = addingToCol === col.key

  return (
    <div data-testid={`board-column-${col.key}`} className="board-col min-w-[220px] max-w-[240px] shrink-0 flex flex-col bg-bg-card border border-border rounded-[6px] overflow-hidden">
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border shrink-0">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: col.color }} />
        <span data-testid={`board-column-label-${col.key}`} className="text-[9px] font-semibold tracking-[0.08em] uppercase text-text">{col.label}</span>
        <span data-testid={`board-column-count-${col.key}`} className="text-[9px] text-text-dim tabular-nums">{tasks.length}</span>
        {(col.key === 'planning' || col.key === 'planned' || col.key === 'backlog') && (
          <button data-testid={`board-task-create-btn-${col.key}`} className="ml-auto bg-none border-none text-text-dim text-[14px] cursor-pointer px-0.5 leading-none font-[inherit] transition-[color] duration-100 hover:text-accent" onClick={() => setAddingToCol(col.key)} title="Add task">+</button>
        )}
        {col.key === 'closed' && tasks.length > 0 && (
          <button data-testid="board-archive-all-btn" className="ml-auto bg-none border border-border text-text-dim text-[10px] cursor-pointer px-1.5 py-px leading-[1.4] font-[inherit] rounded-[3px] transition-[color,border-color] duration-100 hover:text-text hover:border-text-dim" onClick={async () => {
            const ok = await confirm({
              title: 'Archive all closed tasks',
              message: <>Archive all <strong>{tasks.length}</strong> closed tasks? They will be moved to the archive.</>,
              confirmLabel: 'Archive all',
              danger: false,
            })
            if (ok) handleArchiveAllClosed()
          }} title="Archive all closed tasks">Archive All</button>
        )}
      </div>
      <div
        data-testid={`board-task-list-${col.key}`}
        className={`flex-1 overflow-y-auto p-1 flex flex-col gap-1 [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:rounded-[2px]${isOver ? ' bg-[rgba(92,154,125,0.04)]' : ''}`}
        onDragOver={(e) => handleDragOver(e, col.key)}
        onDragLeave={() => handleDragLeave(col.key)}
        onDrop={(e) => { e.preventDefault(); handleDrop(col.key) }}
      >
        {tasks.length === 0 && !isOver
          ? <div className="py-4 px-[0.6rem] text-center text-[9px] text-text-dim opacity-60">Nothing here yet.</div>
          : tasks.map((task, i) => (
            <React.Fragment key={task.id}>
              {isOver && dropIndex === i && <div className="h-0.5 bg-accent rounded-[1px] mx-1 shrink-0 opacity-80" />}
              <Card
                task={task}
                columnKey={col.key}
                onCardClick={CARD_CLICK_COLUMNS.has(col.key) ? handleOpenAgentSession : undefined}
              />
            </React.Fragment>
          ))
        }
        {isOver && (dropIndex === null || dropIndex >= tasks.length) && <div className="h-0.5 bg-accent rounded-[1px] mx-1 shrink-0 opacity-80" />}
        {isAdding && (
          <AddTaskForm
            columnKey={col.key}
            onAdd={(title, type) => handleAddTask(col.key, title, type)}
            onCancel={() => setAddingToCol(null)}
          />
        )}
      </div>
    </div>
  )
}
