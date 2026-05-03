import React, { useState, useEffect, useRef } from 'react'

export function TaskDialog({
  mode, initial, onSave, onCancel,
}: {
  mode: 'create' | 'edit'
  initial: { title: string; description: string; colKey: string }
  onSave: (data: { title: string; description: string }) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(initial.title)
  const [description, setDescription] = useState(initial.description)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    onSave({ title: title.trim(), description: description.trim() })
  }

  return (
    <div data-testid="board-task-dialog" style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }} onClick={onCancel}>
      <form
        onSubmit={handleSubmit}
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
          padding: 24, minWidth: 360, display: 'flex', flexDirection: 'column', gap: 14,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text-bright)' }}>
          {mode === 'create' ? 'New Task' : 'Edit Task'}
        </h3>

        <input
          data-testid="board-task-title-input"
          ref={inputRef}
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Task title"
          style={{
            padding: '8px 10px', fontSize: 12, border: '1px solid var(--border)',
            background: 'var(--bg-input)', color: 'var(--text-bright)', borderRadius: 6,
            outline: 'none',
          }}
        />

        <textarea
          data-testid="board-task-description-input"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Description (optional)"
          rows={3}
          style={{
            padding: '8px 10px', fontSize: 11, border: '1px solid var(--border)',
            background: 'var(--bg-input)', color: 'var(--text-bright)', borderRadius: 6,
            outline: 'none', resize: 'vertical', fontFamily: 'inherit',
          }}
        />

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            data-testid="board-task-cancel-btn"
            type="button"
            onClick={onCancel}
            style={{
              fontSize: 11, padding: '6px 14px', border: '1px solid var(--border)',
              background: 'var(--bg-input)', color: 'var(--text-muted)', cursor: 'pointer',
              borderRadius: 5,
            }}
          >
            Cancel
          </button>
          <button
            data-testid="board-task-save-btn"
            type="submit"
            style={{
              fontSize: 11, padding: '6px 14px', border: 'none',
              background: 'var(--accent)', color: '#fff', cursor: 'pointer',
              borderRadius: 5, fontWeight: 600,
            }}
          >
            {mode === 'create' ? 'Create' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}
