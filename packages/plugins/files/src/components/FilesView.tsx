/**
 * FilesView — main file explorer orchestrator.
 *
 * Coordinates the tree panel, editor panel, and search panel.
 * All I/O goes through the FilesAdapter (set via DI at app startup).
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type * as monacoNs from 'monaco-editor'
import type { FileNode, OpenTab, EditorSettings, FilesSessionStore } from '../types.js'
import { IGNORED } from '../constants.js'
import { getMediaType } from '../utils.js'
import { getFilesAdapter } from '../adapter/index.js'
import { updateFolderChildren } from '../tree/buildTree.js'
import { FileTreePanel, FilesContextMenu } from './FileTreePanel.js'
import { EditorPanel } from './EditorPanel.js'
import { SearchPanel } from './SearchPanel.js'
import { FolderLargeIcon, SearchLargeIcon } from '../icons.js'
import * as path from '../path.js'

// ── Main Component ───────────────────────────────────────────────

export interface FilesViewProps {
  projectCwd: string
  editorSettings?: EditorSettings
  sessionStore?: FilesSessionStore
}

export function FilesView({ projectCwd, editorSettings, sessionStore }: FilesViewProps) {
  const adapter = getFilesAdapter()

  const [treeData, setTreeData] = useState<FileNode[]>([])
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([])
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null)
  const [treeWidth, setTreeWidth] = useState(240)
  const [treeHeight, setTreeHeight] = useState(400)
  const [gitStatus, setGitStatus] = useState<Map<string, string>>(new Map())
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; targetPath: string; isFolder: boolean } | null>(null)
  const [inlineInput, setInlineInput] = useState<{ parentPath: string; isFolder: boolean; indent: number } | null>(null)
  const [clipboard, setClipboard] = useState<{ paths: string[]; mode: 'copy' | 'cut' } | null>(null)
  const [selectedNodePath, setSelectedNodePath] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ path: string; name: string } | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [sidebarMode, setSidebarMode] = useState<'explorer' | 'search'>('explorer')
  const [pendingReveal, setPendingReveal] = useState<{ line: number; column: number } | null>(null)
  const resizingRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const prevCwdRef = useRef(projectCwd)
  const restoredRef = useRef(false)
  // Live ref to the Monaco editor — used by saveFile to read the freshest text
  // directly from the model, bypassing the React-state commit lag that caused
  // Cmd+S to write a stale value (the addCommand fires inside Monaco's keydown
  // before pending setOpenTabs from onChange has been flushed).
  const editorInstanceRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(null)

  // ── Session restore ──
  useEffect(() => {
    if (restoredRef.current || !sessionStore) return
    restoredRef.current = true
    const saved = sessionStore.load(projectCwd)
    if (saved?.openPaths?.length) {
      const validTabs: OpenTab[] = []
      ;(async () => {
        for (const t of saved.openPaths) {
          try {
            const mediaType = getMediaType(t.name)
            if (mediaType) {
              if (adapter.readMediaFile) {
                const media = await adapter.readMediaFile(t.path)
                if (media) validTabs.push({ path: t.path, name: t.name, content: media.dataUrl, modified: false, mediaType })
              }
            } else {
              const result = await adapter.readFile(t.path)
              if (result) validTabs.push({ path: t.path, name: t.name, content: result.content, modified: false })
            }
          } catch { /* skip unreadable files */ }
        }
        if (validTabs.length) {
          setOpenTabs(validTabs)
          const activeExists = saved.activeTabPath && validTabs.some(t => t.path === saved.activeTabPath)
          setActiveTabPath(activeExists ? saved.activeTabPath : validTabs[0].path)
        }
      })()
    }
  }, [])

  // ── Session persist ──
  useEffect(() => {
    if (!restoredRef.current || !sessionStore) return
    sessionStore.save(projectCwd, {
      openPaths: openTabs.map(t => ({ path: t.path, name: t.name })),
      activeTabPath,
    })
  }, [openTabs, activeTabPath, projectCwd, sessionStore])

  // ── Load tree and git status ──
  const refreshTree = useCallback(() => {
    adapter.buildTree(projectCwd).then(setTreeData)
    adapter.gitStatus(projectCwd).then(setGitStatus)
  }, [projectCwd, adapter])

  useEffect(() => {
    let cancelled = false

    adapter.buildTree(projectCwd).then(tree => {
      if (!cancelled) setTreeData(tree)
    })
    adapter.gitStatus(projectCwd).then(setGitStatus)

    if (prevCwdRef.current !== projectCwd) {
      setOpenTabs([])
      setActiveTabPath(null)
      prevCwdRef.current = projectCwd
    }

    // File watching
    let unwatchRoot: (() => void) | undefined
    if (adapter.watch) {
      let debounceTimer: ReturnType<typeof setTimeout> | null = null
      unwatchRoot = adapter.watch(projectCwd, (_eventType, filename) => {
        if (!filename) return
        const parts = filename.split('/')
        if (parts.some(p => IGNORED.has(p))) return
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          adapter.buildTree(projectCwd).then(newTree => {
            if (!cancelled) setTreeData(newTree)
          })
          adapter.gitStatus(projectCwd).then(setGitStatus)
        }, 500)
      })
    }

    return () => {
      cancelled = true
      unwatchRoot?.()
    }
  }, [projectCwd, adapter])

  // ── Per-folder watchers ──
  const expandedFoldersRef = useRef<Set<string>>(new Set())
  const folderWatchCleanups = useRef<Map<string, () => void>>(new Map())

  const handleFolderToggle = useCallback((folderPath: string, isOpen: boolean) => {
    const expanded = expandedFoldersRef.current
    const cleanups = folderWatchCleanups.current

    if (isOpen) {
      expanded.add(folderPath)
      // Eagerly load folder contents on expand
      if (adapter.readDirShallow) {
        adapter.readDirShallow(folderPath).then(freshEntries => {
          setTreeData(prev => updateFolderChildren(prev, folderPath, freshEntries))
        })
      }
      if (!cleanups.has(folderPath) && adapter.watch) {
        let timer: ReturnType<typeof setTimeout> | null = null
        const unwatch = adapter.watch(folderPath, (_eventType, filename) => {
          if (!filename) return
          if (IGNORED.has(filename) || filename === '.DS_Store') return
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => {
            if (adapter.readDirShallow) {
              adapter.readDirShallow(folderPath).then(freshEntries => {
                setTreeData(prev => updateFolderChildren(prev, folderPath, freshEntries))
              })
            }
            adapter.gitStatus(projectCwd).then(setGitStatus)
          }, 2000)
        })
        cleanups.set(folderPath, unwatch)
      }
    } else {
      expanded.delete(folderPath)
      const cleanup = cleanups.get(folderPath)
      if (cleanup) {
        cleanup()
        cleanups.delete(folderPath)
      }
    }
  }, [projectCwd, adapter])

  useEffect(() => {
    return () => {
      for (const cleanup of folderWatchCleanups.current.values()) cleanup()
      folderWatchCleanups.current.clear()
      expandedFoldersRef.current.clear()
    }
  }, [projectCwd])

  // ── Open file ──
  const openTabsRef = useRef(openTabs)
  openTabsRef.current = openTabs

  const openFile = useCallback(async (filePath: string) => {
    // Already open — just activate (use ref to avoid stale closure)
    if (openTabsRef.current.find(t => t.path === filePath)) {
      setActiveTabPath(filePath)
      return
    }

    const name = path.basename(filePath)
    const mediaType = getMediaType(name)

    if (mediaType) {
      if (adapter.readMediaFile) {
        const media = await adapter.readMediaFile(filePath)
        if (!media) return
        setActiveTabPath(filePath)
        setOpenTabs(prev => {
          if (prev.some(t => t.path === filePath)) return prev
          return [...prev, { path: filePath, name: media.name, content: media.dataUrl, modified: false, mediaType }]
        })
      }
      return
    }

    try {
      const result = await adapter.readFile(filePath)
      if (!result) return
      setActiveTabPath(filePath)
      setOpenTabs(prev => {
        if (prev.some(t => t.path === filePath)) return prev
        return [...prev, { path: filePath, name, content: result.content, modified: false }]
      })
    } catch { /* ignore */ }
  }, [adapter])

  const openFileAtLine = useCallback((filePath: string, line?: number, column?: number) => {
    openFile(filePath)
    if (line) {
      setPendingReveal({ line, column: column ?? 1 })
    }
  }, [openFile])

  // ── Listen for pixelcity:open-file (dispatched by quick menu file selection) ──
  useEffect(() => {
    const handler = (e: Event) => {
      const { filePath } = (e as CustomEvent).detail ?? {}
      if (filePath) openFile(filePath)
    }
    window.addEventListener('pixelcity:open-file', handler)
    return () => window.removeEventListener('pixelcity:open-file', handler)
  }, [openFile])

  // ── Tab operations ──
  const closeTab = useCallback((filePath: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setOpenTabs(prev => {
      const next = prev.filter(t => t.path !== filePath)
      if (activeTabPath === filePath) {
        const idx = prev.findIndex(t => t.path === filePath)
        const newActive = next[Math.min(idx, next.length - 1)]?.path ?? null
        setActiveTabPath(newActive)
      }
      return next
    })
  }, [activeTabPath])

  const closeOtherTabs = useCallback((filePath: string) => {
    setOpenTabs(prev => prev.filter(t => t.path === filePath))
    setActiveTabPath(filePath)
  }, [])

  const closeTabsToRight = useCallback((filePath: string) => {
    setOpenTabs(prev => {
      const idx = prev.findIndex(t => t.path === filePath)
      const next = prev.slice(0, idx + 1)
      if (activeTabPath && !next.some(t => t.path === activeTabPath)) {
        setActiveTabPath(filePath)
      }
      return next
    })
  }, [activeTabPath])

  const closeSavedTabs = useCallback(() => {
    setOpenTabs(prev => {
      const next = prev.filter(t => t.modified)
      if (activeTabPath && !next.some(t => t.path === activeTabPath)) {
        setActiveTabPath(next[0]?.path ?? null)
      }
      return next
    })
  }, [activeTabPath])

  const closeAllTabs = useCallback(() => {
    setOpenTabs([])
    setActiveTabPath(null)
  }, [])

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (!activeTabPath || value === undefined) return
    setOpenTabs(prev => prev.map(t =>
      t.path === activeTabPath ? { ...t, content: value, modified: true } : t
    ))
  }, [activeTabPath])

  const saveFile = useCallback(async () => {
    if (!activeTabPath) return
    const tab = openTabsRef.current.find(t => t.path === activeTabPath)
    if (!tab) return
    // Prefer the live editor value over React state. Monaco's Cmd+S command
    // fires synchronously inside the keydown event, which runs before any
    // pending setOpenTabs from onChange has been committed — so tab.content
    // can be one keystroke behind. Reading from the model is always current.
    const editor = editorInstanceRef.current
    const liveModel = editor?.getModel()
    const content = liveModel ? editor!.getValue() : tab.content
    try {
      await adapter.writeFile(activeTabPath, content)
      setOpenTabs(prev => prev.map(t =>
        t.path === activeTabPath ? { ...t, content, modified: false } : t
      ))
      adapter.gitStatus(projectCwd).then(setGitStatus)
    } catch { /* ignore */ }
  }, [activeTabPath, projectCwd, adapter])

  // ── Copy / Cut / Paste ──
  const handleCopy = useCallback((paths: string[]) => {
    setClipboard({ paths, mode: 'copy' })
  }, [])

  const handleCut = useCallback((paths: string[]) => {
    setClipboard({ paths, mode: 'cut' })
  }, [])

  const handlePaste = useCallback(async (destDir: string) => {
    if (!clipboard) return
    for (const sourcePath of clipboard.paths) {
      if (clipboard.mode === 'copy') {
        await adapter.copy?.(sourcePath, destDir)
      } else {
        const newPath = await adapter.move?.(sourcePath, destDir)
        if (newPath) {
          setOpenTabs(prev => prev.map(t => {
            if (t.path === sourcePath) return { ...t, path: newPath, name: path.basename(newPath) }
            if (t.path.startsWith(sourcePath + '/')) {
              const relative = t.path.slice(sourcePath.length)
              return { ...t, path: newPath + relative }
            }
            return t
          }))
          if (activeTabPath === sourcePath) setActiveTabPath(newPath)
          else if (activeTabPath?.startsWith(sourcePath + '/')) {
            setActiveTabPath(newPath + activeTabPath.slice(sourcePath.length))
          }
        }
      }
    }
    if (clipboard.mode === 'cut') setClipboard(null)
    refreshTree()
  }, [clipboard, refreshTree, activeTabPath, adapter])

  // ── Create / Delete / Rename ──
  const handleCreate = useCallback(async (fullPath: string, isFolder: boolean) => {
    setInlineInput(null)
    if (!fullPath) return
    try {
      await adapter.create(fullPath, isFolder)
      if (!isFolder) openFile(fullPath)
      refreshTree()
    } catch { /* ignore */ }
  }, [refreshTree, openFile, adapter])

  const handleDeleteRequest = useCallback((targetPath: string) => {
    setDeleteConfirm({ path: targetPath, name: path.basename(targetPath) })
  }, [])

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteConfirm) return
    try {
      await adapter.delete(deleteConfirm.path)
      closeTab(deleteConfirm.path)
      refreshTree()
    } catch { /* ignore */ }
    setDeleteConfirm(null)
  }, [deleteConfirm, refreshTree, closeTab, adapter])

  // ── Move (drag and drop) ──
  const handleMove = useCallback(async (args: { dragIds: string[]; parentId: string | null; index: number }) => {
    const { dragIds, parentId } = args
    const destDir = parentId || projectCwd
    for (const sourcePath of dragIds) {
      const newPath = await adapter.move?.(sourcePath, destDir)
      if (newPath) {
        setOpenTabs(prev => prev.map(t => {
          if (t.path === sourcePath) return { ...t, path: newPath, name: path.basename(newPath) }
          if (t.path.startsWith(sourcePath + '/')) {
            const relative = t.path.slice(sourcePath.length)
            return { ...t, path: newPath + relative }
          }
          return t
        }))
        if (activeTabPath === sourcePath) setActiveTabPath(newPath)
        else if (activeTabPath?.startsWith(sourcePath + '/')) {
          setActiveTabPath(newPath + activeTabPath.slice(sourcePath.length))
        }
      }
    }
    refreshTree()
  }, [projectCwd, refreshTree, activeTabPath, adapter])

  // ── Rename ──
  const handleRename = useCallback(async (oldPath: string, newName: string) => {
    const dir = path.dirname(oldPath)
    const newPath = path.join(dir, newName)
    try {
      await adapter.rename(oldPath, newPath)
      setOpenTabs(prev => prev.map(t =>
        t.path === oldPath ? { ...t, path: newPath, name: path.basename(newPath) } : t
      ))
      if (activeTabPath === oldPath) setActiveTabPath(newPath)
      refreshTree()
    } catch { /* ignore */ }
  }, [refreshTree, activeTabPath, adapter])

  // ── Context menus ──
  const handleNodeContextMenu = useCallback((e: React.MouseEvent, node: any) => {
    const data = node.data as FileNode
    setSelectedNodePath(data.id)
    setContextMenu({ x: e.clientX, y: e.clientY, targetPath: data.id, isFolder: data.isFolder })
  }, [])

  const handleSidebarContextMenu = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('.files-tree-node')) return
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, targetPath: projectCwd, isFolder: true })
  }, [projectCwd])

  const contextMenuItems = useMemo(() => {
    if (!contextMenu) return []
    const { targetPath, isFolder } = contextMenu
    const parentDir = isFolder ? targetPath : path.dirname(targetPath)
    const depth = parentDir.split('/').length - projectCwd.split('/').length
    const indent = (depth + 1) * 16

    const items: { label: string; icon?: string; separator?: boolean; disabled?: boolean; onClick: () => void }[] = []

    items.push({ label: 'New File', onClick: () => setInlineInput({ parentPath: parentDir, isFolder: false, indent }) })
    items.push({ label: 'New Folder', onClick: () => setInlineInput({ parentPath: parentDir, isFolder: true, indent }) })
    items.push({ label: '', separator: true, onClick: () => {} })

    if (targetPath !== projectCwd) {
      items.push({ label: 'Copy', onClick: () => handleCopy([targetPath]) })
      items.push({ label: 'Cut', onClick: () => handleCut([targetPath]) })
    }

    if (clipboard && clipboard.paths.length > 0) {
      items.push({ label: 'Paste', onClick: () => handlePaste(parentDir) })
    }

    if (targetPath !== projectCwd) {
      items.push({ label: '', separator: true, onClick: () => {} })
      items.push({ label: 'Rename', onClick: () => setRenamingPath(targetPath) })
      items.push({ label: 'Delete', onClick: () => handleDeleteRequest(targetPath) })
    }

    items.push({ label: '', separator: true, onClick: () => {} })
    items.push({
      label: 'Copy Path',
      onClick: () => adapter.copyToClipboard?.(targetPath) ?? navigator.clipboard.writeText(targetPath),
    })
    items.push({
      label: 'Copy Relative Path',
      onClick: () => {
        const rel = path.relative(projectCwd, targetPath)
        adapter.copyToClipboard?.(rel) ?? navigator.clipboard.writeText(rel)
      },
    })

    if (adapter.revealInFileManager) {
      items.push({ label: '', separator: true, onClick: () => {} })
      items.push({ label: 'Reveal in File Manager', onClick: () => adapter.revealInFileManager!(targetPath) })
    }

    return items
  }, [contextMenu, projectCwd, handleDeleteRequest, clipboard, handleCopy, handleCut, handlePaste, adapter])

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const inSidebar = !!(document.activeElement?.closest('.files-sidebar'))

      if (e.key === 's') { e.preventDefault(); saveFile() }
      if (e.key === 'f' && e.shiftKey) {
        e.preventDefault()
        setSidebarMode(prev => prev === 'search' ? 'explorer' : 'search')
      }
      if (inSidebar && e.key === 'c' && selectedNodePath) { e.preventDefault(); handleCopy([selectedNodePath]) }
      if (inSidebar && e.key === 'x' && selectedNodePath) { e.preventDefault(); handleCut([selectedNodePath]) }
      if (inSidebar && e.key === 'v' && clipboard) {
        e.preventDefault()
        handlePaste(selectedNodePath && selectedNodePath !== projectCwd ? path.dirname(selectedNodePath) : projectCwd)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [saveFile, selectedNodePath, clipboard, handleCopy, handleCut, handlePaste, projectCwd])

  // ── Resize handler ──
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizingRef.current = true
    const startX = e.clientX
    const startWidth = treeWidth
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return
      setTreeWidth(Math.max(140, Math.min(500, startWidth + ev.clientX - startX)))
    }
    const onUp = () => {
      resizingRef.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [treeWidth])

  return (
    <div data-testid="files-view" className="flex flex-1 min-h-0 overflow-hidden bg-bg" ref={containerRef}>
      {/* Activity Bar */}
      <div className="flex flex-col items-center w-[36px] bg-bg-card border-r border-border shrink-0 pt-1 gap-[2px]">
        <button
          data-testid="files-activity-explorer"
          className={`flex items-center justify-center w-[30px] h-[30px] rounded-[4px] cursor-pointer border-none transition-all duration-100
            ${sidebarMode === 'explorer' ? 'bg-accent/15 text-text-bright' : 'bg-transparent text-text-dim hover:text-text hover:bg-bg-hover'}`}
          onClick={() => setSidebarMode('explorer')}
          title="Explorer"
        >
          <FolderLargeIcon />
        </button>
        <button
          data-testid="files-activity-search"
          className={`flex items-center justify-center w-[30px] h-[30px] rounded-[4px] cursor-pointer border-none transition-all duration-100
            ${sidebarMode === 'search' ? 'bg-accent/15 text-text-bright' : 'bg-transparent text-text-dim hover:text-text hover:bg-bg-hover'}`}
          onClick={() => setSidebarMode('search')}
          title="Search (⇧⌘F)"
        >
          <SearchLargeIcon />
        </button>
      </div>

      {/* Sidebar */}
      {sidebarMode === 'explorer' ? (
        <FileTreePanel
          treeData={treeData}
          treeWidth={treeWidth}
          treeHeight={treeHeight}
          gitStatus={gitStatus}
          inlineInput={inlineInput}
          onRefresh={refreshTree}
          onSelectFile={(filePath: string) => { setSelectedNodePath(filePath); openFile(filePath) }}
          onNodeContextMenu={handleNodeContextMenu}
          onSidebarContextMenu={handleSidebarContextMenu}
          onInlineCreate={handleCreate}
          onInlineCancel={() => setInlineInput(null)}
          onMove={adapter.move ? handleMove : undefined}
          projectCwd={projectCwd}
          renamingPath={renamingPath}
          onRename={(oldPath, newName) => { handleRename(oldPath, newName); setRenamingPath(null) }}
          onRenameCancel={() => setRenamingPath(null)}
          selectedNodePath={selectedNodePath}
          onOpenFile={(f) => openFile(f)}
          onNodeSelect={(p) => setSelectedNodePath(p)}
          onFolderToggle={handleFolderToggle}
        />
      ) : (
        <SearchPanel
          projectCwd={projectCwd}
          width={treeWidth}
          onOpenFile={openFileAtLine}
          onRefreshTree={refreshTree}
        />
      )}

      {/* Resize handle */}
      <div
        className="w-[3px] cursor-col-resize bg-transparent shrink-0 transition-colors duration-150 hover:bg-accent active:bg-accent"
        onMouseDown={startResize}
      />

      {/* Editor area */}
      <EditorPanel
        openTabs={openTabs}
        activeTabPath={activeTabPath}
        onTabSelect={setActiveTabPath}
        onTabClose={closeTab}
        onCloseOthers={closeOtherTabs}
        onCloseToRight={closeTabsToRight}
        onCloseSaved={closeSavedTabs}
        onCloseAll={closeAllTabs}
        onEditorChange={handleEditorChange}
        onSave={saveFile}
        onOpenFile={(f) => openFile(f)}
        onOpenFileAtLine={openFileAtLine}
        editorSettings={editorSettings}
        projectCwd={projectCwd}
        pendingReveal={pendingReveal}
        onRevealComplete={() => setPendingReveal(null)}
        editorInstanceRef={editorInstanceRef}
      />

      {/* Context menu */}
      {contextMenu && (
        <FilesContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Delete confirmation dialog */}
      {deleteConfirm && (
        <div
          data-testid="files-delete-dialog"
          className="fixed inset-0 z-[10000] bg-black/45 flex items-center justify-center"
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            className="bg-bg-popup border border-border rounded-lg px-5 py-4 min-w-[260px] shadow-[0_8px_32px_rgba(0,0,0,0.6)] font-ui text-[13px] text-text"
            onClick={e => e.stopPropagation()}
          >
            <p className="mb-[14px]">Delete <strong>{deleteConfirm.name}</strong>?</p>
            <div className="flex justify-end gap-2">
              <button
                data-testid="files-delete-cancel"
                className="px-[14px] py-[5px] rounded border border-border text-[12px] font-ui cursor-pointer bg-transparent text-text transition-colors duration-100 hover:bg-white/[0.06]"
                onClick={() => setDeleteConfirm(null)}
              >Cancel</button>
              <button
                data-testid="files-delete-confirm"
                className="px-[14px] py-[5px] rounded border border-[#c53030] text-[12px] font-ui cursor-pointer bg-[#c53030] text-white transition-colors duration-100 hover:bg-[#e53e3e]"
                onClick={handleDeleteConfirm}
              >Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
