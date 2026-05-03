import type { FileNode } from '../types.js'
import * as path from '../path.js'

/**
 * Build a nested FileNode tree from a list of relative file paths.
 * This is a pure function — no I/O. Works on both platforms.
 */
export function buildTreeFromPaths(cwd: string, relativePaths: string[]): FileNode[] {
  interface DirEntry {
    files: Map<string, null>
    dirs: Map<string, DirEntry>
  }
  const root: DirEntry = { files: new Map(), dirs: new Map() }

  for (const relPath of relativePaths) {
    const parts = relPath.split('/')
    let current = root

    for (let i = 0; i < parts.length - 1; i++) {
      const dirName = parts[i]
      if (!current.dirs.has(dirName)) {
        current.dirs.set(dirName, { files: new Map(), dirs: new Map() })
      }
      current = current.dirs.get(dirName)!
    }
    const fileName = parts[parts.length - 1]
    if (fileName) current.files.set(fileName, null)
  }

  function toNodes(entry: DirEntry, parentPath: string): FileNode[] {
    const nodes: FileNode[] = []
    // Folders first (sorted)
    const sortedDirs = [...entry.dirs.keys()].sort((a, b) => a.localeCompare(b))
    for (const dirName of sortedDirs) {
      const fullPath = path.join(parentPath, dirName)
      nodes.push({
        id: fullPath,
        name: dirName,
        isFolder: true,
        children: toNodes(entry.dirs.get(dirName)!, fullPath),
      })
    }
    // Files second (sorted)
    const sortedFiles = [...entry.files.keys()].sort((a, b) => a.localeCompare(b))
    for (const fileName of sortedFiles) {
      nodes.push({
        id: path.join(parentPath, fileName),
        name: fileName,
        isFolder: false,
      })
    }
    return nodes
  }

  return toNodes(root, cwd)
}

/** Flatten a FileNode tree to a list of file paths. */
export function flattenTree(nodes: FileNode[]): string[] {
  const result: string[] = []
  const stack = [...nodes]
  while (stack.length > 0) {
    const node = stack.shift()!
    if (node.isFolder) {
      if (node.children) stack.push(...node.children)
    } else {
      result.push(node.id)
    }
  }
  return result
}

/** Immutably update a folder's children in the tree by path. */
export function updateFolderChildren(tree: FileNode[], folderPath: string, freshEntries: FileNode[]): FileNode[] {
  return tree.map(node => {
    if (node.id === folderPath && node.isFolder) {
      const existingByName = new Map<string, FileNode>()
      if (node.children) {
        for (const child of node.children) existingByName.set(child.name, child)
      }
      const merged = freshEntries.map(entry => {
        if (entry.isFolder) {
          const existing = existingByName.get(entry.name)
          if (existing?.isFolder && existing.children?.length) {
            return { ...entry, children: existing.children }
          }
        }
        return entry
      })
      return { ...node, children: merged }
    }
    if (node.isFolder && node.children && folderPath.startsWith(node.id + '/')) {
      return { ...node, children: updateFolderChildren(node.children, folderPath, freshEntries) }
    }
    return node
  })
}
