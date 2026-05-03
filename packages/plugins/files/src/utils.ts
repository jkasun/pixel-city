import { LANGUAGE_MAP, SPECIAL_FOLDER_COLORS, FILE_ICON_MAP } from './constants.js'
import type { MediaType } from './types.js'

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'avif', 'tiff', 'tif'])
const VIDEO_EXTS = new Set(['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'opus'])

export function getMediaType(filename: string): MediaType {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (AUDIO_EXTS.has(ext)) return 'audio'
  return null
}

export function getLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return LANGUAGE_MAP[ext] || 'plaintext'
}

export function getFolderColor(name: string): string {
  return SPECIAL_FOLDER_COLORS[name.toLowerCase()] || '#90a4ae'
}

export function getFileIconData(ext: string, lowerName: string): { color: string; letter: string } {
  // Special filenames
  if (lowerName === 'package.json') return { color: '#66bb6a', letter: 'N' }
  if (lowerName === 'tsconfig.json') return { color: '#3178c6', letter: 'TS' }
  if (lowerName === '.gitignore') return { color: '#f54d27', letter: '' }
  if (lowerName === 'dockerfile') return { color: '#2496ed', letter: 'D' }
  if (lowerName === 'makefile') return { color: '#6d8086', letter: 'M' }
  if (lowerName === '.env' || lowerName.startsWith('.env.')) return { color: '#fbc02d', letter: '' }
  if (lowerName === 'readme.md') return { color: '#42a5f5', letter: '' }
  if (lowerName === 'license' || lowerName === 'license.md') return { color: '#ffa726', letter: '' }
  if (lowerName.endsWith('.config.ts') || lowerName.endsWith('.config.js')) return { color: '#78909c', letter: '' }

  return FILE_ICON_MAP[ext] || { color: '#6d8086', letter: '' }
}

/** Compute git status for a path, propagating child status for folders */
export function getGitStatusForPath(
  path: string,
  isFolder: boolean,
  gitStatus: Map<string, string | null>,
): string | null {
  if (!isFolder) return gitStatus.get(path) ?? null
  let folderStatus: string | null = null
  for (const [filePath, status] of gitStatus) {
    if (filePath.startsWith(path + '/')) {
      if (status === 'added' || status === 'untracked') return status
      if (status === 'modified') folderStatus = 'modified'
      else if (!folderStatus) folderStatus = status
    }
  }
  return folderStatus
}
