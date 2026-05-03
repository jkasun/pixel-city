/**
 * Board / task / subtask async command handlers for the MCP Bridge.
 * Backed by the local SQLite/IPC task store.
 */

import type { Task } from '@pixel-city/plugin-board'
import { loadNotificationSettings, COLUMN_NOTIFICATION_MAP } from '../settings/settingsManager.js'
import { loadBoardFromRtdb, saveBoardToRtdb, listBoardsFromRtdb } from '../board/taskDbLocal.js'

/** Strip internal metadata fields from a task object before returning via MCP */
export function stripTaskMeta(t: Record<string, unknown>): Record<string, unknown> {
  const { changelog, createdAt, updatedAt, createdBy, ...rest } = t
  // Recursively strip subtasks if present
  if (rest.subtasks && typeof rest.subtasks === 'object') {
    const sub = rest.subtasks as { columns: Record<string, Array<Record<string, unknown>>>; nextId: number }
    const stripped: Record<string, Array<Record<string, unknown>>> = {}
    for (const [col, tasks] of Object.entries(sub.columns ?? {})) {
      stripped[col] = tasks.map(stripTaskMeta)
    }
    rest.subtasks = { columns: stripped, nextId: sub.nextId }
  }
  return rest
}

export async function executeTaskAction(
  action: string,
  params: Record<string, unknown>,
  ipc: Electron.IpcRenderer,
): Promise<unknown> {
  switch (action) {
    case 'get_board': {
      const buildingId = (params.buildingId as string) ?? null
      const columnFilter = (params.column as string) ?? null
      const limit = (params.limit as number) ?? 20
      const offset = (params.offset as number) ?? 0
      const verbose = (params.verbose as boolean) ?? false
      const rtdbResult = await loadBoardFromRtdb(buildingId)
      const board = rtdbResult?.board
      if (!board) {
        return { success: true, board: null }
      }
      const columns = board.columns as unknown as Record<string, Array<Record<string, unknown>>>
      const colKeys = columnFilter ? [columnFilter] : Object.keys(columns).filter(k => k !== 'archived')
      // Flatten tasks with column info
      let allTasks: Array<Record<string, unknown>> = []
      for (const col of colKeys) {
        for (const t of (columns[col] ?? [])) {
          allTasks.push({ ...t, column: col })
        }
      }
      const total = allTasks.length
      allTasks = allTasks.slice(offset, offset + limit)
      allTasks = allTasks.map(stripTaskMeta)
      // Compact mode: summarize subtasks
      if (!verbose) {
        allTasks = allTasks.map(t => {
          const { subtasks, ...rest } = t
          if (t.type === 'story' && subtasks && typeof subtasks === 'object') {
            const sub = subtasks as { columns: Record<string, unknown[]> }
            const subtaskCounts: Record<string, number> = {}
            let stotal = 0
            for (const [col, items] of Object.entries(sub.columns ?? {})) {
              if (items.length > 0) {
                subtaskCounts[col] = items.length
                stotal += items.length
              }
            }
            return { ...rest, subtaskCount: stotal, subtasksByColumn: subtaskCounts }
          }
          return rest
        })
      }
      return { success: true, total, offset, limit, tasks: allTasks }
    }
    case 'list_tasks': {
      const projectDir = (params.projectDir as string) ?? null
      const buildingId = (params.buildingId as string) ?? null
      const column = (params.column as string) ?? null
      const assignee = (params.assignee as string) ?? null
      const verbose = (params.verbose as boolean) ?? false
      const rtdbResult = await loadBoardFromRtdb(buildingId)
      const board = rtdbResult?.board
      let tasks: Array<Record<string, unknown>> = []
      const columns = (board?.columns ?? {}) as unknown as Record<string, Array<Record<string, unknown>>>
      for (const [col, colTasks] of Object.entries(columns)) {
        if (!column && col === 'archived') continue // Exclude archived unless explicitly filtered
        for (const t of colTasks) {
          tasks.push({ ...t, column: col })
        }
      }
      if (column) tasks = tasks.filter(t => t.column === column)
      if (assignee) tasks = tasks.filter(t => t.assignee === assignee)
      tasks = tasks.map(stripTaskMeta)
      // In compact mode (default), summarize subtasks
      if (!verbose) {
        tasks = tasks.map(t => {
          const { subtasks, ...rest } = t
          if (t.type === 'story' && subtasks && typeof subtasks === 'object') {
            const sub = subtasks as { columns: Record<string, unknown[]> }
            const subtaskCounts: Record<string, number> = {}
            let total = 0
            for (const [col, items] of Object.entries(sub.columns ?? {})) {
              if (items.length > 0) {
                subtaskCounts[col] = items.length
                total += items.length
              }
            }
            return { ...rest, subtaskCount: total, subtasksByColumn: subtaskCounts }
          }
          return rest
        })
      }
      return { tasks }
    }
    case 'get_task': {
      const projectDir = (params.projectDir as string) ?? null
      const buildingId = (params.buildingId as string) ?? null
      const taskId = params.taskId as string
      if (!taskId) throw new Error('Missing taskId')

      // Search a board for a task by ID (top-level + subtasks inside stories)
      function findTaskInBoard(board: Record<string, unknown>): Record<string, unknown> | null {
        for (const [col, colTasks] of Object.entries(board.columns as unknown as Record<string, Array<Record<string, unknown>>>)) {
          for (const t of colTasks) {
            if (t.id === taskId) return { ...t, column: col }
            // Search subtasks inside stories
            if (t.type === 'story' && t.subtasks) {
              const sub = t.subtasks as { columns: Record<string, Array<Record<string, unknown>>> }
              for (const [subCol, subTasks] of Object.entries(sub.columns ?? {})) {
                for (const st of subTasks) {
                  if (st.id === taskId) return { ...st, column: subCol, parentStory: t.id }
                }
              }
            }
          }
        }
        return null
      }

      // Search within the current building only — cross-building lookup
      // would leak tasks across offices.
      const rtdbResult = await loadBoardFromRtdb(buildingId)
      let found = rtdbResult?.board ? findTaskInBoard(rtdbResult.board as unknown as Record<string, unknown>) : null

      // If caller explicitly did not pass a buildingId (buildingId === null),
      // fall back to scanning all boards — used by dev tooling that has no
      // building context.
      if (!found && buildingId == null) {
        const listResult = await listBoardsFromRtdb()
        const boards: string[] = listResult?.boards ?? []
        for (const bid of boards) {
          if (bid === 'default') continue
          const otherResult = await loadBoardFromRtdb(bid)
          if (otherResult?.board) {
            found = findTaskInBoard(otherResult.board as unknown as Record<string, unknown>)
            if (found) break
          }
        }
      }

      if (!found) throw new Error(`Task ${taskId} not found`)
      return { task: stripTaskMeta(found) }
    }
    case 'create_task': {
      const buildingId = (params.buildingId as string) ?? null
      const column = (params.column as string) ?? 'planning'
      const title = params.title as string
      if (!title) throw new Error('Missing title')
      const rtdbResult = await loadBoardFromRtdb(buildingId)
      const board = rtdbResult?.board ?? { columns: { planning: [], planned: [], todo: [], progress: [], testing: [], closed: [], archived: [], backlog: [] }, nextId: 1 }
      const now = new Date().toISOString()
      const type = (params.type as string) ?? 'task'
      const callerKey = (params._callerKey as string) ?? 'mcp'
      const task: Record<string, unknown> = {
        id: `PC-${board.nextId}`,
        title,
        description: (params.description as string) ?? '',
        tags: (params.tags as unknown[]) ?? [],
        type,
        createdBy: callerKey,
        createdAt: now,
        updatedAt: now,
        changelog: [{ action: 'created', by: callerKey, at: now, source: 'mcp', to: column }],
      }
      if (params.assignee) task.assignee = params.assignee as string
      if (type === 'story') {
        task.subtasks = { columns: { planning: [], planned: [], todo: [], progress: [], testing: [], closed: [], archived: [], backlog: [] }, nextId: 1 }
      }
      board.nextId++
      if (!board.columns[column]) board.columns[column] = []
      board.columns[column].push(task as unknown as Task)
      const saveResult = await saveBoardToRtdb(board, buildingId)
      if (!saveResult.success) throw new Error(saveResult.error ?? 'Failed to save board')
      window.dispatchEvent(new CustomEvent('pixelcity:board-updated', { detail: { buildingId, board } }))
      return { success: true, task: stripTaskMeta(task) }
    }
    case 'update_task': {
      const buildingId = (params.buildingId as string) ?? null
      const taskId = params.taskId as string
      if (!taskId) throw new Error('Missing taskId')
      const rtdbResult = await loadBoardFromRtdb(buildingId)
      const board = rtdbResult?.board
      if (!board) throw new Error('Board not found')
      const callerKey = (params._callerKey as string) ?? 'mcp'
      // Helper to apply updates to a task/subtask object
      function applyUpdate(t: Record<string, unknown>) {
        const now = new Date().toISOString()
        if (!t.changelog) t.changelog = []
        const log = t.changelog as Array<Record<string, unknown>>
        if (params.title !== undefined) t.title = params.title
        if (params.description !== undefined) t.description = params.description
        if (params.tags !== undefined) t.tags = params.tags
        if (params.assignee !== undefined) {
          log.push({ action: 'assigned', by: callerKey, at: now, source: 'mcp', from: t.assignee ?? 'none', to: params.assignee ?? 'none' })
          t.assignee = params.assignee
        }
        log.push({ action: 'updated', by: callerKey, at: now, source: 'mcp' })
        t.updatedAt = now
      }

      let found = false
      for (const colTasks of Object.values(board.columns) as unknown as Array<Array<Record<string, unknown>>>) {
        for (const t of colTasks) {
          if (t.id === taskId) {
            applyUpdate(t)
            found = true
            break
          }
          // Search subtasks inside stories
          if (t.type === 'story' && t.subtasks) {
            const sub = t.subtasks as { columns: Record<string, Array<Record<string, unknown>>> }
            for (const subTasks of Object.values(sub.columns ?? {})) {
              for (const st of subTasks) {
                if (st.id === taskId) {
                  applyUpdate(st)
                  t.updatedAt = new Date().toISOString()
                  found = true
                  break
                }
              }
              if (found) break
            }
          }
          if (found) break
        }
        if (found) break
      }
      if (!found) throw new Error(`Task ${taskId} not found`)
      await saveBoardToRtdb(board, buildingId)
      window.dispatchEvent(new CustomEvent('pixelcity:board-updated', { detail: { buildingId, board } }))
      return { success: true }
    }
    case 'delete_task': {
      const buildingId = (params.buildingId as string) ?? null
      const taskId = params.taskId as string
      if (!taskId) throw new Error('Missing taskId')
      const rtdbResult = await loadBoardFromRtdb(buildingId)
      const board = rtdbResult?.board
      if (!board) throw new Error('Board not found')
      let found = false
      for (const colTasks of Object.values(board.columns) as unknown as Array<Array<Record<string, unknown>>>) {
        const idx = colTasks.findIndex(t => t.id === taskId)
        if (idx !== -1) {
          colTasks.splice(idx, 1)
          found = true
          break
        }
      }
      if (!found) throw new Error(`Task ${taskId} not found`)
      await saveBoardToRtdb(board, buildingId)
      window.dispatchEvent(new CustomEvent('pixelcity:board-updated', { detail: { buildingId, board } }))
      return { success: true }
    }
    case 'move_task': {
      const buildingId = (params.buildingId as string) ?? null
      const taskId = params.taskId as string
      const toColumn = params.toColumn as string
      if (!taskId || !toColumn) throw new Error('Missing taskId or toColumn')
      const rtdbResult = await loadBoardFromRtdb(buildingId)
      const board = rtdbResult?.board
      if (!board) throw new Error('Board not found')
      // Prevent moving to closed via MCP (PC-67: Disable moving to close)
      if (toColumn === 'closed') {
        throw new Error(`Cannot move task ${taskId} to closed via MCP — moving to closed is disabled`)
      }
      // Reject unknown column keys — otherwise we'd silently write the task into a
      // phantom column that the board UI can't render (e.g. "in_progress" instead of "progress").
      const VALID_COLUMNS = ['planning', 'planned', 'todo', 'progress', 'testing', 'backlog']
      if (!VALID_COLUMNS.includes(toColumn)) {
        throw new Error(`Invalid toColumn "${toColumn}". Valid columns: ${VALID_COLUMNS.join(', ')}.`)
      }
      const callerKey = (params._callerKey as string) ?? 'mcp'
      // Column order for transition validation (PC-6)
      const COLUMN_ORDER = ['planning', 'planned', 'todo', 'progress', 'testing']
      // Search top-level tasks
      let task: Record<string, unknown> | null = null
      let fromColumn: string | null = null
      for (const [col, colTasks] of Object.entries(board.columns) as unknown as Array<[string, Array<Record<string, unknown>>]>) {
        const idx = colTasks.findIndex(t => t.id === taskId)
        if (idx !== -1) {
          task = colTasks.splice(idx, 1)[0]
          fromColumn = col
          break
        }
      }
      // If not found at top level, search subtasks inside stories
      let parentStory: Record<string, unknown> | null = null
      let subtaskColumns: Record<string, Array<Record<string, unknown>>> | null = null
      if (!task) {
        for (const colTasks of Object.values(board.columns) as unknown as Array<Array<Record<string, unknown>>>) {
          for (const t of colTasks) {
            if (t.type === 'story' && t.subtasks) {
              const sub = t.subtasks as { columns: Record<string, Array<Record<string, unknown>>> }
              for (const [subCol, subTasks] of Object.entries(sub.columns ?? {})) {
                const idx = subTasks.findIndex(st => st.id === taskId)
                if (idx !== -1) {
                  task = subTasks.splice(idx, 1)[0]
                  fromColumn = subCol
                  parentStory = t
                  subtaskColumns = sub.columns
                  break
                }
              }
              if (task) break
            }
          }
          if (task) break
        }
      }
      if (!task) throw new Error(`Task ${taskId} not found`)
      // Allow free moves to/from backlog (no adjacency restriction)
      const isBacklogMove = fromColumn === 'backlog' || toColumn === 'backlog'
      // Validate column transition — only allow moves to adjacent columns (PC-6)
      const fromIdx = COLUMN_ORDER.indexOf(fromColumn!)
      const toIdx = COLUMN_ORDER.indexOf(toColumn)
      if (!isBacklogMove && fromIdx !== -1 && toIdx !== -1 && Math.abs(toIdx - fromIdx) > 1) {
        // Re-insert the task back into its original column since we already spliced it
        if (parentStory && subtaskColumns) {
          if (!subtaskColumns[fromColumn!]) subtaskColumns[fromColumn!] = []
          subtaskColumns[fromColumn!].push(task)
        } else {
          if (!board.columns[fromColumn!]) board.columns[fromColumn!] = []
          board.columns[fromColumn!].push(task as unknown as Task)
        }
        throw new Error(`Cannot move task ${taskId} from "${fromColumn}" directly to "${toColumn}" — tasks can only move to adjacent columns. Move it to "${COLUMN_ORDER[fromIdx + (toIdx > fromIdx ? 1 : -1)]}" first.`)
      }
      const now = new Date().toISOString()
      task.updatedAt = now
      if (!task.changelog) task.changelog = []
      ;(task.changelog as Array<Record<string, unknown>>).push({ action: 'moved', by: callerKey, at: now, source: 'mcp', from: fromColumn, to: toColumn })
      if (parentStory && subtaskColumns) {
        // Move within the story's subtask columns
        if (!subtaskColumns[toColumn]) subtaskColumns[toColumn] = []
        subtaskColumns[toColumn].push(task)
        parentStory.updatedAt = now
      } else {
        // Move within top-level board columns
        if (!board.columns[toColumn]) board.columns[toColumn] = []
        board.columns[toColumn].push(task as unknown as Task)
      }
      await saveBoardToRtdb(board, buildingId)
      window.dispatchEvent(new CustomEvent('pixelcity:board-updated', { detail: { buildingId, board } }))
      // Notify on column transition
      const notifKey = COLUMN_NOTIFICATION_MAP[toColumn]
      if (notifKey && fromColumn !== toColumn) {
        const notifSettings = loadNotificationSettings()
        if (notifSettings[notifKey]) {
          const labels: Record<string, string> = { closed: 'Closed', testing: 'Testing', progress: 'In Progress', todo: 'Todo' }
          ipc.invoke('send-notification', {
            title: `${parentStory ? 'Subtask' : 'Task'} moved to ${labels[toColumn] ?? toColumn}`,
            body: `${taskId}: ${task.title ?? 'Untitled'}`,
          })
        }
      }
      return { success: true }
    }
    case 'create_subtask': {
      const buildingId = (params.buildingId as string) ?? null
      const storyId = params.storyId as string
      const column = (params.column as string) ?? 'planning'
      const title = params.title as string
      if (!storyId) throw new Error('Missing storyId')
      if (!title) throw new Error('Missing title')
      const rtdbResult = await loadBoardFromRtdb(buildingId)
      const board = rtdbResult?.board
      if (!board) throw new Error('Board not found')
      let story: Record<string, unknown> | null = null
      for (const colTasks of Object.values(board.columns) as unknown as Array<Array<Record<string, unknown>>>) {
        const found = colTasks.find(t => t.id === storyId)
        if (found) { story = found; break }
      }
      if (!story) throw new Error(`Story ${storyId} not found`)
      if (story.type !== 'story') throw new Error(`Task ${storyId} is not a story`)
      const subtasks = story.subtasks as { columns: Record<string, Array<Record<string, unknown>>>; nextId: number }
      if (!subtasks) throw new Error(`Story ${storyId} has no subtask board`)
      const now = new Date().toISOString()
      const subtaskCallerKey = (params._callerKey as string) ?? 'mcp'
      const subtask: Record<string, unknown> = {
        id: `${storyId}-${subtasks.nextId}`,
        title,
        description: (params.description as string) ?? '',
        tags: (params.tags as unknown[]) ?? [],
        type: 'task',
        createdBy: subtaskCallerKey,
        createdAt: now,
        updatedAt: now,
        changelog: [{ action: 'created', by: subtaskCallerKey, at: now, source: 'mcp', to: column }],
      }
      if (params.assignee) subtask.assignee = params.assignee as string
      subtasks.nextId++
      if (!subtasks.columns[column]) subtasks.columns[column] = []
      subtasks.columns[column].push(subtask)
      story.updatedAt = now
      const subSaveResult = await saveBoardToRtdb(board, buildingId)
      if (!subSaveResult.success) throw new Error(subSaveResult.error ?? 'Failed to save board')
      window.dispatchEvent(new CustomEvent('pixelcity:board-updated', { detail: { buildingId, board } }))
      return { success: true, subtask: stripTaskMeta(subtask) }
    }
    case 'list_subtasks': {
      const buildingId = (params.buildingId as string) ?? null
      const storyId = params.storyId as string
      const column = (params.column as string) ?? null
      const assignee = (params.assignee as string) ?? null
      if (!storyId) throw new Error('Missing storyId')
      const rtdbResult = await loadBoardFromRtdb(buildingId)
      const board = rtdbResult?.board
      if (!board) throw new Error('Board not found')
      let story: Record<string, unknown> | null = null
      for (const colTasks of Object.values(board.columns) as unknown as Array<Array<Record<string, unknown>>>) {
        const found = colTasks.find(t => t.id === storyId)
        if (found) { story = found; break }
      }
      if (!story) throw new Error(`Story ${storyId} not found`)
      if (story.type !== 'story') throw new Error(`Task ${storyId} is not a story`)
      const subtasks = story.subtasks as { columns: Record<string, Array<Record<string, unknown>>> }
      if (!subtasks) throw new Error(`Story ${storyId} has no subtask board`)
      let tasks: Array<Record<string, unknown>> = []
      for (const [col, colTasks] of Object.entries(subtasks.columns)) {
        for (const t of colTasks) {
          tasks.push({ ...t, column: col })
        }
      }
      if (column) tasks = tasks.filter(t => t.column === column)
      if (assignee) tasks = tasks.filter(t => t.assignee === assignee)
      return { tasks: tasks.map(stripTaskMeta) }
    }
    case 'update_subtask': {
      const buildingId = (params.buildingId as string) ?? null
      const storyId = params.storyId as string
      const subtaskId = params.subtaskId as string
      if (!storyId) throw new Error('Missing storyId')
      if (!subtaskId) throw new Error('Missing subtaskId')
      const rtdbResult = await loadBoardFromRtdb(buildingId)
      const board = rtdbResult?.board
      if (!board) throw new Error('Board not found')
      let story: Record<string, unknown> | null = null
      for (const colTasks of Object.values(board.columns) as unknown as Array<Array<Record<string, unknown>>>) {
        const found = colTasks.find(t => t.id === storyId)
        if (found) { story = found; break }
      }
      if (!story) throw new Error(`Story ${storyId} not found`)
      if (story.type !== 'story') throw new Error(`Task ${storyId} is not a story`)
      const subtasks = story.subtasks as { columns: Record<string, Array<Record<string, unknown>>> }
      if (!subtasks) throw new Error(`Story ${storyId} has no subtask board`)
      const updateCallerKey = (params._callerKey as string) ?? 'mcp'
      let found = false
      for (const colTasks of Object.values(subtasks.columns)) {
        for (const t of colTasks) {
          if (t.id === subtaskId) {
            const now = new Date().toISOString()
            if (!t.changelog) t.changelog = []
            const log = t.changelog as Array<Record<string, unknown>>
            if (params.title !== undefined) t.title = params.title
            if (params.description !== undefined) t.description = params.description
            if (params.tags !== undefined) t.tags = params.tags
            if (params.assignee !== undefined) {
              log.push({ action: 'assigned', by: updateCallerKey, at: now, source: 'mcp', from: t.assignee ?? 'none', to: params.assignee ?? 'none' })
              t.assignee = params.assignee
            }
            log.push({ action: 'updated', by: updateCallerKey, at: now, source: 'mcp' })
            t.updatedAt = now
            found = true
            break
          }
        }
        if (found) break
      }
      if (!found) throw new Error(`Subtask ${subtaskId} not found in story ${storyId}`)
      story.updatedAt = new Date().toISOString()
      await saveBoardToRtdb(board, buildingId)
      window.dispatchEvent(new CustomEvent('pixelcity:board-updated', { detail: { buildingId, board } }))
      return { success: true }
    }
    case 'move_subtask': {
      const buildingId = (params.buildingId as string) ?? null
      const storyId = params.storyId as string
      const subtaskId = params.subtaskId as string
      const toColumn = params.toColumn as string
      if (!storyId) throw new Error('Missing storyId')
      if (!subtaskId || !toColumn) throw new Error('Missing subtaskId or toColumn')
      const VALID_SUBTASK_COLUMNS = ['planning', 'planned', 'todo', 'progress', 'testing', 'backlog']
      if (toColumn !== 'closed' && !VALID_SUBTASK_COLUMNS.includes(toColumn)) {
        throw new Error(`Invalid toColumn "${toColumn}". Valid columns: ${VALID_SUBTASK_COLUMNS.join(', ')}.`)
      }
      const rtdbResult = await loadBoardFromRtdb(buildingId)
      const board = rtdbResult?.board
      if (!board) throw new Error('Board not found')
      let story: Record<string, unknown> | null = null
      for (const colTasks of Object.values(board.columns) as unknown as Array<Array<Record<string, unknown>>>) {
        const found = colTasks.find(t => t.id === storyId)
        if (found) { story = found; break }
      }
      if (!story) throw new Error(`Story ${storyId} not found`)
      if (story.type !== 'story') throw new Error(`Task ${storyId} is not a story`)
      const subtasks = story.subtasks as { columns: Record<string, Array<Record<string, unknown>>> }
      if (!subtasks) throw new Error(`Story ${storyId} has no subtask board`)
      const moveCallerKey = (params._callerKey as string) ?? 'mcp'
      let subtask: Record<string, unknown> | null = null
      let fromSubCol: string | null = null
      for (const [col, colTasks] of Object.entries(subtasks.columns)) {
        const idx = colTasks.findIndex(t => t.id === subtaskId)
        if (idx !== -1) {
          subtask = colTasks.splice(idx, 1)[0]
          fromSubCol = col
          break
        }
      }
      if (!subtask) throw new Error(`Subtask ${subtaskId} not found in story ${storyId}`)
      // Prevent moving to closed via MCP (PC-67: Disable moving to close)
      if (toColumn === 'closed') {
        // Re-insert the subtask back into its original column since we already spliced it
        subtasks.columns[fromSubCol!].push(subtask)
        throw new Error(`Cannot move subtask ${subtaskId} to closed via MCP — moving to closed is disabled`)
      }
      // Validate column transition — only allow moves to adjacent columns (PC-6)
      const SUBTASK_COLUMN_ORDER = ['planning', 'planned', 'todo', 'progress', 'testing']
      const subFromIdx = SUBTASK_COLUMN_ORDER.indexOf(fromSubCol!)
      const subToIdx = SUBTASK_COLUMN_ORDER.indexOf(toColumn)
      if (subFromIdx !== -1 && subToIdx !== -1 && Math.abs(subToIdx - subFromIdx) > 1) {
        subtasks.columns[fromSubCol!].push(subtask)
        throw new Error(`Cannot move subtask ${subtaskId} from "${fromSubCol}" directly to "${toColumn}" — subtasks can only move to adjacent columns. Move it to "${SUBTASK_COLUMN_ORDER[subFromIdx + (subToIdx > subFromIdx ? 1 : -1)]}" first.`)
      }
      if (!subtasks.columns[toColumn]) subtasks.columns[toColumn] = []
      const now = new Date().toISOString()
      subtask.updatedAt = now
      if (!subtask.changelog) subtask.changelog = []
      ;(subtask.changelog as Array<Record<string, unknown>>).push({ action: 'moved', by: moveCallerKey, at: now, source: 'mcp', from: fromSubCol, to: toColumn })
      subtasks.columns[toColumn].push(subtask)
      story.updatedAt = new Date().toISOString()
      await saveBoardToRtdb(board, buildingId)
      window.dispatchEvent(new CustomEvent('pixelcity:board-updated', { detail: { buildingId, board } }))
      // Notify on column transition
      const notifKey = COLUMN_NOTIFICATION_MAP[toColumn]
      if (notifKey && fromSubCol !== toColumn) {
        const notifSettings = loadNotificationSettings()
        if (notifSettings[notifKey]) {
          const labels: Record<string, string> = { closed: 'Closed', testing: 'Testing', progress: 'In Progress', todo: 'Todo' }
          ipc.invoke('send-notification', {
            title: `Subtask moved to ${labels[toColumn] ?? toColumn}`,
            body: `${subtaskId}: ${subtask.title ?? 'Untitled'}`,
          })
        }
      }
      return { success: true }
    }
    case 'archive_task': {
      const buildingId = (params.buildingId as string) ?? null
      const taskId = params.taskId as string
      if (!taskId) throw new Error('Missing taskId')
      const rtdbResult = await loadBoardFromRtdb(buildingId)
      const board = rtdbResult?.board
      if (!board) throw new Error('Board not found')
      const callerKey = (params._callerKey as string) ?? 'mcp'
      let task: Record<string, unknown> | null = null
      let fromColumn: string | null = null
      for (const [col, colTasks] of Object.entries(board.columns) as unknown as Array<[string, Array<Record<string, unknown>>]>) {
        const idx = colTasks.findIndex(t => t.id === taskId)
        if (idx !== -1) {
          task = colTasks.splice(idx, 1)[0]
          fromColumn = col
          break
        }
      }
      if (!task) throw new Error(`Task ${taskId} not found`)
      if (!board.columns.archived) board.columns.archived = []
      const now = new Date().toISOString()
      task.updatedAt = now
      if (!task.changelog) task.changelog = []
      ;(task.changelog as Array<Record<string, unknown>>).push({ action: 'archived', by: callerKey, at: now, source: 'mcp', from: fromColumn, to: 'archived' })
      board.columns.archived.push(task as unknown as Task)
      await saveBoardToRtdb(board, buildingId)
      window.dispatchEvent(new CustomEvent('pixelcity:board-updated', { detail: { buildingId, board } }))
      return { success: true }
    }
    case 'archive_all_closed': {
      const buildingId = (params.buildingId as string) ?? null
      const rtdbResult = await loadBoardFromRtdb(buildingId)
      const board = rtdbResult?.board
      if (!board) throw new Error('Board not found')
      const callerKey = (params._callerKey as string) ?? 'mcp'
      const closedTasks = board.columns.closed ?? []
      if (closedTasks.length === 0) return { success: true, archivedCount: 0 }
      if (!board.columns.archived) board.columns.archived = []
      const now = new Date().toISOString()
      for (const task of closedTasks) {
        task.updatedAt = now
        if (!task.changelog) task.changelog = []
        ;(task.changelog as unknown as Array<Record<string, unknown>>).push({ action: 'archived', by: callerKey, at: now, source: 'mcp', from: 'closed', to: 'archived' })
        board.columns.archived.push(task)
      }
      const archivedCount = closedTasks.length
      board.columns.closed = []
      await saveBoardToRtdb(board, buildingId)
      window.dispatchEvent(new CustomEvent('pixelcity:board-updated', { detail: { buildingId, board } }))
      return { success: true, archivedCount }
    }
    case 'restore_task': {
      const buildingId = (params.buildingId as string) ?? null
      const taskId = params.taskId as string
      const toColumn = (params.toColumn as string) ?? 'closed'
      if (!taskId) throw new Error('Missing taskId')
      const rtdbResult = await loadBoardFromRtdb(buildingId)
      const board = rtdbResult?.board
      if (!board) throw new Error('Board not found')
      const callerKey = (params._callerKey as string) ?? 'mcp'
      const archived = board.columns.archived ?? []
      const idx = archived.findIndex(t => t.id === taskId)
      if (idx === -1) throw new Error(`Task ${taskId} not found in archive`)
      const task = archived.splice(idx, 1)[0]
      const now = new Date().toISOString()
      task.updatedAt = now
      if (!task.changelog) task.changelog = []
      ;(task.changelog as unknown as Array<Record<string, unknown>>).push({ action: 'restored', by: callerKey, at: now, source: 'mcp', from: 'archived', to: toColumn })
      if (!board.columns[toColumn]) board.columns[toColumn] = []
      board.columns[toColumn].push(task)
      await saveBoardToRtdb(board, buildingId)
      window.dispatchEvent(new CustomEvent('pixelcity:board-updated', { detail: { buildingId, board } }))
      return { success: true }
    }
    case 'list_archived_tasks': {
      const buildingId = (params.buildingId as string) ?? null
      const verbose = (params.verbose as boolean) ?? false
      const rtdbResult = await loadBoardFromRtdb(buildingId)
      const board = rtdbResult?.board
      if (!board) return { tasks: [] }
      let tasks = (board.columns.archived ?? []) as unknown as Array<Record<string, unknown>>
      tasks = tasks.map(t => ({ ...t, column: 'archived' }))
      tasks = tasks.map(stripTaskMeta)
      if (!verbose) {
        tasks = tasks.map(t => {
          const { subtasks, ...rest } = t
          if (t.type === 'story' && subtasks && typeof subtasks === 'object') {
            const sub = subtasks as { columns: Record<string, unknown[]> }
            const subtaskCounts: Record<string, number> = {}
            let total = 0
            for (const [col, items] of Object.entries(sub.columns ?? {})) {
              if (items.length > 0) {
                subtaskCounts[col] = items.length
                total += items.length
              }
            }
            return { ...rest, subtaskCount: total, subtasksByColumn: subtaskCounts }
          }
          return rest
        })
      }
      return { tasks }
    }
    case 'delete_subtask': {
      const buildingId = (params.buildingId as string) ?? null
      const storyId = params.storyId as string
      const subtaskId = params.subtaskId as string
      if (!storyId) throw new Error('Missing storyId')
      if (!subtaskId) throw new Error('Missing subtaskId')
      const rtdbResult = await loadBoardFromRtdb(buildingId)
      const board = rtdbResult?.board
      if (!board) throw new Error('Board not found')
      let story: Record<string, unknown> | null = null
      for (const colTasks of Object.values(board.columns) as unknown as Array<Array<Record<string, unknown>>>) {
        const found = colTasks.find(t => t.id === storyId)
        if (found) { story = found; break }
      }
      if (!story) throw new Error(`Story ${storyId} not found`)
      if (story.type !== 'story') throw new Error(`Task ${storyId} is not a story`)
      const subtasks = story.subtasks as { columns: Record<string, Array<Record<string, unknown>>> }
      if (!subtasks) throw new Error(`Story ${storyId} has no subtask board`)
      let found = false
      for (const colTasks of Object.values(subtasks.columns)) {
        const idx = colTasks.findIndex(t => t.id === subtaskId)
        if (idx !== -1) {
          colTasks.splice(idx, 1)
          found = true
          break
        }
      }
      if (!found) throw new Error(`Subtask ${subtaskId} not found in story ${storyId}`)
      story.updatedAt = new Date().toISOString()
      await saveBoardToRtdb(board, buildingId)
      window.dispatchEvent(new CustomEvent('pixelcity:board-updated', { detail: { buildingId, board } }))
      return { success: true }
    }
    default:
      return undefined
  }
}

/** All action names handled by this module (async). */
export const TASK_ACTIONS = new Set([
  'get_board', 'list_tasks', 'get_task', 'create_task', 'update_task', 'delete_task', 'move_task',
  'archive_task', 'archive_all_closed', 'restore_task', 'list_archived_tasks',
  'create_subtask', 'list_subtasks', 'update_subtask', 'move_subtask', 'delete_subtask',
])
