import { useState, useEffect, useRef, useCallback } from 'react'
import { EditTool } from '@pixel-city/shared/office/types'
import type { TileType as TileTypeVal, FloorColor } from '@pixel-city/shared/office/types'
import { getCatalogByCategory, buildDynamicCatalog, getActiveCategories } from '@pixel-city/shared/office/layout/furnitureCatalog'
import type { FurnitureCategory, LoadedAssetData } from '@pixel-city/shared/office/layout/furnitureCatalog'
import { getCachedSprite } from '@pixel-city/shared/office/sprites/spriteCache'
import { getColorizedFloorSprite, getFloorPatternCount, hasFloorSprites } from '@pixel-city/shared/office/floorTiles'
import { wallColorToHex } from '@pixel-city/shared/office/wallTiles'

/** Convert a hex color string to FloorColor (colorize mode) for walls */
function hexToWallColor(hex: string, existing: FloorColor): FloorColor {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  let h = 0, s = 0
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    if (max === r) h = (((g - b) / d) % 6 + 6) % 6 * 60
    else if (max === g) h = ((b - r) / d + 2) * 60
    else h = ((r - g) / d + 4) * 60
  }
  return {
    h: Math.round(h),
    s: Math.round(s * 100),
    b: Math.round((l - 0.5) * 200),
    c: existing.c,
  }
}

const btnStyle: React.CSSProperties = {
  padding: '2px 6px',
  fontSize: '11px',
  background: 'rgba(255, 255, 255, 0.08)',
  color: 'rgba(255, 255, 255, 0.7)',
  border: '1px solid transparent',
  borderRadius: 0,
  cursor: 'pointer',
}

const activeBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: 'rgba(90, 140, 255, 0.25)',
  color: 'rgba(255, 255, 255, 0.9)',
  border: '1px solid #5a8cff',
}

const tabStyle: React.CSSProperties = {
  padding: '2px 5px',
  fontSize: '11px',
  background: 'transparent',
  color: 'rgba(255, 255, 255, 0.5)',
  border: '1px solid transparent',
  borderRadius: 0,
  cursor: 'pointer',
}

const activeTabStyle: React.CSSProperties = {
  ...tabStyle,
  background: 'rgba(255, 255, 255, 0.08)',
  color: 'rgba(255, 255, 255, 0.8)',
  border: '1px solid #5a8cff',
}

export interface EditorToolbarProps {
  activeTool: EditTool
  selectedTileType: TileTypeVal
  selectedFurnitureType: string
  selectedFurnitureUid: string | null
  selectedFurnitureColor: FloorColor | null
  floorColor: FloorColor
  wallColor: FloorColor
  onToolChange: (tool: EditTool) => void
  onTileTypeChange: (type: TileTypeVal) => void
  onFloorColorChange: (color: FloorColor) => void
  onWallColorChange: (color: FloorColor) => void
  onSelectedFurnitureColorChange: (color: FloorColor | null) => void
  onFurnitureTypeChange: (type: string) => void
  loadedAssets?: LoadedAssetData
}

/** Render a floor pattern preview at 2x (32x32 canvas showing the 16x16 tile) */
function FloorPatternPreview({ patternIndex, color, selected, onClick }: {
  patternIndex: number
  color: FloorColor
  selected: boolean
  onClick: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const displaySize = 32
  const tileZoom = 2

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = displaySize
    canvas.height = displaySize
    ctx.imageSmoothingEnabled = false

    if (!hasFloorSprites()) {
      ctx.fillStyle = '#444'
      ctx.fillRect(0, 0, displaySize, displaySize)
      return
    }

    const sprite = getColorizedFloorSprite(patternIndex, color)
    const cached = getCachedSprite(sprite, tileZoom)
    ctx.drawImage(cached, 0, 0)
  }, [patternIndex, color])

  return (
    <button
      onClick={onClick}
      title={`Floor ${patternIndex}`}
      style={{
        width: displaySize,
        height: displaySize,
        padding: 0,
        border: selected ? '2px solid #5a8cff' : '2px solid var(--border)',
        borderRadius: 0,
        cursor: 'pointer',
        overflow: 'hidden',
        flexShrink: 0,
        background: '#2A2A3A',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: displaySize, height: displaySize, display: 'block' }}
      />
    </button>
  )
}

/** Slider control for a single color parameter */
function ColorSlider({ label, value, min, max, onChange }: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: '11px', color: '#999', width: 16, textAlign: 'right', flexShrink: 0 }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, height: 10, accentColor: 'rgba(90, 140, 255, 0.8)' }}
      />
      <span style={{ fontSize: '11px', color: '#999', width: 32, textAlign: 'right', flexShrink: 0 }}>{value}</span>
    </div>
  )
}

const DEFAULT_FURNITURE_COLOR: FloorColor = { h: 0, s: 0, b: 0, c: 0 }

export function EditorToolbar({
  activeTool,
  selectedTileType,
  selectedFurnitureType,
  selectedFurnitureUid,
  selectedFurnitureColor,
  floorColor,
  wallColor,
  onToolChange,
  onTileTypeChange,
  onFloorColorChange,
  onWallColorChange,
  onSelectedFurnitureColorChange,
  onFurnitureTypeChange,
  loadedAssets,
}: EditorToolbarProps) {
  const [activeCategory, setActiveCategory] = useState<FurnitureCategory>('desks')
  const [showColor, setShowColor] = useState(false)
  const [showFurnitureColor, setShowFurnitureColor] = useState(false)

  // Build dynamic catalog from loaded assets
  useEffect(() => {
    if (loadedAssets) {
      try {
        console.log(`[EditorToolbar] Building dynamic catalog with ${loadedAssets.catalog.length} assets...`)
        const success = buildDynamicCatalog(loadedAssets)
        console.log(`[EditorToolbar] Catalog build result: ${success}`)

        // Reset to first available category if current doesn't exist
        const activeCategories = getActiveCategories()
        if (activeCategories.length > 0) {
          const firstCat = activeCategories[0]?.id
          if (firstCat) {
            console.log(`[EditorToolbar] Setting active category to: ${firstCat}`)
            setActiveCategory(firstCat)
          }
        }
      } catch (err) {
        console.error(`[EditorToolbar] Error building dynamic catalog:`, err)
      }
    }
  }, [loadedAssets])

  const handleColorChange = useCallback((key: keyof FloorColor, value: number) => {
    onFloorColorChange({ ...floorColor, [key]: value })
  }, [floorColor, onFloorColorChange])

  // For selected furniture: use existing color or default
  const effectiveColor = selectedFurnitureColor ?? DEFAULT_FURNITURE_COLOR
  const handleSelFurnColorChange = useCallback((key: keyof FloorColor, value: number) => {
    onSelectedFurnitureColorChange({ ...effectiveColor, [key]: value })
  }, [effectiveColor, onSelectedFurnitureColorChange])

  const categoryItems = getCatalogByCategory(activeCategory)

  const patternCount = getFloorPatternCount()
  // Wall is TileType 0, floor patterns are 1..patternCount
  const floorPatterns = Array.from({ length: patternCount }, (_, i) => i + 1)

  const thumbSize = 36 // 2x for items

  const isFloorActive = activeTool === EditTool.TILE_PAINT || activeTool === EditTool.EYEDROPPER
  const isWallActive = activeTool === EditTool.WALL_PAINT
  const isEraseActive = activeTool === EditTool.ERASE
  const isFurnitureActive = activeTool === EditTool.FURNITURE_PLACE || activeTool === EditTool.FURNITURE_PICK

  return (
    <div
      data-testid="office-editor-toolbar"
      className="office-editor-toolbar"
      style={{
        position: 'absolute',
        bottom: 68,
        left: 10,
        zIndex: 50,
        background: 'var(--bg-popup)',
        border: '2px solid var(--border)',
        borderRadius: 0,
        padding: '6px 8px',
        display: 'flex',
        flexDirection: 'column-reverse',
        gap: 6,
        boxShadow: '2px 2px 0px var(--bg-deep)',
        maxWidth: 'calc(100vw - 20px)',
      }}
    >
      {/* Tool row — at the bottom */}
      <div data-testid="office-editor-tools" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <button
          data-testid="office-editor-tool-floor"
          style={isFloorActive ? activeBtnStyle : btnStyle}
          onClick={() => onToolChange(EditTool.TILE_PAINT)}
          title="Paint floor tiles"
        >
          Floor
        </button>
        <button
          data-testid="office-editor-tool-wall"
          style={isWallActive ? activeBtnStyle : btnStyle}
          onClick={() => onToolChange(EditTool.WALL_PAINT)}
          title="Paint walls (click to toggle)"
        >
          Wall
        </button>
        <button
          data-testid="office-editor-tool-erase"
          style={isEraseActive ? activeBtnStyle : btnStyle}
          onClick={() => onToolChange(EditTool.ERASE)}
          title="Erase tiles to void"
        >
          Erase
        </button>
        <button
          data-testid="office-editor-tool-furniture"
          style={isFurnitureActive ? activeBtnStyle : btnStyle}
          onClick={() => onToolChange(EditTool.FURNITURE_PLACE)}
          title="Place furniture"
        >
          Furniture
        </button>
      </div>

      {/* Sub-panel: Floor tiles — stacked bottom-to-top via column-reverse */}
      {isFloorActive && (
        <div style={{ display: 'flex', flexDirection: 'column-reverse', gap: 6 }}>
          {/* Color toggle + Pick — just above tool row */}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button
              style={showColor ? activeBtnStyle : btnStyle}
              onClick={() => setShowColor((v) => !v)}
              title="Adjust floor color"
            >
              Color
            </button>
            <button
              style={activeTool === EditTool.EYEDROPPER ? activeBtnStyle : btnStyle}
              onClick={() => onToolChange(EditTool.EYEDROPPER)}
              title="Pick floor pattern + color from existing tile"
            >
              Pick
            </button>
          </div>

          {/* Color controls (collapsible) — above Wall/Color/Pick */}
          {showColor && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
              padding: '4px 6px',
              background: 'var(--bg-deep)',
              border: '2px solid var(--border)',
              borderRadius: 0,
            }}>
              <ColorSlider label="H" value={floorColor.h} min={0} max={360} onChange={(v) => handleColorChange('h', v)} />
              <ColorSlider label="S" value={floorColor.s} min={0} max={100} onChange={(v) => handleColorChange('s', v)} />
              <ColorSlider label="B" value={floorColor.b} min={-100} max={100} onChange={(v) => handleColorChange('b', v)} />
              <ColorSlider label="C" value={floorColor.c} min={-100} max={100} onChange={(v) => handleColorChange('c', v)} />
            </div>
          )}

          {/* Floor pattern horizontal carousel — at the top */}
          <div style={{ display: 'flex', gap: 4, overflowX: 'auto', flexWrap: 'nowrap', paddingBottom: 2 }}>
            {floorPatterns.map((patIdx) => (
              <FloorPatternPreview
                key={patIdx}
                patternIndex={patIdx}
                color={floorColor}
                selected={selectedTileType === patIdx}
                onClick={() => onTileTypeChange(patIdx as TileTypeVal)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Sub-panel: Wall — inline color picker */}
      {isWallActive && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>Color</span>
          <input
            type="color"
            value={wallColorToHex(wallColor)}
            onChange={(e) => onWallColorChange(hexToWallColor(e.target.value, wallColor))}
            style={{
              width: 32,
              height: 20,
              padding: 0,
              border: '1px solid var(--border)',
              borderRadius: 0,
              cursor: 'pointer',
              background: 'none',
            }}
            title="Pick wall color"
          />
        </div>
      )}

      {/* Sub-panel: Furniture — stacked bottom-to-top via column-reverse */}
      {isFurnitureActive && (
        <div style={{ display: 'flex', flexDirection: 'column-reverse', gap: 4 }}>
          {/* Category tabs + Pick — just above tool row */}
          <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            {getActiveCategories().map((cat) => (
              <button
                key={cat.id}
                style={activeCategory === cat.id ? activeTabStyle : tabStyle}
                onClick={() => setActiveCategory(cat.id)}
              >
                {cat.label}
              </button>
            ))}
            <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.15)', margin: '0 2px', flexShrink: 0 }} />
            <button
              style={activeTool === EditTool.FURNITURE_PICK ? activeBtnStyle : btnStyle}
              onClick={() => onToolChange(EditTool.FURNITURE_PICK)}
              title="Pick furniture type from placed item"
            >
              Pick
            </button>
          </div>
          {/* Furniture items — single-row horizontal carousel at 2x */}
          <div style={{ display: 'flex', gap: 4, overflowX: 'auto', flexWrap: 'nowrap', paddingBottom: 2 }}>
            {categoryItems.map((entry) => {
              const cached = getCachedSprite(entry.sprite, 2)
              const isSelected = selectedFurnitureType === entry.type
              return (
                <button
                  key={entry.type}
                  onClick={() => onFurnitureTypeChange(entry.type)}
                  title={entry.label}
                  style={{
                    width: thumbSize,
                    height: thumbSize,
                    background: '#2A2A3A',
                    border: isSelected ? '2px solid #5a8cff' : '2px solid var(--border)',
                    borderRadius: 0,
                    cursor: 'pointer',
                    padding: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    flexShrink: 0,
                  }}
                >
                  <canvas
                    ref={(el) => {
                      if (!el) return
                      const ctx = el.getContext('2d')
                      if (!ctx) return
                      const scale = Math.min(thumbSize / cached.width, thumbSize / cached.height) * 0.85
                      el.width = thumbSize
                      el.height = thumbSize
                      ctx.imageSmoothingEnabled = false
                      ctx.clearRect(0, 0, thumbSize, thumbSize)
                      const dw = cached.width * scale
                      const dh = cached.height * scale
                      ctx.drawImage(cached, (thumbSize - dw) / 2, (thumbSize - dh) / 2, dw, dh)
                    }}
                    style={{ width: thumbSize, height: thumbSize }}
                  />
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Selected furniture color panel — shows when any placed furniture item is selected */}
      {selectedFurnitureUid && (
        <div style={{ display: 'flex', flexDirection: 'column-reverse', gap: 3 }}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button
              style={showFurnitureColor ? activeBtnStyle : btnStyle}
              onClick={() => setShowFurnitureColor((v) => !v)}
              title="Adjust selected furniture color"
            >
              Color
            </button>
            {selectedFurnitureColor && (
              <button
                style={btnStyle}
                onClick={() => onSelectedFurnitureColorChange(null)}
                title="Remove color (restore original)"
              >
                Clear
              </button>
            )}
          </div>
          {showFurnitureColor && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
              padding: '4px 6px',
              background: 'var(--bg-deep)',
              border: '2px solid var(--border)',
              borderRadius: 0,
            }}>
              {effectiveColor.colorize ? (
                <>
                  <ColorSlider label="H" value={effectiveColor.h} min={0} max={360} onChange={(v) => handleSelFurnColorChange('h', v)} />
                  <ColorSlider label="S" value={effectiveColor.s} min={0} max={100} onChange={(v) => handleSelFurnColorChange('s', v)} />
                </>
              ) : (
                <>
                  <ColorSlider label="H" value={effectiveColor.h} min={-180} max={180} onChange={(v) => handleSelFurnColorChange('h', v)} />
                  <ColorSlider label="S" value={effectiveColor.s} min={-100} max={100} onChange={(v) => handleSelFurnColorChange('s', v)} />
                </>
              )}
              <ColorSlider label="B" value={effectiveColor.b} min={-100} max={100} onChange={(v) => handleSelFurnColorChange('b', v)} />
              <ColorSlider label="C" value={effectiveColor.c} min={-100} max={100} onChange={(v) => handleSelFurnColorChange('c', v)} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '11px', color: '#999', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={!!effectiveColor.colorize}
                  onChange={(e) => onSelectedFurnitureColorChange({ ...effectiveColor, colorize: e.target.checked || undefined })}
                  style={{ accentColor: 'rgba(90, 140, 255, 0.8)' }}
                />
                Colorize
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
