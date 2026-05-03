import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { CityFolderIcon, CityTreeIcon, CityDotIcon, FolderSmallIcon, BuildingThumbIcon } from '../icons/index.js'
import type { CityLayout, CityBuildingCatalog, PlacedBuilding } from '@pixel-city/shared/city/editor/cityLayoutTypes'

interface CityFolderSidebarProps {
  layout: CityLayout
  catalog: CityBuildingCatalog
  buildingDirs: Record<string, string>
  buildingImages: Record<string, HTMLImageElement>
  onEnterBuilding: (buildingUid: string) => void
  onRenameBuilding: (buildingUid: string, newTitle: string) => void
  onReassignFolder: (buildingUid: string) => void
  onUnassignFolder: (buildingUid: string) => void
  onRemoveBuilding: (buildingUid: string) => void
  collapsed: boolean
  onToggleCollapse: () => void
}

interface CtxMenuState {
  x: number
  y: number
  buildingUid: string
  hasFolder: boolean
}

export function CityFolderSidebar({
  layout,
  catalog,
  buildingDirs,
  buildingImages,
  onEnterBuilding,
  onRenameBuilding,
  onReassignFolder,
  onUnassignFolder,
  onRemoveBuilding,
  collapsed,
  onToggleCollapse,
}: CityFolderSidebarProps) {
  const [hoveredUid, setHoveredUid] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null)
  const [renamingUid, setRenamingUid] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  const items = useMemo(() => {
    return layout.buildings.map((b) => {
      const def = catalog.buildings.find((d) => d.id === b.buildingDefId)
      const dir = buildingDirs[b.uid] || null
      const folderName = dir ? dir.split('/').filter(Boolean).pop() || dir : null
      return { building: b, def, dir, folderName }
    })
  }, [layout.buildings, catalog.buildings, buildingDirs])

  const assigned = items.filter((i) => i.dir)
  const unassigned = items.filter((i) => !i.dir)

  // Close context menu on outside click or escape
  useEffect(() => {
    if (!ctxMenu) return
    const handleClick = () => setCtxMenu(null)
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCtxMenu(null) }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [ctxMenu])

  // Focus rename input when entering rename mode
  useEffect(() => {
    if (renamingUid && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingUid])

  const handleContextMenu = useCallback((e: React.MouseEvent, buildingUid: string, hasFolder: boolean) => {
    e.preventDefault()
    e.stopPropagation()
    // Position-adjust to keep on screen
    const x = Math.min(e.clientX, window.innerWidth - 180)
    const y = Math.min(e.clientY, window.innerHeight - 200)
    setCtxMenu({ x, y, buildingUid, hasFolder })
  }, [])

  const handleStartRename = useCallback((buildingUid: string) => {
    const item = items.find(i => i.building.uid === buildingUid)
    const currentName = item?.building.title || item?.def?.name || 'Building'
    setRenameValue(currentName)
    setRenamingUid(buildingUid)
    setCtxMenu(null)
  }, [items])

  const handleCommitRename = useCallback(() => {
    if (renamingUid && renameValue.trim()) {
      onRenameBuilding(renamingUid, renameValue.trim())
    }
    setRenamingUid(null)
    setRenameValue('')
  }, [renamingUid, renameValue, onRenameBuilding])

  const handleCancelRename = useCallback(() => {
    setRenamingUid(null)
    setRenameValue('')
  }, [])

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleCommitRename()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleCancelRename()
    }
  }, [handleCommitRename, handleCancelRename])

  if (collapsed) {
    return (
      <div
        className="group absolute top-0 left-0 bottom-0 w-8 z-10 flex flex-col items-start justify-start pt-2.5 cursor-pointer bg-bg/95 border-r border-border backdrop-blur-[8px] hover:bg-bg-card/95"
        onClick={onToggleCollapse}
      >
        <div className="flex items-center justify-center w-8 h-8 text-text-dim group-hover:text-text" title="Open project folders">
          <CityFolderIcon />
        </div>
      </div>
    )
  }

  const renderName = (building: PlacedBuilding, defName?: string) => {
    if (renamingUid === building.uid) {
      return (
        <input
          ref={renameInputRef}
          className="w-full bg-bg-input border border-[rgba(92,154,125,0.5)] rounded-[3px] text-text font-ui text-[12px] px-[4px] py-[1px] outline-none leading-[1.3] focus:border-[rgba(92,154,125,0.8)]"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={handleCommitRename}
          onKeyDown={handleRenameKeyDown}
          onClick={(e) => e.stopPropagation()}
        />
      )
    }
    return (
      <div className="text-[12px] text-text whitespace-nowrap overflow-hidden text-ellipsis leading-[1.3]">
        {building.title || defName || 'Building'}
      </div>
    )
  }

  return (
    <div className="absolute top-0 left-0 bottom-0 w-[220px] bg-bg/95 border-r border-border z-10 flex flex-col backdrop-blur-[8px]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-2 border-b border-border" style={{ paddingLeft: 12, paddingTop: 10, paddingBottom: 8, paddingRight: 10 }}>
        <span className="text-[11px] font-semibold text-text-dim uppercase tracking-[0.5px]">Projects</span>
        <button
          className="flex items-center justify-center w-[22px] h-[22px] bg-transparent border border-transparent rounded-[4px] text-text-dim cursor-pointer p-0 hover:text-text hover:border-border hover:bg-bg-hover"
          onClick={onToggleCollapse}
          title="Collapse sidebar"
        >
          <CityTreeIcon />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto py-1 [&::-webkit-scrollbar]:w-[4px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:rounded-[2px]">
        {assigned.length > 0 && (
          <>
            {assigned.map(({ building, def, dir, folderName }) => (
              <div
                key={building.uid}
                className={`flex items-center gap-2 px-2.5 py-1.5 cursor-pointer transition-colors duration-100${hoveredUid === building.uid ? ' bg-bg-hover' : ''} hover:bg-bg-hover`}
                onMouseEnter={() => setHoveredUid(building.uid)}
                onMouseLeave={() => setHoveredUid(null)}
                onClick={() => onEnterBuilding(building.uid)}
                onContextMenu={(e) => handleContextMenu(e, building.uid, true)}
                title={dir!}
              >
                <BuildingThumb defId={def?.id} buildingImages={def ? { [def.id]: buildingImages[def.id] } : {}} />
                <div className="min-w-0 flex-1">
                  {renderName(building, def?.name)}
                  <div className="text-[10px] text-text-dim whitespace-nowrap overflow-hidden text-ellipsis flex items-center gap-[3px] leading-[1.3]">
                    <CityDotIcon />
                    {folderName}
                  </div>
                </div>
              </div>
            ))}
          </>
        )}

        {unassigned.length > 0 && (
          <>
            <div className="px-3 pt-2 pb-1 text-[10px] text-text-dim uppercase tracking-[0.4px] opacity-60">
              <span>Unassigned</span>
            </div>
            {unassigned.map(({ building, def }) => (
              <div
                key={building.uid}
                className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer transition-colors duration-100 opacity-50 hover:opacity-75 hover:bg-bg-hover"
                onMouseEnter={() => setHoveredUid(building.uid)}
                onMouseLeave={() => setHoveredUid(null)}
                onClick={() => onEnterBuilding(building.uid)}
                onContextMenu={(e) => handleContextMenu(e, building.uid, false)}
              >
                <BuildingThumb defId={def?.id} buildingImages={buildingImages} />
                <div className="min-w-0 flex-1">
                  {renderName(building, def?.name)}
                  <div className="text-[10px] text-text-dim whitespace-nowrap overflow-hidden text-ellipsis flex items-center gap-[3px] leading-[1.3] italic opacity-70">
                    No folder assigned
                  </div>
                </div>
              </div>
            ))}
          </>
        )}

        {items.length === 0 && (
          <div className="px-3 py-5 text-center text-[11px] text-text-dim opacity-60">
            No buildings placed yet
          </div>
        )}
      </div>

      {/* Context Menu */}
      {ctxMenu && (
        <div
          className="fixed z-[9999] min-w-[160px] bg-bg-popup border border-border rounded-[6px] py-[4px] shadow-[0_4px_16px_rgba(0,0,0,0.5)] font-ui text-[11px] select-none"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button className="flex items-center gap-[8px] px-[12px] py-[5px] w-full bg-transparent border-none text-text font-[inherit] text-[11px] cursor-pointer text-left transition-[background] duration-[80ms] hover:bg-[rgba(92,154,125,0.15)]" onClick={() => handleStartRename(ctxMenu.buildingUid)}>
            <span className="w-[16px] text-center text-[12px] shrink-0 flex items-center justify-center">&#9998;</span>
            Rename
          </button>
          <div className="h-[1px] bg-border mx-[8px] my-[4px]" />
          {ctxMenu.hasFolder ? (
            <>
              <button className="flex items-center gap-[8px] px-[12px] py-[5px] w-full bg-transparent border-none text-text font-[inherit] text-[11px] cursor-pointer text-left transition-[background] duration-[80ms] hover:bg-[rgba(92,154,125,0.15)]" onClick={() => { onReassignFolder(ctxMenu.buildingUid); setCtxMenu(null) }}>
                <span className="w-[16px] text-center text-[12px] shrink-0 flex items-center justify-center">
                  <FolderSmallIcon />
                </span>
                Reassign Folder
              </button>
              <button className="flex items-center gap-[8px] px-[12px] py-[5px] w-full bg-transparent border-none text-[#c97b7b] font-[inherit] text-[11px] cursor-pointer text-left transition-[background] duration-[80ms] hover:bg-[rgba(201,123,123,0.12)]" onClick={() => { onUnassignFolder(ctxMenu.buildingUid); setCtxMenu(null) }}>
                <span className="w-[16px] text-center text-[12px] shrink-0 flex items-center justify-center">&#10005;</span>
                Unassign Folder
              </button>
            </>
          ) : (
            <>
              <button className="flex items-center gap-[8px] px-[12px] py-[5px] w-full bg-transparent border-none text-text font-[inherit] text-[11px] cursor-pointer text-left transition-[background] duration-[80ms] hover:bg-[rgba(92,154,125,0.15)]" onClick={() => { onReassignFolder(ctxMenu.buildingUid); setCtxMenu(null) }}>
                <span className="w-[16px] text-center text-[12px] shrink-0 flex items-center justify-center">
                  <FolderSmallIcon />
                </span>
                Assign Folder
              </button>
              <div className="h-[1px] bg-border mx-[8px] my-[4px]" />
              <button className="flex items-center gap-[8px] px-[12px] py-[5px] w-full bg-transparent border-none text-[#c97b7b] font-[inherit] text-[11px] cursor-pointer text-left transition-[background] duration-[80ms] hover:bg-[rgba(201,123,123,0.12)]" onClick={() => { onRemoveBuilding(ctxMenu.buildingUid); setCtxMenu(null) }}>
                <span className="w-[16px] text-center text-[12px] shrink-0 flex items-center justify-center">&#128465;</span>
                Remove from Sidebar
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function BuildingThumb({ defId, buildingImages }: { defId?: string; buildingImages: Record<string, HTMLImageElement> }) {
  const img = defId ? buildingImages[defId] : undefined
  if (!img) {
    return (
      <div className="shrink-0 w-6 h-6 flex items-center justify-center text-text-dim bg-white/[0.04] rounded-[4px]">
        <BuildingThumbIcon size={16} />
      </div>
    )
  }

  return (
    <div className="shrink-0 w-6 h-6 flex items-center justify-center text-text-dim bg-white/[0.04] rounded-[4px]">
      <img src={img.src} alt="" style={{ width: 20, height: 20, imageRendering: 'pixelated', objectFit: 'contain' }} />
    </div>
  )
}
