import type { PluginManifest } from '@pixel-city/core/plugin'
import { FilesIcon } from './icons.js'

// ── Plugin manifest ─────────────────────────────────────────────

export const filesManifest: PluginManifest = {
  id: 'files',
  name: 'Files',
  icon: FilesIcon,
  order: 30,
  description: 'File browser and editor',
  builtIn: true,
}

// ── DI exports ──────────────────────────────────────────────────

export { getFilesAdapter, setFilesAdapter } from './adapter/index.js'
export type { FilesAdapter, FsEntry, FsListResult } from './adapter/index.js'

// ── Types ───────────────────────────────────────────────────────

export type {
  FileNode,
  GitStatus,
  OpenTab,
  MediaType,
  EditorSettings,
  FilesSessionStore,
  SearchMatch,
  SearchFileResult,
  SearchOptions,
  SearchResult,
} from './types.js'

// ── Constants & Utils ───────────────────────────────────────────

export {
  IGNORED,
  LANGUAGE_MAP,
  GIT_STATUS_COLORS,
  SPECIAL_FOLDER_COLORS,
  FILE_ICON_MAP,
} from './constants.js'

export {
  getMediaType,
  getLanguage,
  getFolderColor,
  getFileIconData,
  getGitStatusForPath,
} from './utils.js'

// ── Path utilities ──────────────────────────────────────────────

export * as posixPath from './path.js'

// ── Tree utilities ──────────────────────────────────────────────

export { buildTreeFromPaths, flattenTree, updateFolderChildren } from './tree/index.js'

// ── Icons ───────────────────────────────────────────────────────

export { FilesIcon } from './icons.js'
