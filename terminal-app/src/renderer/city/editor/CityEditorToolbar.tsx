import { useState } from 'react'
import { CityEditTool, CityTileType } from '@pixel-city/shared/city/editor/cityLayoutTypes'
import type { CityEditTool as CityEditToolVal, CityTileType as CityTileTypeVal, CityBuildingCatalog, CityAssetCategory } from '@pixel-city/shared/city/editor/cityLayoutTypes'
import { getTerrainColor } from '@pixel-city/shared/city/editor/cityTerrainTiles'
import { ZOOM_MIN, ZOOM_MAX } from '@pixel-city/shared/constants'
import { useRef, useEffect } from 'react'

const btnStyle: React.CSSProperties = {
  padding: '2px 6px',
  fontSize: '11px',
  background: 'var(--bg-hover)',
  color: 'var(--text-dim)',
  border: '1px solid transparent',
  borderRadius: 0,
  cursor: 'pointer',
}

const activeBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: 'var(--accent-dim)',
  color: 'var(--text-bright)',
  border: '1px solid var(--accent)',
}

const TERRAIN_TILES: { type: CityTileTypeVal; label: string }[] = [
  { type: CityTileType.GRASS_1, label: 'Grass 1' },
  { type: CityTileType.GRASS_2, label: 'Grass 2' },
  { type: CityTileType.ROAD, label: 'Road' },
  { type: CityTileType.WATER, label: 'Water' },
  { type: CityTileType.DIRT, label: 'Dirt' },
  { type: CityTileType.SAND, label: 'Sand' },
  { type: CityTileType.VOID, label: 'Void' },
]

interface CityEditorToolbarProps {
  activeTool: CityEditToolVal
  selectedTileType: CityTileTypeVal
  selectedBuildingDefId: string | null
  catalog: CityBuildingCatalog
  buildingImages: Record<string, HTMLImageElement>
  zoom: number
  onZoomChange: (zoom: number) => void
  onToolChange: (tool: CityEditToolVal) => void
  onTileTypeChange: (type: CityTileTypeVal) => void
  onBuildingDefChange: (defId: string) => void
  showGrid: boolean
  onToggleGrid: () => void
}

function BuildingThumbnail({ img, selected, onClick, label }: { img: HTMLImageElement; selected: boolean; onClick: () => void; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, 36, 36)
    ctx.imageSmoothingEnabled = false
    const scale = Math.min(32 / img.width, 32 / img.height)
    const w = img.width * scale
    const h = img.height * scale
    ctx.drawImage(img, (36 - w) / 2, (36 - h) / 2, w, h)
  }, [img])

  return (
    <canvas
      ref={canvasRef}
      width={36}
      height={36}
      onClick={onClick}
      title={label}
      style={{
        cursor: 'pointer',
        border: selected ? '1px solid var(--accent)' : '1px solid var(--border)',
        background: selected ? 'var(--accent-dim)' : 'var(--bg-hover)',
      }}
    />
  )
}

export function CityEditorToolbar({
  activeTool,
  selectedTileType,
  selectedBuildingDefId,
  catalog,
  buildingImages,
  zoom,
  onZoomChange,
  onToolChange,
  onTileTypeChange,
  onBuildingDefChange,
  showGrid,
  onToggleGrid,
}: CityEditorToolbarProps) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  const categories = catalog.categories || []
  const rootCategories = categories.filter(c => !c.parentId)

  // Get assets for current category view (including children)
  function getVisibleAssets() {
    if (selectedCategory === null) {
      // Show all assets
      return catalog.buildings
    }
    // Show assets in this category + all descendant categories
    const descendantIds = getAllDescendantIds(categories, selectedCategory)
    const validIds = new Set([selectedCategory, ...descendantIds])
    return catalog.buildings.filter(b => b.category && validIds.has(b.category))
  }

  const visibleAssets = getVisibleAssets()

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 10,
        right: 10,
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column-reverse',
        gap: 4,
        pointerEvents: 'auto',
        alignItems: 'flex-end',
      }}
    >
      {/* Tool row */}
      <div style={{ display: 'flex', gap: 2, background: 'var(--bg-popup)', border: '1px solid var(--border)', padding: 4 }}>
        <button style={activeTool === CityEditTool.SELECT ? activeBtnStyle : btnStyle} onClick={() => onToolChange(CityEditTool.SELECT)}>
          Select
        </button>
        <button style={activeTool === CityEditTool.TERRAIN_PAINT ? activeBtnStyle : btnStyle} onClick={() => onToolChange(CityEditTool.TERRAIN_PAINT)}>
          Terrain
        </button>
        <button style={activeTool === CityEditTool.BUILDING_PLACE ? activeBtnStyle : btnStyle} onClick={() => onToolChange(CityEditTool.BUILDING_PLACE)}>
          Building
        </button>
        <button style={activeTool === CityEditTool.ERASE ? activeBtnStyle : btnStyle} onClick={() => onToolChange(CityEditTool.ERASE)}>
          Erase
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 2, alignItems: 'center' }}>
          <button
            style={showGrid ? activeBtnStyle : btnStyle}
            onClick={onToggleGrid}
            title="Toggle grid"
          >
            Grid
          </button>
          <button
            style={{ ...btnStyle, padding: '2px 5px', fontSize: '13px', fontWeight: 'bold' }}
            onClick={() => onZoomChange(Math.max(ZOOM_MIN, zoom - 1))}
            disabled={zoom <= ZOOM_MIN}
            title="Zoom out"
          >
            -
          </button>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)', minWidth: 24, textAlign: 'center' }}>
            {zoom}x
          </span>
          <button
            style={{ ...btnStyle, padding: '2px 5px', fontSize: '13px', fontWeight: 'bold' }}
            onClick={() => onZoomChange(Math.min(ZOOM_MAX, zoom + 1))}
            disabled={zoom >= ZOOM_MAX}
            title="Zoom in"
          >
            +
          </button>
        </div>
      </div>

      {/* Terrain sub-panel */}
      {activeTool === CityEditTool.TERRAIN_PAINT && (
        <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', background: 'var(--bg-popup)', border: '1px solid var(--border)', padding: 6 }}>
          {TERRAIN_TILES.map(({ type, label }) => (
            <button
              key={type}
              onClick={() => onTileTypeChange(type)}
              title={label}
              style={{
                width: 28,
                height: 28,
                padding: 0,
                cursor: 'pointer',
                background: getTerrainColor(type),
                border: type === selectedTileType ? '2px solid var(--accent)' : '1px solid var(--border)',
                borderRadius: 0,
              }}
            />
          ))}
        </div>
      )}

      {/* Building sub-panel */}
      {activeTool === CityEditTool.BUILDING_PLACE && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--bg-popup)', border: '1px solid var(--border)', padding: 8, color: 'var(--text-bright)' }}>
          {/* Category tabs */}
          {categories.length > 0 && (
            <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <button
                style={selectedCategory === null ? activeBtnStyle : btnStyle}
                onClick={() => setSelectedCategory(null)}
              >
                All
              </button>
              {rootCategories.map(cat => (
                <CategoryButton
                  key={cat.id}
                  category={cat}
                  allCategories={categories}
                  selectedCategory={selectedCategory}
                  onSelect={setSelectedCategory}
                />
              ))}
            </div>
          )}

          {/* Asset thumbnails */}
          <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', maxWidth: 400, maxHeight: 160, overflow: 'auto' }}>
            {visibleAssets.map((def) => {
              const img = buildingImages[def.id]
              if (!img) return null
              return (
                <BuildingThumbnail
                  key={def.id}
                  img={img}
                  selected={selectedBuildingDefId === def.id}
                  onClick={() => onBuildingDefChange(def.id)}
                  label={`${def.name} (${def.footprintW}x${def.footprintH})`}
                />
              )
            })}
            {visibleAssets.length === 0 && (
              <span style={{ fontSize: 11, opacity: 0.4, padding: 4 }}>No assets</span>
            )}
          </div>

        </div>
      )}

    </div>
  )
}

function CategoryButton({
  category,
  allCategories,
  selectedCategory,
  onSelect,
}: {
  category: CityAssetCategory
  allCategories: CityAssetCategory[]
  selectedCategory: string | null
  onSelect: (id: string) => void
}) {
  const children = allCategories.filter(c => c.parentId === category.id)
  const isSelected = selectedCategory === category.id
  const isChildSelected = children.some(c => c.id === selectedCategory)

  return (
    <>
      <button
        style={isSelected || isChildSelected ? activeBtnStyle : btnStyle}
        onClick={() => onSelect(category.id)}
      >
        {category.name}
      </button>
      {(isSelected || isChildSelected) && children.length > 0 && children.map(child => (
        <button
          key={child.id}
          style={selectedCategory === child.id ? { ...activeBtnStyle, fontSize: '10px' } : { ...btnStyle, fontSize: '10px' }}
          onClick={() => onSelect(child.id)}
        >
          {child.name}
        </button>
      ))}
    </>
  )
}

function getAllDescendantIds(categories: CityAssetCategory[], parentId: string): string[] {
  const result: string[] = []
  const children = categories.filter(c => c.parentId === parentId)
  for (const child of children) {
    result.push(child.id)
    result.push(...getAllDescendantIds(categories, child.id))
  }
  return result
}
