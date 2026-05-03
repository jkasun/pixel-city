export interface ChangelogEntry {
  action: string
  by: string
  at: string
  source: 'manual' | 'mcp'
  from?: string
  to?: string
}

export interface Task {
  id: string
  title: string
  description?: string
  tags: { label: string; color?: 'accent' | 'warm' | 'error' }[]
  assignee?: string
  type?: 'task' | 'story'
  subtasks?: BoardData
  createdBy?: string
  createdAt: string
  updatedAt: string
  changelog?: ChangelogEntry[]
}

export interface Column {
  key: string
  label: string
  color: string
}

export interface BoardData {
  columns: Record<string, Task[]>
  nextId: number
}

export interface AgentOption {
  key: string
  name: string
  color: string
  palette?: number
  type: 'employee' | 'spawned' | 'temp'
}

export interface SpawnedAgent {
  id: string
  name: string
  palette: number
}

export interface BoardViewProps {
  projectCwd: string | null
  buildingId: string | null
  spawnedAgents: SpawnedAgent[]
  onSpawnTempAgent: (model: string) => { key: string; name: string; palette: number }
  onAutoStartTask?: (taskId: string, taskTitle: string, assigneeKey: string) => void
}

export interface AgentTaskPanelProps {
  projectCwd: string | null
  buildingId: string | null
  selectedAgentKey: string | null
  selectedAgentName: string | null
  selectedEmployeeKey?: string | null
}

/**
 * BoardStore -- abstract persistence layer for board data.
 * Implementations: InMemoryBoardStore, local SQLite-backed store, etc.
 */
export interface BoardStore {
  load(buildingId: string | null): Promise<{ success: boolean; board?: BoardData; error?: string }>
  save(board: BoardData, buildingId: string | null): Promise<{ success: boolean; error?: string }>
  list(): Promise<{ success: boolean; boards: string[]; error?: string }>
  subscribe?(buildingId: string | null, callback: (board: BoardData | null) => void): () => void
}
