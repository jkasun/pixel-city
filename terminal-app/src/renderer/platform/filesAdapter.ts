/**
 * TerminalFilesAdapter — implements FilesAdapter for the Electron desktop app.
 *
 * Wraps existing Node.js-based file operations and git utilities.
 * This is the "glue" that connects the shared plugin-files components
 * to Electron's native filesystem access.
 */

import type { FilesAdapter, FsEntry, FsListResult } from '@pixel-city/plugin-files/adapter'
import type { FileNode, SearchOptions, SearchResult } from '@pixel-city/plugin-files'
import { IGNORED } from '@pixel-city/plugin-files'

const fs = window.require('fs') as typeof import('fs')
const fsPromises = fs.promises
const pathModule = window.require('path') as typeof import('path')
const { execFile, execFileSync } = window.require('child_process') as typeof import('child_process')
const { shell, clipboard } = window.require('electron') as typeof import('electron')
const os = window.require('os') as typeof import('os')

// ── Import existing helpers from the terminal-app ──
import {
  parseGitStatusAsync,
  readFileContent,
  readMediaFile as readMediaFileSync,
  writeFile as writeFileSync,
  createFileOrFolder,
  deleteFileOrFolder,
  renameFileOrFolder,
  moveFileOrFolder,
  copyFileOrFolder,
  getGitRemotes,
  buildRemoteFileUrl,
} from '../files/fileOperations.js'
import { buildTreeFromGitFilesAsync, readDirShallowAsync } from '../files/fileTreeBuilder.js'
import { searchFiles } from '../files/searchFiles.js'

export const terminalFilesAdapter: FilesAdapter = {
  // ── Core filesystem ──

  async list(dirPath, opts) {
    const entries: FsEntry[] = []
    const dirents = await fsPromises.readdir(dirPath, { withFileTypes: true })
    for (const d of dirents) {
      if (!opts?.showHidden && d.name.startsWith('.')) continue
      const fullPath = pathModule.join(dirPath, d.name)
      try {
        // stat() follows symlinks — use it for both metadata and dir classification
        // so symlinks pointing to directories appear as folders.
        const stat = await fsPromises.stat(fullPath)
        entries.push({
          name: d.name,
          path: fullPath,
          isDirectory: stat.isDirectory(),
          isSymlink: d.isSymbolicLink(),
          size: stat.size,
          modified: stat.mtimeMs,
        })
      } catch { /* skip unreadable entries */ }
    }
    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return { path: dirPath, entries }
  },

  async readFile(filePath) {
    const stat = await fsPromises.stat(filePath)
    const content = await fsPromises.readFile(filePath, 'utf8')
    return { content, size: stat.size }
  },

  async writeFile(filePath, content) {
    writeFileSync(filePath, content)
  },

  async create(targetPath, isDirectory) {
    createFileOrFolder(targetPath, isDirectory)
  },

  async delete(targetPath) {
    deleteFileOrFolder(targetPath)
  },

  async rename(oldPath, newPath) {
    const newName = pathModule.basename(newPath)
    renameFileOrFolder(oldPath, newName)
  },

  async stat(targetPath) {
    const stat = await fsPromises.stat(targetPath)
    return {
      name: pathModule.basename(targetPath),
      path: targetPath,
      isDirectory: stat.isDirectory(),
      isSymlink: stat.isSymbolicLink(),
      size: stat.size,
      modified: stat.mtimeMs,
    }
  },

  // ── Git ──

  async gitStatus(cwd) {
    const raw = await parseGitStatusAsync(cwd)
    // Filter out null values to match Map<string, string> return type
    const map = new Map<string, string>()
    for (const [k, v] of raw) {
      if (v != null) map.set(k, v)
    }
    return map
  },

  async gitFiles(cwd) {
    return new Promise((resolve) => {
      execFile('git', [
        'ls-files', '--cached', '--others', '--exclude-standard',
      ], { cwd, encoding: 'utf8', timeout: 10000, maxBuffer: 50 * 1024 * 1024 }, (err, stdout) => {
        if (err || !stdout) { resolve([]); return }
        resolve(stdout.split('\n').filter(Boolean))
      })
    })
  },

  async gitBranch(cwd) {
    try {
      return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8', timeout: 3000 }).trim()
    } catch { return null }
  },

  // ── Tree building ──

  async buildTree(cwd) {
    return buildTreeFromGitFilesAsync(cwd)
  },

  // ── Optional capabilities ──

  watch(dirPath, cb) {
    try {
      const watcher = fs.watch(dirPath, { recursive: true }, (eventType, filename) => {
        if (filename) cb(eventType, filename)
      })
      return () => watcher.close()
    } catch {
      return () => {}
    }
  },

  copyToClipboard(text) {
    clipboard.writeText(text)
  },

  revealInFileManager(filePath) {
    shell.showItemInFolder(filePath)
  },

  async search(opts) {
    return searchFiles(opts)
  },

  async readMediaFile(filePath) {
    return readMediaFileSync(filePath)
  },

  async move(sourcePath, destDir) {
    return moveFileOrFolder(sourcePath, destDir)
  },

  async copy(sourcePath, destDir) {
    return copyFileOrFolder(sourcePath, destDir)
  },

  buildRemoteFileUrl(cwd, filePath, remoteName?) {
    return buildRemoteFileUrl(cwd, filePath, remoteName)
  },

  getGitRemotes(cwd) {
    return getGitRemotes(cwd)
  },

  async exists(filePath) {
    return fs.existsSync(filePath)
  },

  async readDirShallow(dirPath) {
    return readDirShallowAsync(dirPath)
  },
}
