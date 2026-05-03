import React, { useState, useEffect } from 'react'
import type { Task, Column, BoardData, AgentOption, AgentTaskPanelProps } from './boardTypes'
import { COLUMN_DEFS } from './boardTypes'
import { subscribeToBoardUpdates } from './taskDbLocal'

export function AgentTaskPanel({ projectCwd, buildingId, selectedAgentKey, selectedAgentName, selectedEmployeeKey }: AgentTaskPanelProps) {
  const [board, setBoard] = useState<BoardData | null>(null)

  // Real-time RTDB subscription for board data
  useEffect(() => {
    const unsubscribe = subscribeToBoardUpdates(buildingId, (newBoard) => {
      setBoard(newBoard)
    })
    return () => unsubscribe()
  }, [buildingId])

  // Also listen for local board changes from BoardView (in-memory updates before RTDB persist)
  useEffect(() => {
    const handler = (e: Event) => {
      const { projectDir: pd, buildingId: bid, board: newBoard } = (e as CustomEvent).detail
      if ((pd === undefined || pd === null || pd === projectCwd) && bid === buildingId) setBoard(newBoard as BoardData)
    }
    window.addEventListener('pixelcity:board-updated', handler)
    return () => window.removeEventListener('pixelcity:board-updated', handler)
  }, [projectCwd, buildingId])

  if (!board) return null

  // Collect tasks assigned to this agent, grouped by column
  // Match by agent key (e.g. "agent:9000") or employee key (e.g. "emp:ada")
  const matchKeys = new Set<string>()
  if (selectedAgentKey) matchKeys.add(selectedAgentKey)
  if (selectedEmployeeKey) matchKeys.add(selectedEmployeeKey)

  const tasksByColumn: Array<{ col: Column; tasks: Task[] }> = []
  let totalCount = 0
  for (const col of COLUMN_DEFS) {
    const colTasks = (board.columns[col.key] ?? []).filter(t => t.assignee != null && matchKeys.has(t.assignee))
    if (colTasks.length > 0) {
      tasksByColumn.push({ col, tasks: colTasks })
      totalCount += colTasks.length
    }
  }

  return (
    <div data-testid="board-agent-task-panel" className="flex flex-col h-full text-text font-[inherit] text-[0.82rem]">
      {/* header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="font-semibold tracking-[0.02em] text-[0.82rem]">
          {selectedAgentName ? `${selectedAgentName} — Tasks` : 'Tasks'}
        </span>
        <span className="text-[9px] text-text-dim bg-bg border border-border rounded-[3px] px-1 tabular-nums">{totalCount}</span>
      </div>

      {/* body */}
      <div className="flex-1 overflow-y-auto py-1">
        {totalCount === 0 && (
          <div className="px-3 py-6 text-center text-text-dim text-[0.78rem]">
            {selectedAgentName
              ? `No tasks assigned to ${selectedAgentName}.`
              : 'Select an agent to see their tasks.'}
          </div>
        )}

        {tasksByColumn.map(({ col, tasks }) => (
          <div key={col.key} className="mb-1">
            {/* group header */}
            <div className="flex items-center gap-[6px] px-3 pt-[6px] pb-[3px]">
              <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ background: col.color }} />
              <span className="text-[0.68rem] uppercase tracking-[0.08em] text-text-dim font-semibold">{col.label}</span>
              <span className="text-[0.65rem] text-text-dim ml-auto">{tasks.length}</span>
            </div>
            {tasks.map(task => (
              <div
                key={task.id}
                className="flex items-start gap-2 px-3 py-[5px] transition-[background] duration-100 cursor-pointer hover:bg-white/[0.03]"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('pixelcity:navigate-to-task', {
                    detail: { taskId: task.id, buildingId },
                  }))
                }}
              >
                <div className="flex flex-col gap-px min-w-0">
                  <span className="text-[0.65rem] text-text-dim tabular-nums">{task.id}</span>
                  <span className="text-[0.78rem] text-text whitespace-nowrap overflow-hidden text-ellipsis">{task.title}</span>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
