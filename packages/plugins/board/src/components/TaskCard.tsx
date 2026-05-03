import React from 'react'
import type { Task } from '../board/types.js'

export function TaskCard({
  task, colKey, onDragStart, onDelete, onEdit,
}: {
  task: Task
  colKey: string
  onDragStart: (taskId: string, fromCol: string) => void
  onDelete: (colKey: string, taskId: string) => void
  onEdit: (colKey: string, task: Task) => void
}) {
  return (
    <div
      data-testid={`board-task-card-${task.id}`}
      draggable
      onDragStart={(e) => {
        onDragStart(task.id, colKey)
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', task.id)
      }}
      onClick={() => onEdit(colKey, task)}
      style={{
        padding: '6px 7px', background: 'var(--bg)', border: '1px solid var(--border)',
        borderRadius: 4, cursor: 'grab', fontSize: 11, display: 'flex', flexDirection: 'column', gap: 3,
        transition: 'border-color 0.12s, background 0.12s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-dim, var(--text-dim))'; e.currentTarget.style.background = 'var(--bg-hover, var(--bg))' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg)' }}
    >
      {/* ID row */}
      <div style={{ fontSize: 8, color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums', letterSpacing: '0.02em' }}>
        {task.id}
      </div>

      {/* Title */}
      <div data-testid={`board-task-title-${task.id}`} style={{ fontSize: 10.5, color: 'var(--text-bright)', lineHeight: 1.35 }}>{task.title}</div>

      {/* Description preview */}
      {task.description && (
        <div style={{
          fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.3,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {task.description}
        </div>
      )}

      {/* Tags */}
      {task.tags.length > 0 && (
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 1 }}>
          {task.tags.map((tag, i) => (
            <span key={i} style={{
              fontSize: 8, letterSpacing: '0.04em', padding: '0 4px', borderRadius: 2,
              border: '1px solid var(--border)', lineHeight: 1.6,
              background: 'var(--bg-card)', color: 'var(--text-dim)',
            }}>
              {tag.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
