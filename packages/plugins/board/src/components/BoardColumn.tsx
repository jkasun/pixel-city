import React, { useState } from 'react'
import type { Task, Column } from '../board/types.js'
import { TaskCard } from './TaskCard.js'

interface DragState {
  taskId: string
  fromCol: string
}

const ADD_TASK_COLUMNS = new Set(['planning', 'planned', 'backlog'])

export function BoardColumn({
  col, tasks, dragState, onDragStart, onDrop, onDelete, onEdit, onCreateTask,
}: {
  col: Column
  tasks: Task[]
  dragState: DragState | null
  onDragStart: (taskId: string, fromCol: string) => void
  onDrop: (toCol: string, dropIndex: number | null) => void
  onDelete: (colKey: string, taskId: string) => void
  onEdit: (colKey: string, task: Task) => void
  onCreateTask: (colKey: string) => void
}) {
  const [dragOver, setDragOver] = useState(false)
  const showAdd = ADD_TASK_COLUMNS.has(col.key)

  return (
    <div
      data-testid={`board-column-${col.key}`}
      style={{
        minWidth: 220, maxWidth: 240, flex: '0 0 auto', display: 'flex', flexDirection: 'column',
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6,
        overflow: 'hidden',
      }}
    >
      {/* Column header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 8px', borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: col.color, flexShrink: 0 }} />
        <span data-testid={`board-column-label-${col.key}`} style={{
          fontSize: 9, fontWeight: 600, color: 'var(--text)', letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}>
          {col.label}
        </span>
        <span data-testid={`board-column-count-${col.key}`} style={{ fontSize: 9, color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>{tasks.length}</span>
        {showAdd && (
          <button
            data-testid={`board-task-create-btn-${col.key}`}
            onClick={() => onCreateTask(col.key)}
            style={{
              marginLeft: 'auto', fontSize: 14, lineHeight: 1, border: 'none', background: 'none',
              color: 'var(--text-dim)', cursor: 'pointer', padding: '0 2px', fontFamily: 'inherit',
              transition: 'color 0.1s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)' }}
            title={`Add task to ${col.label}`}
          >
            +
          </button>
        )}
      </div>

      {/* Task list */}
      <div
        data-testid={`board-task-list-${col.key}`}
        style={{
          flex: 1, overflowY: 'auto', padding: 4, display: 'flex', flexDirection: 'column', gap: 4,
          background: dragOver ? 'rgba(92,154,125,0.04)' : undefined,
          transition: 'background 0.12s',
        }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); onDrop(col.key, null) }}
      >
        {tasks.length === 0 && !dragOver ? (
          <div style={{ padding: '16px 10px', textAlign: 'center', fontSize: 9, color: 'var(--text-dim)', opacity: 0.6 }}>
            Nothing here yet.
          </div>
        ) : (
          tasks.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              colKey={col.key}
              onDragStart={onDragStart}
              onDelete={onDelete}
              onEdit={onEdit}
            />
          ))
        )}
      </div>
    </div>
  )
}
