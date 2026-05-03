import type { BoardData, Column } from './types.js'

export const PALETTE_COLORS = [
  '#5ac88c', '#6b8fb5', '#c97b7b', '#c4894a',
  '#a07bb5', '#6ba5a0', '#b5a06b', '#8b8b8b',
]

export function paletteColor(p: number): string {
  return PALETTE_COLORS[p % PALETTE_COLORS.length]
}

export const COLUMN_DEFS: Column[] = [
  { key: 'planning', label: 'In Planning', color: '#7c6f9b' },
  { key: 'planned', label: 'Planned', color: '#a07cc8' },
  { key: 'todo', label: 'Todo', color: '#5ac88c' },
  { key: 'progress', label: 'In Progress', color: '#c49a6c' },
  { key: 'testing', label: 'Testing', color: '#6a9bc4' },
  { key: 'closed', label: 'Closed', color: '#555' },
]

export const BACKLOG_COL: Column = { key: 'backlog', label: 'Backlog', color: '#8b8b8b' }

export const DEFAULT_BOARD: BoardData = {
  columns: {
    planning: [],
    planned: [],
    todo: [],
    progress: [],
    testing: [],
    closed: [],
    archived: [],
    backlog: [],
  },
  nextId: 1,
}

export function initials(name: string): string {
  const parts = name.split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

export function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[d.getMonth()]} ${d.getDate()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
