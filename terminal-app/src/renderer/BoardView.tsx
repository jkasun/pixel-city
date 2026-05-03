import React from 'react'
import { BoardProvider, useBoardContext } from './board/BoardContext.js'
import { TaskDetail } from './board/TaskEditDialog'
import { ColumnDrop } from './board/ColumnDrop'
import { StoryHeader } from './board/StoryHeader'
import { COLUMN_DEFS, BACKLOG_COL } from './board/boardTypes'
import type { BoardViewProps } from './board/boardTypes'

// Re-export AgentTaskPanel so external imports don't break
export { AgentTaskPanel } from './board/SubtaskPanel'

function BoardContent() {
  const {
    loaded, columns, agentOptions, buildingId,
    storyPath, setStoryPath, currentStory, breadcrumbs,
    detailOpen, setDetailOpen, editingStoryCtx, setEditingStoryCtx,
    handleUpdateTask, handleAssign, handleDeleteTask,
    handleBreadcrumbEditStory, handleUpdateParentStory,
    handleUpdateStory, handleAssignStory, handleDeleteStory,
    board, showBacklog, setShowBacklog,
  } = useBoardContext()

  // Resolve board for story edit dialog
  const resolveBoard = (root: typeof board, path: Array<{ taskId: string; colKey: string }>) => {
    let current = root
    for (const step of path) {
      const tasks = current.columns[step.colKey]
      const story = tasks?.find(t => t.id === step.taskId)
      if (!story || story.type !== 'story' || !story.subtasks) return null
      current = story.subtasks
    }
    return current
  }

  if (!loaded) return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg relative" style={{ overflow: 'hidden' }}>
      <div className="pc-skeleton-board">
        {[0, 1, 2, 3].map(col => (
          <div className="pc-skeleton-col" key={col}>
            <div className="pc-skeleton pc-skeleton-col-header" />
            {[0, 1, 2].slice(0, col === 0 ? 3 : col === 1 ? 2 : 1).map(card => (
              <div className="pc-skeleton pc-skeleton-card" key={card} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg relative">
      {storyPath.length > 0 && (
        <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-border text-[10px]">
          {breadcrumbs.map((crumb, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="text-text-dim mx-0.5">/</span>}
              <button
                className={`bg-none border-none font-[inherit] text-[10px] cursor-pointer px-1.5 py-0.5 rounded-[3px] transition-all duration-100 ${i === breadcrumbs.length - 1 ? 'text-text-bright cursor-default hover:bg-transparent' : 'text-text-dim hover:text-text hover:bg-white/5'}`}
                onClick={() => setStoryPath(prev => prev.slice(0, crumb.depth))}
              >{crumb.label}</button>
              {i > 0 && i === breadcrumbs.length - 1 && (
                <button
                  className="bg-none border-none text-text-dim font-[inherit] text-[10px] cursor-pointer px-1.5 py-0.5 rounded-[3px] hover:text-text hover:bg-white/5 transition-all duration-100"
                  title="Edit story details"
                  onClick={() => handleBreadcrumbEditStory(crumb.depth)}
                >edit</button>
              )}
            </React.Fragment>
          ))}
        </div>
      )}

      {currentStory && (
        <StoryHeader
          story={currentStory}
          onUpdate={handleUpdateParentStory}
        />
      )}

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-x-auto overflow-y-hidden p-2 flex gap-2 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-[5px] [&::-webkit-scrollbar-track]:bg-bg [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:rounded-[3px]">
          {COLUMN_DEFS.map(col => (
            <ColumnDrop key={col.key} col={col} />
          ))}
        </div>
        <button
          className={`flex flex-col items-center gap-1 px-1 py-2 bg-transparent border-none border-l border-white/[0.06] text-[11px] cursor-pointer font-[inherit] transition-[background,color] duration-150 [writing-mode:vertical-rl] [text-orientation:mixed] hover:bg-white/[0.04] hover:text-[#ccc] ${showBacklog ? 'text-[#8b8b8b] bg-white/[0.03]' : 'text-[#999]'}`}
          onClick={() => setShowBacklog(v => !v)}
          title={showBacklog ? 'Hide backlog' : 'Show backlog'}
          style={{ borderLeft: '1px solid rgba(255,255,255,0.06)' }}
        >
          <span className="[writing-mode:horizontal-tb] text-[14px] leading-none">{showBacklog ? '›' : '‹'}</span>
          <span className="font-medium tracking-[0.5px]">Backlog</span>
          {(columns.backlog?.length ?? 0) > 0 && (
            <span className="[writing-mode:horizontal-tb] bg-white/[0.08] rounded-[8px] px-[5px] py-px text-[10px] min-w-[16px] text-center">{columns.backlog.length}</span>
          )}
        </button>
        {showBacklog && (
          <div className="w-[260px] min-w-[260px] border-l border-white/[0.06] overflow-y-auto p-2 bg-black/10 [&_.board-col]:min-w-0 [&_.board-col]:w-full" style={{ borderLeft: '1px solid rgba(255,255,255,0.06)' }}>
            <ColumnDrop col={BACKLOG_COL} />
          </div>
        )}
      </div>

      {detailOpen && (() => {
        const tasks = columns[detailOpen.colKey]
        const task = tasks?.find(t => t.id === detailOpen.taskId)
        if (!task) return null
        return (
          <TaskDetail
            task={task}
            columnKey={detailOpen.colKey}
            agents={agentOptions}
            onClose={() => setDetailOpen(null)}
            onUpdate={handleUpdateTask}
            onAssign={handleAssign}
            onDelete={handleDeleteTask}
          />
        )
      })()}


      {editingStoryCtx && (() => {
        const parentBoard = resolveBoard(board, editingStoryCtx.parentPath)
        if (!parentBoard) return null
        const task = parentBoard.columns[editingStoryCtx.colKey]?.find(t => t.id === editingStoryCtx.taskId)
        if (!task) return null
        return (
          <TaskDetail
            task={task}
            columnKey={editingStoryCtx.colKey}
            agents={agentOptions}
            onClose={() => setEditingStoryCtx(null)}
            onUpdate={handleUpdateStory}
            onAssign={handleAssignStory}
            onDelete={handleDeleteStory}
          />
        )
      })()}
    </div>
  )
}

export function BoardView(props: BoardViewProps) {
  return (
    <BoardProvider {...props}>
      <BoardContent />
    </BoardProvider>
  )
}
