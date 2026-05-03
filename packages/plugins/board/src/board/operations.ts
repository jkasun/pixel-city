/**
 * Pure board CRUD operations -- no platform or persistence dependencies.
 * These functions transform BoardData immutably.
 */

import type { BoardData, Task, ChangelogEntry } from './types.js'

// -- Resolve nested boards (story path) --

export function resolveBoard(root: BoardData, path: Array<{ taskId: string; colKey: string }>): BoardData | null {
  let current = root
  for (const step of path) {
    const tasks = current.columns[step.colKey]
    const story = tasks?.find(t => t.id === step.taskId)
    if (!story || story.type !== 'story' || !story.subtasks) return null
    current = story.subtasks
  }
  return current
}

export function updateNestedBoard(
  root: BoardData,
  path: Array<{ taskId: string; colKey: string }>,
  updater: (b: BoardData) => BoardData,
): BoardData {
  if (path.length === 0) {
    return updater(root)
  }

  const newRoot = JSON.parse(JSON.stringify(root)) as BoardData
  let parent = newRoot
  for (let i = 0; i < path.length - 1; i++) {
    const step = path[i]
    const task = parent.columns[step.colKey]?.find(t => t.id === step.taskId)
    if (!task?.subtasks) return root
    parent = task.subtasks
  }
  const last = path[path.length - 1]
  const task = parent.columns[last.colKey]?.find(t => t.id === last.taskId)
  if (!task?.subtasks) return root
  task.subtasks = updater(task.subtasks)
  return newRoot
}

// -- Task CRUD --

export function createTask(
  root: BoardData,
  storyPath: Array<{ taskId: string; colKey: string }>,
  colKey: string,
  title: string,
  type: 'task' | 'story' = 'task',
): BoardData {
  const now = new Date().toISOString()
  const newRoot = JSON.parse(JSON.stringify(root)) as BoardData
  const id = `PC-${newRoot.nextId}`
  newRoot.nextId++
  const task: Task = {
    id, title, tags: [], type,
    createdBy: 'manual',
    createdAt: now, updatedAt: now,
    changelog: [{ action: 'created', by: 'manual', at: now, source: 'manual', to: colKey }],
    ...(type === 'story' ? { subtasks: { columns: { planning: [], planned: [], todo: [], progress: [], testing: [], closed: [], archived: [], backlog: [] }, nextId: 1 } } : {}),
  }
  let target = newRoot
  for (const step of storyPath) {
    const s = target.columns[step.colKey]?.find(t => t.id === step.taskId)
    if (!s?.subtasks) return root
    target = s.subtasks
  }
  if (!target.columns[colKey]) target.columns[colKey] = []
  target.columns[colKey].push(task)
  return newRoot
}

export function updateTask(
  board: BoardData,
  colKey: string,
  taskId: string,
  updates: Partial<Task>,
): BoardData {
  const tasks = board.columns[colKey]
  if (!tasks) return board
  return {
    ...board,
    columns: {
      ...board.columns,
      [colKey]: tasks.map(t => t.id === taskId ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t),
    },
  }
}

export function deleteTask(board: BoardData, colKey: string, taskId: string): BoardData {
  const tasks = board.columns[colKey]
  if (!tasks) return board
  return {
    ...board,
    columns: {
      ...board.columns,
      [colKey]: tasks.filter(t => t.id !== taskId),
    },
  }
}

export function moveTask(
  board: BoardData,
  fromCol: string,
  toCol: string,
  taskId: string,
  dropIndex: number | null,
): BoardData {
  const next = { ...board, columns: { ...board.columns } }
  const fromTasks = [...(next.columns[fromCol] ?? [])]
  const taskIdx = fromTasks.findIndex(t => t.id === taskId)
  if (taskIdx === -1) return board

  const [task] = fromTasks.splice(taskIdx, 1)
  const now = new Date().toISOString()
  task.updatedAt = now
  if (fromCol !== toCol) {
    if (!task.changelog) task.changelog = []
    task.changelog.push({ action: 'moved', by: 'manual', at: now, source: 'manual', from: fromCol, to: toCol })
  }
  next.columns[fromCol] = fromTasks

  const toTasks = fromCol === toCol ? fromTasks : [...(next.columns[toCol] ?? [])]
  const insertAt = dropIndex !== null ? Math.min(dropIndex, toTasks.length) : toTasks.length
  toTasks.splice(insertAt, 0, task)
  next.columns[toCol] = toTasks

  return next
}

export function assignTask(
  board: BoardData,
  colKey: string,
  taskId: string,
  agentKey: string | undefined,
): BoardData {
  const tasks = board.columns[colKey]
  if (!tasks) return board
  return {
    ...board,
    columns: {
      ...board.columns,
      [colKey]: tasks.map(t => {
        if (t.id !== taskId) return t
        const now = new Date().toISOString()
        const log: ChangelogEntry[] = [...(t.changelog ?? []), { action: 'assigned', by: 'manual', at: now, source: 'manual', from: t.assignee ?? 'none', to: agentKey ?? 'none' }]
        return { ...t, assignee: agentKey, updatedAt: now, changelog: log }
      }),
    },
  }
}

export function dispatchBoardUpdate(projectDir: string | null, buildingId: string | null, board: BoardData, source: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('pixelcity:board-updated', { detail: { projectDir, buildingId, board, source } }))
  }
}
