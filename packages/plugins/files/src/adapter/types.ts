import type { SearchOptions, SearchResult, FileNode } from '../types.js'

// ── Filesystem entry (returned by list/stat) ────────────────────

export interface FsEntry {
  name: string
  path: string
  isDirectory: boolean
  isSymlink: boolean
  size: number
  modified: number
}

export interface FsListResult {
  path: string
  entries: FsEntry[]
}

// ── FilesAdapter ────────────────────────────────────────────────
//
// Platform abstraction for all I/O the file explorer needs.
// Terminal-app implements this with Node.js fs/child_process.
// Web-app implements this with gateway WebSocket RPC.

export interface FilesAdapter {
  // ── Core filesystem ──
  list(dirPath: string, opts?: { showHidden?: boolean }): Promise<FsListResult>
  readFile(filePath: string): Promise<{ content: string; size: number }>
  writeFile(filePath: string, content: string): Promise<void>
  create(targetPath: string, isDirectory: boolean): Promise<void>
  delete(targetPath: string): Promise<void>
  rename(oldPath: string, newPath: string): Promise<void>
  stat(targetPath: string): Promise<FsEntry>

  // ── Git ──
  gitStatus(cwd: string): Promise<Map<string, string>>
  gitFiles(cwd: string): Promise<string[]>
  gitBranch(cwd: string): Promise<string | null>

  // ── Tree building ──
  /** Build a full file tree for a directory. Implementations may use git ls-files
   *  or plain directory reads depending on platform capabilities. */
  buildTree(cwd: string): Promise<FileNode[]>

  // ── Optional capabilities ──
  /** Watch a directory for changes. Returns an unsubscribe function. */
  watch?(dirPath: string, cb: (event: string, filename: string) => void): () => void

  /** Copy text to clipboard. */
  copyToClipboard?(text: string): void

  /** Reveal file in OS file manager (Electron only). */
  revealInFileManager?(filePath: string): void

  /** Search across files. */
  search?(opts: SearchOptions): Promise<SearchResult>

  /** Read a media file as a data URL (for image/video/audio preview). */
  readMediaFile?(filePath: string): Promise<{ name: string; dataUrl: string } | null>

  /** Move a file/folder to a destination directory. Returns the new path. */
  move?(sourcePath: string, destDir: string): Promise<string | null>

  /** Copy a file/folder to a destination directory. Returns the new path. */
  copy?(sourcePath: string, destDir: string): Promise<string | null>

  /** Build a remote URL for a file (e.g. GitHub link). */
  buildRemoteFileUrl?(cwd: string, filePath: string, remoteName?: string): string | null

  /** Get list of git remotes. */
  getGitRemotes?(cwd: string): string[]

  /** Check if a path exists. */
  exists?(filePath: string): Promise<boolean>

  /** Read directory entries (shallow, non-recursive). */
  readDirShallow?(dirPath: string): Promise<FileNode[]>
}
