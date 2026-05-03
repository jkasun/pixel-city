import React, { useState, useEffect, useCallback } from 'react'
import { getBoardStore } from '../board/index.js'
import { COLUMN_DEFS, BACKLOG_COL, DEFAULT_BOARD } from '../board/constants.js'
import { createTask, updateTask, deleteTask, moveTask } from '../board/operations.js'
import type { BoardData, Task } from '../board/types.js'
import { BoardColumn } from './BoardColumn.js'
import { TaskDialog } from './TaskDialog.js'

interface DragState {
  taskId: string
  fromCol: string
}

export function BoardView({ buildingId }: { buildingId: string | null }) {
  const [board, setBoard] = useState<BoardData>(DEFAULT_BOARD)
  const [loading, setLoading] = useState(true)
  const [showBacklog, setShowBacklog] = useState(false)
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [dialog, setDialog] = useState<{
    mode: 'create' | 'edit'
    colKey: string
    task?: Task
  } | null>(null)

  const store = getBoardStore()

  // Subscribe to realtime updates
  useEffect(() => {
    let mounted = true

    if (store.subscribe) {
      const unsub = store.subscribe(buildingId, (data) => {
        if (mounted) {
          setBoard(data ?? DEFAULT_BOARD)
          setLoading(false)
        }
      })
      return () => { mounted = false; unsub() }
    }

    // Fallback: one-time load
    store.load(buildingId).then(res => {
      if (mounted) {
        setBoard(res.board ?? DEFAULT_BOARD)
        setLoading(false)
      }
    })
    return () => { mounted = false }
  }, [buildingId])

  const persist = useCallback((next: BoardData) => {
    setBoard(next)
    store.save(next, buildingId)
  }, [buildingId])

  // Drag handlers
  const handleDragStart = useCallback((taskId: string, fromCol: string) => {
    setDragState({ taskId, fromCol })
  }, [])

  const handleDrop = useCallback((toCol: string, dropIndex: number | null) => {
    if (!dragState) return
    const next = moveTask(board, dragState.fromCol, toCol, dragState.taskId, dropIndex)
    persist(next)
    setDragState(null)
  }, [board, dragState, persist])

  // Task CRUD
  const handleDelete = useCallback((colKey: string, taskId: string) => {
    persist(deleteTask(board, colKey, taskId))
  }, [board, persist])

  const handleCreateTask = useCallback((colKey: string) => {
    setDialog({ mode: 'create', colKey })
  }, [])

  const handleEdit = useCallback((colKey: string, task: Task) => {
    setDialog({ mode: 'edit', colKey, task })
  }, [])

  const handleDialogSave = useCallback((data: { title: string; description: string }) => {
    if (!dialog) return
    if (dialog.mode === 'create') {
      const next = createTask(board, [], dialog.colKey, data.title)
      if (data.description) {
        const newId = `PC-${board.nextId}`
        const withDesc = updateTask(next, dialog.colKey, newId, { description: data.description })
        persist(withDesc)
      } else {
        persist(next)
      }
    } else if (dialog.task) {
      const next = updateTask(board, dialog.colKey, dialog.task.id, {
        title: data.title,
        description: data.description || undefined,
      })
      persist(next)
    }
    setDialog(null)
  }, [board, dialog, persist])

  if (loading) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
        Loading board...
      </div>
    )
  }

  const backlogCount = board.columns.backlog?.length ?? 0

  return (
    <div data-testid="board-view" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Main area: columns + backlog sidebar */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {/* Scrollable columns */}
        <div data-testid="board-columns" style={{
          flex: 1, display: 'flex', gap: 8, padding: 12, overflowX: 'auto', overflowY: 'hidden',
        }}>
          {COLUMN_DEFS.map(col => (
            <BoardColumn
              key={col.key}
              col={col}
              tasks={board.columns[col.key] ?? []}
              dragState={dragState}
              onDragStart={handleDragStart}
              onDrop={handleDrop}
              onDelete={handleDelete}
              onEdit={handleEdit}
              onCreateTask={handleCreateTask}
            />
          ))}
        </div>

        {/* Backlog toggle button (vertical tab on right edge) */}
        <button
          data-testid="board-backlog-toggle"
          onClick={() => setShowBacklog(v => !v)}
          title={showBacklog ? 'Hide backlog' : 'Show backlog'}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            padding: '8px 4px', background: showBacklog ? 'rgba(255,255,255,0.03)' : 'transparent',
            border: 'none', borderLeft: '1px solid rgba(255,255,255,0.06)',
            color: showBacklog ? '#8b8b8b' : '#999',
            fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
            writingMode: 'vertical-rl', textOrientation: 'mixed',
            transition: 'background 0.15s, color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = '#ccc' }}
          onMouseLeave={e => { e.currentTarget.style.background = showBacklog ? 'rgba(255,255,255,0.03)' : 'transparent'; e.currentTarget.style.color = showBacklog ? '#8b8b8b' : '#999' }}
        >
          <span style={{ writingMode: 'horizontal-tb', fontSize: 14, lineHeight: 1 }}>{showBacklog ? '\u203A' : '\u2039'}</span>
          <span style={{ fontWeight: 500, letterSpacing: '0.5px' }}>Backlog</span>
          {backlogCount > 0 && (
            <span style={{
              writingMode: 'horizontal-tb', background: 'rgba(255,255,255,0.08)',
              borderRadius: 8, padding: '1px 5px', fontSize: 10, minWidth: 16, textAlign: 'center',
            }}>{backlogCount}</span>
          )}
        </button>

        {/* Backlog panel */}
        {showBacklog && (
          <div data-testid="board-backlog-panel" style={{
            width: 260, minWidth: 260, borderLeft: '1px solid rgba(255,255,255,0.06)',
            overflowY: 'auto', padding: 8, background: 'rgba(0,0,0,0.1)',
          }}>
            <BoardColumn
              col={BACKLOG_COL}
              tasks={board.columns[BACKLOG_COL.key] ?? []}
              dragState={dragState}
              onDragStart={handleDragStart}
              onDrop={handleDrop}
              onDelete={handleDelete}
              onEdit={handleEdit}
              onCreateTask={handleCreateTask}
            />
          </div>
        )}
      </div>

      {/* Dialog */}
      {dialog && (
        <TaskDialog
          mode={dialog.mode}
          initial={{
            title: dialog.task?.title ?? '',
            description: dialog.task?.description ?? '',
            colKey: dialog.colKey,
          }}
          onSave={handleDialogSave}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  )
}
