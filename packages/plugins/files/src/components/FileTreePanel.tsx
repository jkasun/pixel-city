import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Tree, NodeRendererProps } from 'react-arborist'
import type { FileNode } from '../types.js'
import { GIT_STATUS_COLORS } from '../constants.js'
import { getFolderColor, getFileIconData, getGitStatusForPath } from '../utils.js'
import { setDraggedFilePath } from './dragState.js'
import { RefreshAltIcon } from '../icons.js'
import * as path from '../path.js'

// ── Material-style file icons (SVG) ─────────────────────────────

export function FileIcon({ name, isFolder, isOpen }: { name: string; isFolder: boolean; isOpen?: boolean }) {
  const s = 16
  if (isFolder) {
    const color = getFolderColor(name)
    if (isOpen) {
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <path d="M20 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4l2 2h10a2 2 0 0 1 2 2v1" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path d="M4 19l2.5-7H21l-2.5 7H4z" fill={color} opacity="0.25" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      )
    }
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" fill={color} opacity="0.2" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }

  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const lowerName = name.toLowerCase()
  const { color, letter } = getFileIconData(ext, lowerName)

  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill={color} opacity="0.15" stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="14 2 14 8 20 8" stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      {letter && <text x="12" y="17.5" textAnchor="middle" fill={color} fontSize="8" fontWeight="700" fontFamily="sans-serif">{letter}</text>}
    </svg>
  )
}

// ── Context menu ─────────────────────────────────────────────────

export interface FilesContextMenuProps {
  x: number
  y: number
  items: { label: string; icon?: string; shortcut?: string; separator?: boolean; disabled?: boolean; onClick: () => void }[]
  onClose: () => void
}

export function FilesContextMenu({ x, y, items, onClose }: FilesContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    const escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', escHandler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', escHandler)
    }
  }, [onClose])

  const [pos, setPos] = useState({ x, y })
  useEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    const nx = rect.right > window.innerWidth ? x - rect.width : x
    const ny = rect.bottom > window.innerHeight ? y - rect.height : y
    setPos({ x: Math.max(0, nx), y: Math.max(0, ny) })
  }, [x, y])

  return (
    <div
      className="fixed z-[9999] min-w-[160px] bg-bg-popup border border-border rounded-[6px] py-1 shadow-[0_4px_16px_rgba(0,0,0,0.5)] font-ui text-[11px] select-none"
      ref={menuRef}
      style={{ left: pos.x, top: pos.y }}
    >
      {items.map((item, i) => item.separator ? (
        <div key={i} className="h-px bg-border mx-2 my-1" />
      ) : (
        <div
          key={i}
          className={`flex items-center gap-2 px-3 py-[5px] transition-colors duration-[80ms]${item.disabled ? ' text-text-dim/40 cursor-default' : ' text-text cursor-pointer hover:bg-accent/15'}`}
          onClick={() => { if (!item.disabled) { item.onClick(); onClose() } }}
        >
          {item.icon && <span className="w-4 text-center text-[12px] shrink-0">{item.icon}</span>}
          <span className="flex-1">{item.label}</span>
          {item.shortcut && <span className="text-text-dim/50 text-[10px] ml-4 shrink-0">{item.shortcut}</span>}
        </div>
      ))}
    </div>
  )
}

// ── Inline name input (for new file/folder) ─────────────────────

interface InlineInputProps {
  parentPath: string
  isFolder: boolean
  onConfirm: (fullPath: string, isFolder: boolean) => void
  onCancel: () => void
  indent: number
}

function InlineNameInput({ parentPath, isFolder, onConfirm, onCancel, indent }: InlineInputProps) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const submit = () => {
    const name = value.trim()
    if (!name) { onCancel(); return }
    const fullPath = path.join(parentPath, name)
    onConfirm(fullPath, isFolder)
  }

  return (
    <div
      className="flex items-center h-[26px] gap-1 mx-1 rounded-[3px] bg-bg-hover"
      style={{ paddingLeft: indent }}
    >
      <span className="shrink-0 w-[18px] h-4 flex items-center justify-center">
        <FileIcon name={isFolder ? 'folder' : (value || 'file')} isFolder={isFolder} />
      </span>
      <input
        ref={inputRef}
        className="flex-1 min-w-0 px-[6px] py-[2px] bg-bg border border-accent rounded-[3px] text-text font-ui text-[12px] outline-none placeholder:text-text-dim placeholder:text-[11px]"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') onCancel()
        }}
        onBlur={submit}
        placeholder={isFolder ? 'Folder name...' : 'File name...'}
        spellCheck={false}
      />
    </div>
  )
}

// ── File Tree Node ───────────────────────────────────────────────

function FileTreeNode({ node, style, dragHandle }: NodeRendererProps<FileNode>) {
  const indent = { paddingLeft: node.level * 16 }
  const gitStatus = (node.tree.props as any).gitStatus as Map<string, string> | undefined
  const onContextMenu = (node.tree.props as any).onNodeContextMenu as ((e: React.MouseEvent, node: any) => void) | undefined
  const renamingPath = (node.tree.props as any).renamingPath as string | null | undefined
  const onRename = (node.tree.props as any).onRename as ((oldPath: string, newName: string) => void) | undefined
  const onRenameCancel = (node.tree.props as any).onRenameCancel as (() => void) | undefined
  const onFolderSelect = (node.tree.props as any).onFolderSelect as ((folderPath: string) => void) | undefined
  const status = gitStatus ? getGitStatusForPath(node.data.id, node.data.isFolder, gitStatus) : null
  const nameColor = status ? GIT_STATUS_COLORS[status] : undefined
  const isRenaming = renamingPath === node.data.id

  const [renameValue, setRenameValue] = useState(node.data.name)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isRenaming) {
      setRenameValue(node.data.name)
      setTimeout(() => {
        const input = renameInputRef.current
        if (input) {
          input.focus()
          const dotIndex = node.data.name.lastIndexOf('.')
          if (!node.data.isFolder && dotIndex > 0) {
            input.setSelectionRange(0, dotIndex)
          } else {
            input.select()
          }
        }
      }, 0)
    }
  }, [isRenaming])

  const submitRename = useCallback(() => {
    const newName = renameValue.trim()
    if (!newName || newName === node.data.name) {
      onRenameCancel?.()
    } else {
      onRename?.(node.data.id, newName)
    }
  }, [renameValue, node.data.name, node.data.id, onRename, onRenameCancel])

  return (
    <div
      data-testid={`files-tree-item-${node.data.name}`}
      className={`files-tree-node flex items-center gap-1 px-2 h-[26px] cursor-pointer text-[12px] font-ui text-text select-none rounded-[3px] mx-1 transition-colors duration-[80ms] hover:bg-bg-hover${node.isSelected ? ' bg-accent/15 text-text-bright' : ''}`}
      style={{ ...style, ...indent }}
      ref={dragHandle}
      onDragStart={() => setDraggedFilePath(node.data.id)}
      onDragEnd={() => setDraggedFilePath(null)}
      onClick={() => {
        if (isRenaming) return
        if (node.data.isFolder) {
          const willOpen = !node.isOpen
          node.toggle()
          onFolderSelect?.(node.data.id)
          const onFolderToggle = (node.tree.props as any).onFolderToggle as ((path: string, isOpen: boolean) => void) | undefined
          onFolderToggle?.(node.data.id, willOpen)
        } else {
          node.select()
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContextMenu?.(e, node)
      }}
    >
      {node.data.isFolder && (
        <span className="w-3 text-[10px] text-text-dim shrink-0 text-center">{node.isOpen ? '▾' : '▸'}</span>
      )}
      {!node.data.isFolder && <span className="w-3 shrink-0" />}
      <span className="shrink-0 w-[18px] h-4 flex items-center justify-center">
        <FileIcon name={isRenaming ? renameValue : node.data.name} isFolder={node.data.isFolder} isOpen={node.isOpen} />
      </span>
      {isRenaming ? (
        <input
          ref={renameInputRef}
          className="flex-1 min-w-0 px-[6px] py-[2px] bg-bg border border-accent rounded-[3px] text-text font-ui text-[12px] outline-none placeholder:text-text-dim placeholder:text-[11px]"
          value={renameValue}
          onChange={e => setRenameValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') submitRename()
            if (e.key === 'Escape') onRenameCancel?.()
            e.stopPropagation()
          }}
          onBlur={submitRename}
          onClick={e => e.stopPropagation()}
          spellCheck={false}
        />
      ) : (
        <span
          className="whitespace-nowrap overflow-hidden text-ellipsis flex items-center gap-[6px]"
          style={nameColor ? { color: nameColor } : undefined}
        >
          {node.data.name}
          {status && !node.data.isFolder && (
            <span className="text-[0.6rem] font-semibold opacity-70 shrink-0">{status[0].toUpperCase()}</span>
          )}
        </span>
      )}
    </div>
  )
}

// ── FileTreePanel component ─────────────────────────────────────

export interface FileTreePanelProps {
  treeData: FileNode[]
  treeWidth: number
  treeHeight: number
  gitStatus: Map<string, string>
  inlineInput: { parentPath: string; isFolder: boolean; indent: number } | null
  onRefresh: () => void
  onSelectFile: (filePath: string) => void
  onNodeContextMenu: (e: React.MouseEvent, node: any) => void
  onSidebarContextMenu: (e: React.MouseEvent) => void
  onInlineCreate: (fullPath: string, isFolder: boolean) => void
  onInlineCancel: () => void
  onMove?: (args: { dragIds: string[]; parentId: string | null; index: number }) => void
  onNativeDrop?: (e: React.DragEvent, destDir: string) => void
  projectCwd?: string
  renamingPath?: string | null
  onRename?: (oldPath: string, newName: string) => void
  onRenameCancel?: () => void
  selectedNodePath?: string | null
  onOpenFile?: (filePath: string) => void
  onNodeSelect?: (path: string) => void
  onFolderToggle?: (folderPath: string, isOpen: boolean) => void
}

export function FileTreePanel({
  treeData,
  treeWidth,
  treeHeight,
  gitStatus,
  inlineInput,
  onRefresh,
  onSelectFile,
  onNodeContextMenu,
  onSidebarContextMenu,
  onInlineCreate,
  onInlineCancel,
  onMove,
  onNativeDrop,
  projectCwd,
  renamingPath,
  onRename,
  onRenameCancel,
  selectedNodePath,
  onOpenFile,
  onNodeSelect,
  onFolderToggle,
}: FileTreePanelProps) {
  const treeContainerRef = useRef<HTMLDivElement>(null)
  const [measuredHeight, setMeasuredHeight] = useState(treeHeight)

  useEffect(() => {
    const el = treeContainerRef.current
    if (!el) return
    const obs = new ResizeObserver(entries => {
      for (const entry of entries) {
        setMeasuredHeight(entry.contentRect.height)
      }
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  return (
    <div data-testid="files-tree" className="files-sidebar flex flex-col min-w-[140px] max-w-[500px] bg-bg-card border-r border-border overflow-hidden" style={{ width: treeWidth }}>
      <div className="flex items-center justify-between px-3 h-[30px] shrink-0 border-b border-border">
        <span className="text-[10px] font-semibold tracking-[0.1em] text-text-dim font-ui">EXPLORER</span>
        <button
          data-testid="files-tree-refresh"
          className="bg-none border-none cursor-pointer text-text-dim p-[2px] flex items-center rounded-[3px] transition-[color,background] duration-[120ms] hover:text-text hover:bg-bg-hover"
          onClick={onRefresh}
          title="Refresh"
        >
          <RefreshAltIcon />
        </button>
      </div>

      <div
        className="flex-1 overflow-auto py-1"
        ref={treeContainerRef}
        onContextMenu={onSidebarContextMenu}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }
        }}
        onDrop={(e) => {
          if (e.dataTransfer.types.includes('Files') && onNativeDrop && projectCwd) {
            onNativeDrop(e, projectCwd)
          }
        }}
      >
        {inlineInput && (
          <InlineNameInput
            parentPath={inlineInput.parentPath}
            isFolder={inlineInput.isFolder}
            indent={inlineInput.indent}
            onConfirm={onInlineCreate}
            onCancel={onInlineCancel}
          />
        )}
        <Tree<FileNode>
          data={treeData}
          openByDefault={false}
          width={treeWidth}
          height={inlineInput ? measuredHeight - 26 : measuredHeight}
          rowHeight={26}
          indent={16}
          disableDrag={!onMove}
          disableDrop={onMove ? (args: any) => {
            return args.parentNode && !args.parentNode.data.isFolder
          } : true}
          onMove={onMove}
          {...{ gitStatus, onNodeContextMenu, renamingPath, onRename, onRenameCancel, onFolderSelect: onNodeSelect, onFolderToggle } as any}
          onSelect={(nodes) => {
            const node = nodes[0]
            if (node && !node.data.isFolder) {
              onSelectFile(node.data.id)
            }
          }}
        >
          {FileTreeNode}
        </Tree>
      </div>
    </div>
  )
}
