// ── Types ────────────────────────────────────────────────────────

export type GitStatus = 'modified' | 'added' | 'untracked' | 'deleted' | 'renamed' | null

export interface FileNode {
  id: string
  name: string
  children?: FileNode[]
  isFolder: boolean
}

export type MediaType = 'image' | 'pdf' | 'video' | 'audio' | null

export interface OpenTab {
  path: string
  name: string
  content: string
  modified: boolean
  mediaType?: MediaType
}

// ── Search types ────────────────────────────────────────────────

export interface SearchMatch {
  line: number
  column: number
  length: number
  text: string        // full line text
  beforeText: string  // text before match (for highlight)
  matchText: string   // the matched text
  afterText: string   // text after match
}

export interface SearchFileResult {
  filePath: string
  relativePath: string
  matches: SearchMatch[]
}

export interface SearchOptions {
  query: string
  cwd: string
  isRegex?: boolean
  isCaseSensitive?: boolean
  isWholeWord?: boolean
  includeGlob?: string   // e.g. "*.ts,*.tsx"
  excludeGlob?: string   // e.g. "*.test.ts"
}

export interface SearchResult {
  files: SearchFileResult[]
  totalMatches: number
  truncated: boolean
}

// ── Editor settings (portable subset) ───────────────────────────

export interface EditorSettings {
  fontSize?: number
  fontFamily?: string
  minimap?: boolean
  renderWhitespace?: 'none' | 'boundary' | 'selection' | 'trailing' | 'all'
  tabSize?: number
  wordWrap?: 'off' | 'on' | 'wordWrapColumn' | 'bounded'
  lineNumbers?: 'on' | 'off' | 'relative'
  bracketPairColorization?: boolean
}

// ── Session persistence ─────────────────────────────────────────

export interface FilesSessionStore {
  save(projectId: string, data: { openPaths: { path: string; name: string }[]; activeTabPath: string | null }): void
  load(projectId: string): { openPaths: { path: string; name: string }[]; activeTabPath: string | null } | null
}
