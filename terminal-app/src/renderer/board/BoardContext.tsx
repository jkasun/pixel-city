import React, { createContext, useContext, useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { loadNotificationSettings } from '../settings/settingsManager.js'
import { useWorldContext } from '../contexts/WorldContext.js'
import { useOfficeContext } from '../contexts/OfficeContext.js'
import { loadBoardFromRtdb, saveBoardToRtdb, subscribeToBoardUpdates } from './taskDbLocal.js'
import { subscribeToEmployeeUpdates } from '../employee/employeeDbLocal'
import type {
  BoardData, Task, ChangelogEntry, AgentOption, SpawnedAgent, Column,
  BoardViewProps,
} from './boardTypes'
import { DEFAULT_BOARD, COLUMN_DEFS, BACKLOG_COL, paletteColor } from './boardTypes'
import { platform } from '../platform/index.js'

/** Shallow-clone BoardData along a nested path, only copying columns that are touched.
 *  Much cheaper than JSON.parse(JSON.stringify(root)) for large boards. */
function cloneBoardAlongPath(root: BoardData, path: Array<{ taskId: string; colKey: string }>): { newRoot: BoardData; leaf: BoardData | null } {
  const newRoot: BoardData = { ...root, columns: { ...root.columns } }
  // Shallow-copy each column array that we traverse through
  for (const colKey of Object.keys(newRoot.columns)) {
    newRoot.columns[colKey] = [...newRoot.columns[colKey]]
  }
  let parent = newRoot
  for (let i = 0; i < path.length; i++) {
    const step = path[i]
    const col = parent.columns[step.colKey]
    if (!col) return { newRoot, leaf: null }
    const taskIdx = col.findIndex(t => t.id === step.taskId)
    if (taskIdx === -1) return { newRoot, leaf: null }
    const task = { ...col[taskIdx] }
    col[taskIdx] = task
    if (!task.subtasks) return { newRoot, leaf: null }
    task.subtasks = { ...task.subtasks, columns: { ...task.subtasks.columns } }
    for (const ck of Object.keys(task.subtasks.columns)) {
      task.subtasks.columns[ck] = [...task.subtasks.columns[ck]]
    }
    parent = task.subtasks
  }
  return { newRoot, leaf: parent }
}

// ── Story edit context ──

interface StoryEditCtx {
  taskId: string
  colKey: string
  parentPath: Array<{ taskId: string; colKey: string }>
}

// ── Context value ──

export interface BoardContextValue {
  // Core data
  board: BoardData
  loaded: boolean
  columns: Record<string, Task[]>
  agentOptions: AgentOption[]
  buildingId: string | null

  // Story navigation
  storyPath: Array<{ taskId: string; colKey: string }>
  setStoryPath: React.Dispatch<React.SetStateAction<Array<{ taskId: string; colKey: string }>>>
  currentStory: Task | null
  breadcrumbs: Array<{ label: string; depth: number }>

  // UI state
  addingToCol: string | null
  setAddingToCol: (col: string | null) => void
  detailOpen: { taskId: string; colKey: string } | null
  setDetailOpen: (detail: { taskId: string; colKey: string } | null) => void
  editingStoryCtx: StoryEditCtx | null
  setEditingStoryCtx: (ctx: StoryEditCtx | null) => void

  // Drag
  dragOverCol: string | null
  dropIndex: number | null
  draggingTaskId: string | null
  handleDragStart: (taskId: string, fromCol: string) => void
  handleDragOver: (e: React.DragEvent, colKey: string) => void
  handleDragLeave: (colKey: string) => void
  handleDrop: (toCol: string) => void

  // Task CRUD
  handleAddTask: (colKey: string, title: string, type?: 'task' | 'story') => void
  handleUpdateTask: (taskId: string, colKey: string, updates: Partial<Task>) => void
  handleDeleteTask: (taskId: string, colKey: string) => void
  handleArchiveTask: (taskId: string, colKey: string) => void
  handleArchiveAllClosed: () => void
  handleAssign: (taskId: string, colKey: string, agentKey: string | undefined) => void

  // Agent state — maps assignee keys (e.g. "agent:5001", "emp:latte-cheddar") to worker status
  assigneeWorkerStatusMap: Map<string, 'idle' | 'working' | 'tool'>

  // Backlog
  showBacklog: boolean
  setShowBacklog: React.Dispatch<React.SetStateAction<boolean>>
  handleSendToBacklog: (taskId: string, colKey: string) => void
  handleRestoreFromBacklog: (taskId: string, targetCol?: string) => void

  // Highlight (navigate-to-task)
  highlightedTaskId: string | null

  // Navigation
  handleOpenDetail: (taskId: string, colKey: string) => void
  handleOpenAgentSession: (taskId: string, colKey: string) => void
  handleEditStoryDetail: (taskId: string, colKey: string) => void
  handleBreadcrumbEditStory: (depth: number) => void
  handleUpdateParentStory: (updates: Partial<Task>) => void

  // Story edit dialog handlers
  handleUpdateStory: (taskId: string, colKey: string, updates: Partial<Task>) => void
  handleAssignStory: (taskId: string, colKey: string, agentKey: string | undefined) => void
  handleDeleteStory: (taskId: string, colKey: string) => void
}

const BoardContext = createContext<BoardContextValue | null>(null)

export function useBoardContext(): BoardContextValue {
  const ctx = useContext(BoardContext)
  if (!ctx) throw new Error('useBoardContext must be used within BoardProvider')
  return ctx
}

// ── Provider ──

export function BoardProvider({
  projectCwd, buildingId, spawnedAgents, onSpawnTempAgent, onAutoStartTask, children,
}: BoardViewProps & { children: React.ReactNode }) {
  /** Ensure a board always has a valid columns object with all expected keys (recursively for story subtasks). */
  const normalizeBoard = useCallback((b: BoardData): BoardData => {
    if (!b || typeof b !== 'object') return { ...DEFAULT_BOARD }
    const cols = b.columns && typeof b.columns === 'object' ? { ...b.columns } : { ...DEFAULT_BOARD.columns }
    for (const key of Object.keys(DEFAULT_BOARD.columns)) {
      if (!Array.isArray(cols[key])) cols[key] = []
    }
    // Recursively normalize subtasks inside story tasks
    for (const key of Object.keys(cols)) {
      cols[key] = cols[key].map(task =>
        task.type === 'story' && task.subtasks
          ? { ...task, subtasks: normalizeBoard(task.subtasks) }
          : task
      )
    }
    return { ...b, columns: cols, nextId: b.nextId ?? 1 }
  }, [])

  const [board, setBoard] = useState<BoardData>(DEFAULT_BOARD)
  const [loaded, setLoaded] = useState(false)
  const [addingToCol, setAddingToCol] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState<{ taskId: string; colKey: string } | null>(null)
  const [editingStoryCtx, setEditingStoryCtx] = useState<StoryEditCtx | null>(null)
  const [storyPath, setStoryPath] = useState<Array<{ taskId: string; colKey: string }>>([])
  const [showBacklog, setShowBacklog] = useState(false)
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null)
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [employees, setEmployees] = useState<Array<{ id: string; name: string; palette: number }>>([])
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const boardRef = useRef(board)
  boardRef.current = board

  const { setActiveView } = useWorldContext()
  const { setActiveAgentId, agentWorkerStatusMap } = useOfficeContext()

  // ── Employees (realtime, filtered to current office) ──
  useEffect(() => {
    let unsubscribe: (() => void) | null = null
    try {
      unsubscribe = subscribeToEmployeeUpdates((emps) => {
        const filtered = emps.filter(emp => {
          const empOffice = emp.settings.officeId ?? null
          const currentOffice = buildingId ?? null
          return empOffice === currentOffice
        })
        setEmployees(filtered.map(emp => ({
          id: emp.id,
          name: emp.settings.name,
          palette: emp.settings.palette ?? 0,
        })))
      })
    } catch {
      // Subscription may fail if auth isn't ready — employees will load on retry
    }
    return () => unsubscribe?.()
  }, [buildingId])

  // ── Agent options ──
  const agentOptions: AgentOption[] = useMemo(() => {
    const opts: AgentOption[] = []
    const employeeNames = new Set<string>()
    for (const emp of employees) {
      employeeNames.add(emp.name)
      opts.push({ key: `emp:${emp.id}`, name: emp.name, color: paletteColor(emp.palette), palette: emp.palette, type: 'employee' })
    }
    for (const agent of spawnedAgents) {
      if (employeeNames.has(agent.name)) continue
      opts.push({ key: `agent:${agent.id}`, name: agent.name, color: paletteColor(agent.palette), palette: agent.palette, type: 'spawned' })
    }
    opts.push({ key: 'temp:sonnet', name: 'New agent (Sonnet)', color: '#5ac8e8', type: 'temp' })
    opts.push({ key: 'temp:opus', name: 'New agent (Opus)', color: '#c87aff', type: 'temp' })
    return opts
  }, [employees, spawnedAgents])

  // ── Assignee worker status map (maps assignee keys to worker status) ──
  const assigneeWorkerStatusMap = useMemo(() => {
    const map = new Map<string, 'idle' | 'working' | 'tool'>()
    for (const [agentId, status] of agentWorkerStatusMap) {
      // Direct agent key
      map.set(`agent:${agentId}`, status)
      // Find matching employee by name
      const spawnedAgent = spawnedAgents.find(a => a.id === agentId)
      if (spawnedAgent) {
        const emp = employees.find(e => e.name === spawnedAgent.name)
        if (emp) map.set(`emp:${emp.id}`, status)
      }
    }
    return map
  }, [agentWorkerStatusMap, spawnedAgents, employees])

  // ── Load board ──
  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    setBoard(DEFAULT_BOARD)
    ;(async () => {
      const result = await loadBoardFromRtdb(buildingId)
      if (cancelled) return
      if (result.success && result.board) {
        setBoard(normalizeBoard(result.board))
      }
      setLoaded(true)
    })()
    return () => { cancelled = true }
  }, [buildingId])

  // ── Listen for external board changes ──
  useEffect(() => {
    const handler = (e: Event) => {
      const { projectDir: pd, buildingId: bid, board: newBoard, source } = (e as CustomEvent).detail
      if (source === 'boardview') return
      if ((pd === undefined || pd === null || pd === projectCwd) && bid === buildingId) {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        setBoard(normalizeBoard(newBoard as BoardData))
      }
    }
    window.addEventListener('pixelcity:board-updated', handler)
    return () => window.removeEventListener('pixelcity:board-updated', handler)
  }, [projectCwd, buildingId])

  // ── Persist (debounced) ──
  const persist = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      const b = boardRef.current
      saveBoardToRtdb(b, buildingId)
      window.dispatchEvent(new CustomEvent('pixelcity:board-updated', { detail: { projectDir: projectCwd, buildingId, board: b, source: 'boardview' } }))
    }, 500)
  }, [projectCwd, buildingId])

  const updateBoard = useCallback((updater: (prev: BoardData) => BoardData) => {
    setBoard(prev => normalizeBoard(updater(prev)))
  }, [])

  useEffect(() => {
    if (loaded) persist()
  }, [board, loaded, persist])

  // ── Resolve nested boards ──
  const resolveBoard = useCallback((root: BoardData, path: Array<{ taskId: string; colKey: string }>): BoardData | null => {
    let current = root
    for (const step of path) {
      const tasks = current.columns[step.colKey]
      const story = tasks?.find(t => t.id === step.taskId)
      if (!story || story.type !== 'story' || !story.subtasks) return null
      current = story.subtasks
    }
    return current
  }, [])

  const updateNestedBoard = useCallback((path: Array<{ taskId: string; colKey: string }>, updater: (b: BoardData) => BoardData) => {
    if (path.length === 0) {
      updateBoard(updater)
    } else {
      updateBoard(root => {
        const { newRoot, leaf } = cloneBoardAlongPath(root, path.slice(0, -1))
        if (!leaf) return root
        const last = path[path.length - 1]
        const col = leaf.columns[last.colKey]
        if (!col) return root
        const taskIdx = col.findIndex(t => t.id === last.taskId)
        if (taskIdx === -1) return root
        const task = { ...col[taskIdx] }
        col[taskIdx] = task
        if (!task.subtasks) return root
        task.subtasks = updater(task.subtasks)
        return newRoot
      })
    }
  }, [updateBoard])

  const activeBoard = resolveBoard(board, storyPath)
  const columns = (activeBoard ?? board).columns

  // ── Current story ──
  const currentStory = useMemo(() => {
    if (storyPath.length === 0) return null
    let current = board
    for (let i = 0; i < storyPath.length - 1; i++) {
      const step = storyPath[i]
      const task = current.columns[step.colKey]?.find(t => t.id === step.taskId)
      if (!task?.subtasks) return null
      current = task.subtasks
    }
    const last = storyPath[storyPath.length - 1]
    return current.columns[last.colKey]?.find(t => t.id === last.taskId) ?? null
  }, [board, storyPath])

  // ── Breadcrumbs ──
  const breadcrumbs = useMemo(() => {
    const crumbs: Array<{ label: string; depth: number }> = [{ label: 'Board', depth: 0 }]
    let current = board
    for (let i = 0; i < storyPath.length; i++) {
      const step = storyPath[i]
      const task = current.columns[step.colKey]?.find(t => t.id === step.taskId)
      if (!task?.subtasks) break
      crumbs.push({ label: `${task.id}: ${task.title}`, depth: i + 1 })
      current = task.subtasks
    }
    return crumbs
  }, [board, storyPath])

  // ── Drag state ──
  const dragRef = useRef<{ taskId: string; fromCol: string } | null>(null)
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null)
  const dragRafRef = useRef<number | null>(null)

  const handleDragStart = useCallback((taskId: string, fromCol: string) => {
    dragRef.current = { taskId, fromCol }
    setDraggingTaskId(taskId)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, colKey: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverCol(colKey)
    // Throttle expensive DOM queries to once per animation frame
    const mouseY = e.clientY
    const body = e.currentTarget as HTMLElement
    if (dragRafRef.current !== null) return
    dragRafRef.current = requestAnimationFrame(() => {
      dragRafRef.current = null
      const cards = body.querySelectorAll('.board-card')
      let idx = cards.length
      for (let i = 0; i < cards.length; i++) {
        const rect = cards[i].getBoundingClientRect()
        if (mouseY < rect.top + rect.height / 2) { idx = i; break }
      }
      setDropIndex(idx)
    })
  }, [])

  const handleDragLeave = useCallback((colKey: string) => {
    setDragOverCol(prev => prev === colKey ? null : prev)
    setDropIndex(null)
  }, [])

  const handleDrop = useCallback((toCol: string) => {
    const drag = dragRef.current
    if (!drag) return

    const ab = resolveBoard(boardRef.current, storyPath)
    const droppedTask = (ab?.columns[drag.fromCol] ?? []).find(t => t.id === drag.taskId)

    updateNestedBoard(storyPath, prev => {
      const next = { ...prev, columns: { ...prev.columns } }
      const fromTasks = [...(next.columns[drag.fromCol] ?? [])]
      const taskIdx = fromTasks.findIndex(t => t.id === drag.taskId)
      if (taskIdx === -1) return prev

      const [task] = fromTasks.splice(taskIdx, 1)
      const now = new Date().toISOString()
      task.updatedAt = now
      if (drag.fromCol !== toCol) {
        if (!task.changelog) task.changelog = []
        task.changelog.push({ action: 'moved', by: 'manual', at: now, source: 'manual', from: drag.fromCol, to: toCol })
      }
      next.columns[drag.fromCol] = fromTasks

      const toTasks = drag.fromCol === toCol ? fromTasks : [...(next.columns[toCol] ?? [])]
      const insertAt = dropIndex !== null ? Math.min(dropIndex, toTasks.length) : toTasks.length
      toTasks.splice(insertAt, 0, task)
      next.columns[toCol] = toTasks
      return next
    })

    if (toCol === 'todo' && drag.fromCol !== 'todo' && droppedTask?.assignee) {
      onAutoStartTask?.(droppedTask.id, droppedTask.title, droppedTask.assignee)
    }
    if (toCol === 'closed' && drag.fromCol !== 'closed' && droppedTask) {
      const notifSettings = loadNotificationSettings()
      if (notifSettings.onTaskClosed) {
        platform().notification.send('Task moved to Closed', `${droppedTask.id}: ${droppedTask.title}`)
      }
    }

    dragRef.current = null
    setDragOverCol(null)
    setDropIndex(null)
    setDraggingTaskId(null)
  }, [dropIndex, updateNestedBoard, storyPath, resolveBoard, onAutoStartTask])

  useEffect(() => {
    const handleDragEnd = () => {
      setDraggingTaskId(null)
      dragRef.current = null
      setDragOverCol(null)
      setDropIndex(null)
    }
    document.addEventListener('dragend', handleDragEnd)
    return () => document.removeEventListener('dragend', handleDragEnd)
  }, [])

  // ── Task CRUD ──

  const handleAddTask = useCallback((colKey: string, title: string, type: 'task' | 'story' = 'task') => {
    const now = new Date().toISOString()
    updateBoard(root => {
      const { newRoot, leaf } = cloneBoardAlongPath(root, storyPath)
      const target = leaf ?? newRoot
      const id = `PC-${newRoot.nextId}`
      newRoot.nextId++
      const task: Task = {
        id, title, tags: [], type,
        createdBy: 'manual',
        createdAt: now, updatedAt: now,
        changelog: [{ action: 'created', by: 'manual', at: now, source: 'manual', to: colKey }],
        ...(type === 'story' ? { subtasks: { columns: { planning: [], planned: [], todo: [], progress: [], testing: [], closed: [], archived: [], backlog: [] }, nextId: 1 } } : {}),
      }
      if (!target.columns[colKey]) target.columns[colKey] = []
      target.columns[colKey].push(task)
      return newRoot
    })
    setAddingToCol(null)
  }, [updateBoard, storyPath])

  const handleUpdateTask = useCallback((taskId: string, colKey: string, updates: Partial<Task>) => {
    updateNestedBoard(storyPath, prev => {
      const tasks = prev.columns[colKey]
      if (!tasks) return prev
      return {
        ...prev,
        columns: {
          ...prev.columns,
          [colKey]: tasks.map(t => t.id === taskId ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t),
        },
      }
    })
  }, [updateNestedBoard, storyPath])

  const handleDeleteTask = useCallback((taskId: string, colKey: string) => {
    updateNestedBoard(storyPath, prev => {
      const tasks = prev.columns[colKey]
      if (!tasks) return prev
      return { ...prev, columns: { ...prev.columns, [colKey]: tasks.filter(t => t.id !== taskId) } }
    })
    setDetailOpen(null)
  }, [updateNestedBoard, storyPath])

  const handleArchiveTask = useCallback((taskId: string, colKey: string) => {
    updateNestedBoard(storyPath, prev => {
      const tasks = prev.columns[colKey]
      if (!tasks) return prev
      const idx = tasks.findIndex(t => t.id === taskId)
      if (idx === -1) return prev
      const task = { ...tasks[idx] }
      const now = new Date().toISOString()
      task.updatedAt = now
      if (!task.changelog) task.changelog = []
      task.changelog = [...task.changelog, { action: 'archived', by: 'manual', at: now, source: 'manual', from: colKey, to: 'archived' }]
      return {
        ...prev,
        columns: {
          ...prev.columns,
          [colKey]: tasks.filter(t => t.id !== taskId),
          archived: [...(prev.columns.archived ?? []), task],
        },
      }
    })
    setDetailOpen(null)
  }, [updateNestedBoard, storyPath])

  const handleArchiveAllClosed = useCallback(() => {
    updateNestedBoard(storyPath, prev => {
      const closed = prev.columns.closed ?? []
      if (closed.length === 0) return prev
      const now = new Date().toISOString()
      const archivedTasks: Task[] = closed.map(t => ({
        ...t,
        updatedAt: now,
        changelog: [...(t.changelog ?? []), { action: 'archived', by: 'manual', at: now, source: 'manual' as const, from: 'closed', to: 'archived' }],
      }))
      return {
        ...prev,
        columns: { ...prev.columns, closed: [], archived: [...(prev.columns.archived ?? []), ...archivedTasks] },
      }
    })
  }, [updateNestedBoard, storyPath])

  const handleSendToBacklog = useCallback((taskId: string, colKey: string) => {
    updateNestedBoard(storyPath, prev => {
      const tasks = prev.columns[colKey]
      if (!tasks) return prev
      const idx = tasks.findIndex(t => t.id === taskId)
      if (idx === -1) return prev
      const task = { ...tasks[idx] }
      const now = new Date().toISOString()
      task.updatedAt = now
      if (!task.changelog) task.changelog = []
      task.changelog = [...task.changelog, { action: 'moved', by: 'manual', at: now, source: 'manual' as const, from: colKey, to: 'backlog' }]
      return {
        ...prev,
        columns: {
          ...prev.columns,
          [colKey]: tasks.filter(t => t.id !== taskId),
          backlog: [...(prev.columns.backlog ?? []), task],
        },
      }
    })
    setDetailOpen(null)
  }, [updateNestedBoard, storyPath])

  const handleRestoreFromBacklog = useCallback((taskId: string, targetCol?: string) => {
    const toCol = targetCol ?? 'planning'
    updateNestedBoard(storyPath, prev => {
      const backlog = prev.columns.backlog ?? []
      const idx = backlog.findIndex(t => t.id === taskId)
      if (idx === -1) return prev
      const task = { ...backlog[idx] }
      const now = new Date().toISOString()
      task.updatedAt = now
      if (!task.changelog) task.changelog = []
      task.changelog = [...task.changelog, { action: 'moved', by: 'manual', at: now, source: 'manual' as const, from: 'backlog', to: toCol }]
      return {
        ...prev,
        columns: {
          ...prev.columns,
          backlog: backlog.filter(t => t.id !== taskId),
          [toCol]: [...(prev.columns[toCol] ?? []), task],
        },
      }
    })
  }, [updateNestedBoard, storyPath])

  const handleAssign = useCallback((taskId: string, colKey: string, agentKey: string | undefined) => {
    let resolvedKey = agentKey
    if (agentKey?.startsWith('temp:')) {
      const model = agentKey.slice(5)
      const spawned = onSpawnTempAgent(model)
      resolvedKey = spawned.key
    }
    updateNestedBoard(storyPath, prev => {
      const tasks = prev.columns[colKey]
      if (!tasks) return prev
      return {
        ...prev,
        columns: {
          ...prev.columns,
          [colKey]: tasks.map(t => {
            if (t.id !== taskId) return t
            const now = new Date().toISOString()
            const log: ChangelogEntry[] = [...(t.changelog ?? []), { action: 'assigned', by: 'manual', at: now, source: 'manual', from: t.assignee ?? 'none', to: resolvedKey ?? 'none' }]
            return { ...t, assignee: resolvedKey, updatedAt: now, changelog: log }
          }),
        },
      }
    })
    if (resolvedKey && colKey === 'progress') {
      const ab = resolveBoard(boardRef.current, storyPath)
      const task = ab?.columns[colKey]?.find(t => t.id === taskId)
      if (task) onAutoStartTask?.(task.id, task.title, resolvedKey)
    }
  }, [updateNestedBoard, storyPath, onSpawnTempAgent, resolveBoard, onAutoStartTask])

  // ── Navigation ──

  const handleOpenDetail = useCallback((taskId: string, colKey: string) => {
    const activeCols = (resolveBoard(board, storyPath) ?? board).columns
    const task = activeCols[colKey]?.find(t => t.id === taskId)
    if (task?.type === 'story') {
      setStoryPath(prev => [...prev, { taskId, colKey }])
      setAddingToCol(null)
      setDetailOpen(null)
      return
    }
    setDetailOpen({ taskId, colKey })
  }, [board, storyPath, resolveBoard])

  const handleOpenAgentSession = useCallback((taskId: string, colKey: string) => {
    const activeCols = (resolveBoard(board, storyPath) ?? board).columns
    const task = activeCols[colKey]?.find(t => t.id === taskId)
    if (task?.assignee) {
      let agentId: string | null = null
      if (task.assignee.startsWith('agent:')) {
        agentId = task.assignee.slice(6)
      } else if (task.assignee.startsWith('emp:')) {
        const empName = employees.find(e => `emp:${e.id}` === task.assignee)?.name
        if (empName) {
          const agent = spawnedAgents.find(a => a.name === empName)
          if (agent) agentId = agent.id
        }
      }
      if (agentId !== null) {
        setActiveAgentId(agentId)
        setActiveView('agent')
        return
      }
    }
    handleOpenDetail(taskId, colKey)
  }, [board, storyPath, resolveBoard, employees, spawnedAgents, setActiveAgentId, setActiveView, handleOpenDetail])

  const handleEditStoryDetail = useCallback((taskId: string, colKey: string) => {
    setEditingStoryCtx({ taskId, colKey, parentPath: [...storyPath] })
  }, [storyPath])

  const handleBreadcrumbEditStory = useCallback((depth: number) => {
    const step = storyPath[depth - 1]
    if (!step) return
    setEditingStoryCtx({ taskId: step.taskId, colKey: step.colKey, parentPath: storyPath.slice(0, depth - 1) })
  }, [storyPath])

  const handleUpdateParentStory = useCallback((updates: Partial<Task>) => {
    if (storyPath.length === 0) return
    const parentPath = storyPath.slice(0, -1)
    const last = storyPath[storyPath.length - 1]
    updateNestedBoard(parentPath, prev => {
      const tasks = prev.columns[last.colKey]
      if (!tasks) return prev
      return {
        ...prev,
        columns: {
          ...prev.columns,
          [last.colKey]: tasks.map(t => {
            if (t.id !== last.taskId) return t
            const now = new Date().toISOString()
            return { ...t, ...updates, updatedAt: now }
          }),
        },
      }
    })
  }, [storyPath, updateNestedBoard])

  // ── Story edit dialog handlers ──

  const handleUpdateStory = useCallback((taskId: string, colKey: string, updates: Partial<Task>) => {
    if (!editingStoryCtx) return
    updateNestedBoard(editingStoryCtx.parentPath, prev => {
      const tasks = prev.columns[colKey]
      if (!tasks) return prev
      return {
        ...prev,
        columns: {
          ...prev.columns,
          [colKey]: tasks.map(t => {
            if (t.id !== taskId) return t
            const now = new Date().toISOString()
            const log: ChangelogEntry[] = [...(t.changelog ?? []), { action: 'updated', by: 'manual', at: now, source: 'manual' }]
            return { ...t, ...updates, updatedAt: now, changelog: log }
          }),
        },
      }
    })
  }, [editingStoryCtx, updateNestedBoard])

  const handleAssignStory = useCallback((taskId: string, colKey: string, agentKey: string | undefined) => {
    if (!editingStoryCtx) return
    let resolvedKey = agentKey
    if (agentKey?.startsWith('temp:')) {
      const model = agentKey.slice(5)
      const spawned = onSpawnTempAgent(model)
      resolvedKey = spawned.key
    }
    updateNestedBoard(editingStoryCtx.parentPath, prev => {
      const tasks = prev.columns[colKey]
      if (!tasks) return prev
      return {
        ...prev,
        columns: {
          ...prev.columns,
          [colKey]: tasks.map(t => {
            if (t.id !== taskId) return t
            const now = new Date().toISOString()
            const log: ChangelogEntry[] = [...(t.changelog ?? []), { action: 'assigned', by: 'manual', at: now, source: 'manual', from: t.assignee ?? 'none', to: resolvedKey ?? 'none' }]
            return { ...t, assignee: resolvedKey, updatedAt: now, changelog: log }
          }),
        },
      }
    })
  }, [editingStoryCtx, updateNestedBoard, onSpawnTempAgent])

  const handleDeleteStory = useCallback((taskId: string, colKey: string) => {
    if (!editingStoryCtx) return
    updateNestedBoard(editingStoryCtx.parentPath, prev => {
      const tasks = prev.columns[colKey]
      if (!tasks) return prev
      return { ...prev, columns: { ...prev.columns, [colKey]: tasks.filter(t => t.id !== taskId) } }
    })
    setEditingStoryCtx(null)
  }, [editingStoryCtx, updateNestedBoard])

  // ── Navigate-to-task handler (recursive board search) ──

  const findTaskInBoard = useCallback((
    root: BoardData,
    taskId: string,
  ): { path: Array<{ taskId: string; colKey: string }>; colKey: string } | null => {
    // Search top-level columns first
    for (const colKey of Object.keys(root.columns)) {
      for (const task of root.columns[colKey] ?? []) {
        if (task.id === taskId) return { path: [], colKey }
        // Search inside stories recursively
        if (task.type === 'story' && task.subtasks) {
          const nested = findTaskInBoard(task.subtasks, taskId)
          if (nested) return { path: [{ taskId: task.id, colKey }, ...nested.path], colKey: nested.colKey }
        }
      }
    }
    return null
  }, [])

  const findTaskByAssignee = useCallback((
    root: BoardData,
    matchKeys: Set<string>,
  ): { taskId: string; path: Array<{ taskId: string; colKey: string }>; colKey: string } | null => {
    // Priority order: progress > todo > testing > planned > planning
    const colPriority = ['progress', 'todo', 'testing', 'planned', 'planning']
    for (const colKey of colPriority) {
      for (const task of root.columns[colKey] ?? []) {
        if (task.assignee && matchKeys.has(task.assignee)) return { taskId: task.id, path: [], colKey }
      }
    }
    // Search inside stories
    for (const colKey of Object.keys(root.columns)) {
      for (const task of root.columns[colKey] ?? []) {
        if (task.type === 'story' && task.subtasks) {
          const nested = findTaskByAssignee(task.subtasks, matchKeys)
          if (nested) return { taskId: nested.taskId, path: [{ taskId: task.id, colKey }, ...nested.path], colKey: nested.colKey }
        }
      }
    }
    return null
  }, [])

  // Highlight + scroll to a task card in the board
  const highlightAndScroll = useCallback((taskId: string) => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
    setHighlightedTaskId(taskId)
    // Scroll into view after React re-renders (story path may have changed)
    requestAnimationFrame(() => {
      const el = document.querySelector(`.board-card[data-task-id="${taskId}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    })
    highlightTimerRef.current = setTimeout(() => setHighlightedTaskId(null), 3000)
  }, [])

  // Listen for pixelcity:navigate-to-task — find by task ID and navigate
  useEffect(() => {
    const handler = (e: Event) => {
      const { taskId: targetId, buildingId: bid } = (e as CustomEvent).detail
      if (bid !== undefined && bid !== buildingId) return
      const result = findTaskInBoard(board, targetId)
      if (result) {
        setStoryPath(result.path)
        highlightAndScroll(targetId)
      }
    }
    window.addEventListener('pixelcity:navigate-to-task', handler)
    return () => window.removeEventListener('pixelcity:navigate-to-task', handler)
  }, [board, buildingId, findTaskInBoard, highlightAndScroll])

  // Listen for pixelcity:select-agent-task — find by assignee keys and navigate
  useEffect(() => {
    const handler = (e: Event) => {
      const { agentKey, employeeKey, buildingId: bid } = (e as CustomEvent).detail
      if (bid !== undefined && bid !== buildingId) return
      const matchKeys = new Set<string>()
      if (agentKey) matchKeys.add(agentKey)
      if (employeeKey) matchKeys.add(employeeKey)
      if (matchKeys.size === 0) return
      const result = findTaskByAssignee(board, matchKeys)
      if (result) {
        setStoryPath(result.path)
        highlightAndScroll(result.taskId)
      }
    }
    window.addEventListener('pixelcity:select-agent-task', handler)
    return () => window.removeEventListener('pixelcity:select-agent-task', handler)
  }, [board, buildingId, findTaskByAssignee, highlightAndScroll])

  // ── Context value ──

  const value = useMemo<BoardContextValue>(() => ({
    board, loaded, columns, agentOptions, buildingId,
    storyPath, setStoryPath, currentStory, breadcrumbs,
    addingToCol, setAddingToCol, detailOpen, setDetailOpen, editingStoryCtx, setEditingStoryCtx,
    dragOverCol, dropIndex, draggingTaskId,
    handleDragStart, handleDragOver, handleDragLeave, handleDrop,
    handleAddTask, handleUpdateTask, handleDeleteTask, handleArchiveTask, handleArchiveAllClosed, handleAssign,
    assigneeWorkerStatusMap,
    highlightedTaskId,
    showBacklog, setShowBacklog, handleSendToBacklog, handleRestoreFromBacklog,
    handleOpenDetail, handleOpenAgentSession, handleEditStoryDetail, handleBreadcrumbEditStory, handleUpdateParentStory,
    handleUpdateStory, handleAssignStory, handleDeleteStory,
  }), [
    board, loaded, columns, agentOptions, buildingId,
    storyPath, currentStory, breadcrumbs,
    addingToCol, detailOpen, editingStoryCtx, highlightedTaskId,
    dragOverCol, dropIndex, draggingTaskId,
    handleDragStart, handleDragOver, handleDragLeave, handleDrop,
    handleAddTask, handleUpdateTask, handleDeleteTask, handleArchiveTask, handleArchiveAllClosed, handleAssign,
    assigneeWorkerStatusMap,
    showBacklog, handleSendToBacklog, handleRestoreFromBacklog,
    handleOpenDetail, handleOpenAgentSession, handleEditStoryDetail, handleBreadcrumbEditStory, handleUpdateParentStory,
    handleUpdateStory, handleAssignStory, handleDeleteStory,
  ])

  return <BoardContext.Provider value={value}>{children}</BoardContext.Provider>
}
