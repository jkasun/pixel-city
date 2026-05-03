import React, { useState, useEffect, useRef, useCallback } from 'react'
import type { ChangedFile } from '../types.js'
import { STATUS_COLORS, STATUS_LABELS } from '../types.js'
import { posixResolve } from '../utils.js'

interface GitFileListProps {
  files: ChangedFile[]
  selectedPath: string | null
  onSelect: (file: ChangedFile) => void
  onStage?: (files: ChangedFile[]) => void
  onUnstage?: (files: ChangedFile[]) => void
  onDiscard?: (files: ChangedFile[]) => void
  flat?: boolean
  repoRoot?: string
  onDragFile?: (absPath: string | null) => void
}

/** Unique key for a ChangedFile (path + staged flag to distinguish staged vs unstaged same file) */
function fileKey(f: ChangedFile): string {
  return `${f.staged ? 's' : 'u'}:${f.path}`
}

export function GitFileList({ files, selectedPath, onSelect, onStage, onUnstage, onDiscard, flat, repoRoot, onDragFile }: GitFileListProps) {
  const stagedFiles = files.filter(f => f.staged)
  const unstagedFiles = files.filter(f => !f.staged)
  // Flat ordered list for shift-click range selection
  const orderedFiles = [...stagedFiles, ...unstagedFiles]

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const lastClickedRef = useRef<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState<ChangedFile[] | null>(null)

  const requestDiscard = useCallback((filesToDiscard: ChangedFile[]) => {
    setConfirmDiscard(filesToDiscard)
  }, [])

  const executeDiscard = useCallback(() => {
    if (confirmDiscard && onDiscard) {
      onDiscard(confirmDiscard)
    }
    setConfirmDiscard(null)
  }, [confirmDiscard, onDiscard])

  // Clear selection when files change significantly
  useEffect(() => {
    setSelected(prev => {
      const validKeys = new Set(orderedFiles.map(fileKey))
      const filtered = new Set([...prev].filter(k => validKeys.has(k)))
      return filtered.size !== prev.size ? filtered : prev
    })
  }, [files])

  const handleClick = useCallback((file: ChangedFile, e: React.MouseEvent) => {
    const key = fileKey(file)
    const isMeta = e.metaKey || e.ctrlKey
    const isShift = e.shiftKey

    if (isShift && lastClickedRef.current) {
      // Range selection
      const lastIdx = orderedFiles.findIndex(f => fileKey(f) === lastClickedRef.current)
      const curIdx = orderedFiles.findIndex(f => fileKey(f) === key)
      if (lastIdx >= 0 && curIdx >= 0) {
        const start = Math.min(lastIdx, curIdx)
        const end = Math.max(lastIdx, curIdx)
        const rangeKeys = orderedFiles.slice(start, end + 1).map(fileKey)
        setSelected(prev => {
          const next = new Set(isMeta ? prev : [])
          rangeKeys.forEach(k => next.add(k))
          return next
        })
      }
    } else if (isMeta) {
      // Toggle individual
      setSelected(prev => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
      lastClickedRef.current = key
    } else {
      // Single click — select file for diff and set as only selected
      setSelected(new Set([key]))
      lastClickedRef.current = key
      onSelect(file)
    }
  }, [orderedFiles, onSelect])

  const getSelectedFiles = useCallback((): ChangedFile[] => {
    const keys = selected
    return orderedFiles.filter(f => keys.has(fileKey(f)))
  }, [selected, orderedFiles])

  // Context menu
  const handleContextMenu = useCallback((e: React.MouseEvent, file: ChangedFile) => {
    e.preventDefault()
    const key = fileKey(file)
    // If right-clicked file isn't in selection, make it the only selection
    if (!selected.has(key)) {
      setSelected(new Set([key]))
      lastClickedRef.current = key
    }
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [selected])

  // Determine what actions are available for current selection
  const selectedFiles = getSelectedFiles()
  const hasStaged = selectedFiles.some(f => f.staged)
  const hasUnstaged = selectedFiles.some(f => !f.staged)

  return (
    <div data-testid="git-file-list" className="py-1" onMouseDown={e => {
      // Click on empty area clears selection (but not on file rows or headers)
      if ((e.target as HTMLElement).classList.contains('git-file-list-root')) {
        setSelected(new Set())
      }
    }}>
      {flat ? (
        <>
          {/* Group header */}
          <div className="flex items-center gap-1.5 py-1.5 px-3 text-[11px] text-text-dim uppercase tracking-[0.5px] select-none">
            <span>Changed Files</span>
            <span className="text-[10px] text-text-dim opacity-50 bg-white/[0.06] px-[5px] py-px rounded-lg">{orderedFiles.length}</span>
          </div>
          {orderedFiles.map(f => (
            <FileRow
              key={fileKey(f)}
              file={f}
              isSelected={selected.has(fileKey(f))}
              isDiffActive={f.path === selectedPath}
              onClick={handleClick}
              onContextMenu={handleContextMenu}
              repoRoot={repoRoot}
              onDragFile={onDragFile}
            />
          ))}
          {files.length === 0 && <div className="py-2 px-1 text-[11px] text-text-dim italic">No changes</div>}
        </>
      ) : (
        <>
          {stagedFiles.length > 0 && (
            <>
              {/* Staged group header */}
              <div className="flex items-center gap-1.5 py-1.5 px-3 text-[11px] text-text-dim uppercase tracking-[0.5px] select-none group/header">
                <span>Staged Changes</span>
                <span className="text-[10px] text-text-dim opacity-50 bg-white/[0.06] px-[5px] py-px rounded-lg">{stagedFiles.length}</span>
                <div className="flex items-center gap-1 ml-auto invisible group-hover/header:visible">
                  {onUnstage && (
                    <button
                      className="bg-transparent border-none text-text-dim text-[13px] font-bold w-5 h-5 rounded-[3px] cursor-pointer leading-none p-0 flex items-center justify-center hover:bg-white/10"
                      title="Unstage All"
                      onClick={() => onUnstage(stagedFiles)}
                    >−</button>
                  )}
                </div>
              </div>
              {stagedFiles.map(f => (
                <FileRow
                  key={fileKey(f)}
                  file={f}
                  isSelected={selected.has(fileKey(f))}
                  isDiffActive={f.path === selectedPath}
                  onClick={handleClick}
                  onContextMenu={handleContextMenu}
                  onAction={onUnstage ? () => onUnstage([f]) : undefined}
                  actionTitle="Unstage"
                  actionIcon="&minus;"
                  repoRoot={repoRoot}
                  onDragFile={onDragFile}
                />
              ))}
            </>
          )}
          {unstagedFiles.length > 0 && (
            <>
              {/* Changes group header */}
              <div className="flex items-center gap-1.5 py-1.5 px-3 text-[11px] text-text-dim uppercase tracking-[0.5px] select-none group/header">
                <span>Changes</span>
                <span className="text-[10px] text-text-dim opacity-50 bg-white/[0.06] px-[5px] py-px rounded-lg">{unstagedFiles.length}</span>
                <div className="flex items-center gap-1 ml-auto invisible group-hover/header:visible">
                  {onDiscard && (
                    <button
                      className="bg-transparent border-none text-text-dim text-[13px] font-bold w-5 h-5 rounded-[3px] cursor-pointer leading-none p-0 flex items-center justify-center hover:bg-[rgba(199,78,57,0.15)]"
                      title="Discard All Changes"
                      onClick={() => requestDiscard(unstagedFiles)}
                    >↩</button>
                  )}
                  {onStage && (
                    <button
                      className="bg-transparent border-none text-text-dim text-[13px] font-bold w-5 h-5 rounded-[3px] cursor-pointer leading-none p-0 flex items-center justify-center hover:bg-white/10"
                      title="Stage All"
                      onClick={() => onStage(unstagedFiles)}
                    >+</button>
                  )}
                </div>
              </div>
              {unstagedFiles.map(f => (
                <FileRow
                  key={fileKey(f)}
                  file={f}
                  isSelected={selected.has(fileKey(f))}
                  isDiffActive={f.path === selectedPath}
                  onClick={handleClick}
                  onContextMenu={handleContextMenu}
                  onAction={onStage ? () => onStage([f]) : undefined}
                  actionTitle="Stage"
                  actionIcon="+"
                  repoRoot={repoRoot}
                  onDragFile={onDragFile}
                />
              ))}
            </>
          )}
          {files.length === 0 && <div className="py-2 px-1 text-[11px] text-text-dim italic">No changes</div>}
        </>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          selectedFiles={selectedFiles}
          hasStaged={hasStaged}
          hasUnstaged={hasUnstaged}
          onStage={onStage}
          onUnstage={onUnstage}
          onDiscard={onDiscard ? requestDiscard : undefined}
          onClose={() => setContextMenu(null)}
        />
      )}

      {confirmDiscard && (
        <ConfirmDialog
          title="Discard Changes"
          message={confirmDiscard.length === 1
            ? `Are you sure you want to discard changes to "${confirmDiscard[0].path}"? This cannot be undone.`
            : `Are you sure you want to discard changes to ${confirmDiscard.length} files? This cannot be undone.`}
          confirmLabel="Discard"
          onConfirm={executeDiscard}
          onCancel={() => setConfirmDiscard(null)}
        />
      )}
    </div>
  )
}

function FileRow({ file, isSelected, isDiffActive, onClick, onContextMenu, onAction, actionTitle, actionIcon, repoRoot, onDragFile }: {
  file: ChangedFile
  isSelected: boolean
  isDiffActive: boolean
  onClick: (f: ChangedFile, e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent, f: ChangedFile) => void
  onAction?: () => void
  actionTitle?: string
  actionIcon?: string
  repoRoot?: string
  onDragFile?: (absPath: string | null) => void
}) {
  const color = STATUS_COLORS[file.status] || 'var(--text-dim)'
  const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''

  const rowClass = [
    'flex items-center py-px px-3 cursor-pointer gap-2 group/row',
    isSelected && !isDiffActive ? 'bg-[rgba(86,156,214,0.15)] hover:bg-[rgba(86,156,214,0.22)]' : '',
    isDiffActive && isSelected ? 'bg-[rgba(86,156,214,0.25)]' : '',
    isDiffActive && !isSelected ? 'bg-white/[0.08] hover:bg-white/10' : '',
    !isSelected && !isDiffActive ? 'hover:bg-white/[0.04]' : '',
  ].filter(Boolean).join(' ')

  const absPath = repoRoot ? posixResolve(repoRoot, file.path) : file.path

  return (
    <div
      data-testid={`git-file-item-${file.name}`}
      className={rowClass}
      onClick={(e) => onClick(file, e)}
      onContextMenu={(e) => onContextMenu(e, file)}
      title={`${file.path} — ${STATUS_LABELS[file.status] || file.status}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', absPath)
        e.dataTransfer.effectAllowed = 'copy'
        onDragFile?.(absPath)
      }}
      onDragEnd={() => onDragFile?.(null)}
    >
      <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[12px]" style={{ color }}>
        {file.name}
        {dir && <span className="text-text-dim ml-1.5 text-[11px] opacity-60">{dir}</span>}
      </span>
      {onAction && (
        <button
          className="invisible group-hover/row:visible bg-transparent border-none text-text-dim text-[14px] font-semibold w-5 h-5 rounded-[3px] cursor-pointer leading-none p-0 shrink-0 flex items-center justify-center hover:bg-white/10"
          title={actionTitle}
          onClick={(e) => { e.stopPropagation(); onAction() }}
        >{actionIcon}</button>
      )}
      <span className="shrink-0 text-[11px] font-semibold w-4 text-center" style={{ color }}>{file.status}</span>
    </div>
  )
}

function ContextMenu({ x, y, selectedFiles, hasStaged, hasUnstaged, onStage, onUnstage, onDiscard, onClose }: {
  x: number; y: number
  selectedFiles: ChangedFile[]
  hasStaged: boolean
  hasUnstaged: boolean
  onStage?: (files: ChangedFile[]) => void
  onUnstage?: (files: ChangedFile[]) => void
  onDiscard?: (files: ChangedFile[]) => void
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const count = selectedFiles.length

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

  useEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    const nx = rect.right > window.innerWidth ? x - rect.width : x
    const ny = rect.bottom > window.innerHeight ? y - rect.height : y
    setPos({ x: Math.max(0, nx), y: Math.max(0, ny) })
  }, [x, y])

  const stagedFiles = selectedFiles.filter(f => f.staged)
  const unstagedFiles = selectedFiles.filter(f => !f.staged)
  const suffix = count > 1 ? ` (${count} files)` : ''

  return (
    <div
      className="fixed z-[9999] min-w-[180px] bg-bg-popup border border-border rounded-md py-1 shadow-[0_4px_16px_rgba(0,0,0,0.5)] font-ui text-[11px] select-none"
      ref={menuRef}
      style={{ left: pos.x, top: pos.y }}
    >
      {hasUnstaged && onStage && (
        <div className="flex items-center gap-2 py-[5px] px-3 text-text cursor-pointer transition-colors duration-75 hover:bg-[rgba(92,154,125,0.15)]" onClick={() => { onStage(unstagedFiles); onClose() }}>
          <span className="w-4 text-center text-[12px] font-bold shrink-0">+</span>
          <span>Stage Changes{suffix}</span>
        </div>
      )}
      {hasStaged && onUnstage && (
        <div className="flex items-center gap-2 py-[5px] px-3 text-text cursor-pointer transition-colors duration-75 hover:bg-[rgba(92,154,125,0.15)]" onClick={() => { onUnstage(stagedFiles); onClose() }}>
          <span className="w-4 text-center text-[12px] font-bold shrink-0">−</span>
          <span>Unstage Changes{suffix}</span>
        </div>
      )}
      {(hasStaged || hasUnstaged) && onDiscard && (
        <>
          <div className="h-px bg-border my-1 mx-2" />
          <div className="flex items-center gap-2 py-[5px] px-3 text-[#c74e39] cursor-pointer transition-colors duration-75 hover:bg-[rgba(199,78,57,0.15)]" onClick={() => { onDiscard(hasUnstaged ? unstagedFiles : stagedFiles); onClose() }}>
            <span className="w-4 text-center text-[12px] font-bold shrink-0">↩</span>
            <span>Discard Changes{suffix}</span>
          </div>
        </>
      )}
    </div>
  )
}

function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }: {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onConfirm, onCancel])

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[10000]" onClick={onCancel} />
      <div
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[10001] bg-bg-popup border border-border rounded-lg p-5 min-w-[320px] max-w-[440px] shadow-[0_8px_32px_rgba(0,0,0,0.6)] font-ui"
        ref={dialogRef}
      >
        <div className="text-[14px] font-semibold text-text mb-2">{title}</div>
        <div className="text-[12px] text-text-muted leading-[1.5] mb-4">{message}</div>
        <div className="flex justify-end gap-2">
          <button
            className="py-[5px] px-[14px] rounded border border-border text-[12px] cursor-pointer font-ui bg-transparent text-text hover:bg-white/[0.06]"
            onClick={onCancel}
          >Cancel</button>
          <button
            className="py-[5px] px-[14px] rounded border border-[#c74e39] text-[12px] cursor-pointer font-ui bg-[#c74e39] text-white hover:bg-[#d45a45]"
            onClick={onConfirm}
          >{confirmLabel}</button>
        </div>
      </div>
    </>
  )
}
