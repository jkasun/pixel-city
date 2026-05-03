import { useState } from 'react'
import type { CityBuildingCatalog, CityBuildingDef, CityAssetCategory } from '@pixel-city/shared/city/editor/cityLayoutTypes'
import { useConfirm } from '../../components/ConfirmDialog.js'

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  zIndex: 100,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const panelStyle: React.CSSProperties = {
  background: 'var(--bg-popup)',
  border: '1px solid var(--border)',
  padding: 16,
  width: 520,
  maxHeight: '80vh',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  color: 'var(--text-bright)',
  fontSize: 13,
  overflow: 'hidden',
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-input)',
  border: '1px solid var(--border)',
  color: 'var(--text-bright)',
  padding: '3px 6px',
  fontSize: 12,
  borderRadius: 0,
  outline: 'none',
}

const btnStyle: React.CSSProperties = {
  padding: '2px 8px',
  fontSize: 11,
  background: 'rgba(255, 255, 255, 0.08)',
  color: 'rgba(255, 255, 255, 0.7)',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: 0,
  cursor: 'pointer',
}

const dangerBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: 'rgba(200, 50, 50, 0.2)',
  color: 'rgba(255, 150, 150, 0.8)',
}

interface CityAssetCatalogProps {
  catalog: CityBuildingCatalog
  buildingImages: Record<string, HTMLImageElement>
  onCatalogChange: (catalog: CityBuildingCatalog) => void
  onClose: () => void
}

function getCategories(catalog: CityBuildingCatalog): CityAssetCategory[] {
  return catalog.categories || []
}

function getRootCategories(categories: CityAssetCategory[]): CityAssetCategory[] {
  return categories.filter(c => !c.parentId)
}

function getChildCategories(categories: CityAssetCategory[], parentId: string): CityAssetCategory[] {
  return categories.filter(c => c.parentId === parentId)
}

function getAssetsInCategory(catalog: CityBuildingCatalog, categoryId: string | null): CityBuildingDef[] {
  if (categoryId === null) {
    return catalog.buildings.filter(b => !b.category)
  }
  return catalog.buildings.filter(b => b.category === categoryId)
}

function CategoryNode({
  category,
  allCategories,
  catalog,
  buildingImages,
  depth,
  selectedCategoryId,
  onSelect,
}: {
  category: CityAssetCategory
  allCategories: CityAssetCategory[]
  catalog: CityBuildingCatalog
  buildingImages: Record<string, HTMLImageElement>
  depth: number
  selectedCategoryId: string | null
  onSelect: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const children = getChildCategories(allCategories, category.id)
  const assets = getAssetsInCategory(catalog, category.id)
  const isSelected = selectedCategoryId === category.id

  return (
    <div>
      <div
        onClick={() => onSelect(category.id)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '3px 6px',
          paddingLeft: depth * 16 + 6,
          cursor: 'pointer',
          background: isSelected ? 'rgba(90, 140, 255, 0.2)' : 'transparent',
          borderLeft: isSelected ? '2px solid #5a8cff' : '2px solid transparent',
        }}
      >
        {(children.length > 0) && (
          <span
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
            style={{ fontSize: 10, width: 12, textAlign: 'center', opacity: 0.5 }}
          >
            {expanded ? '▼' : '▶'}
          </span>
        )}
        {children.length === 0 && <span style={{ width: 12 }} />}
        <span style={{ fontWeight: 500 }}>{category.name}</span>
        <span style={{ fontSize: 10, opacity: 0.4, marginLeft: 'auto' }}>{assets.length}</span>
      </div>
      {expanded && children.map(child => (
        <CategoryNode
          key={child.id}
          category={child}
          allCategories={allCategories}
          catalog={catalog}
          buildingImages={buildingImages}
          depth={depth + 1}
          selectedCategoryId={selectedCategoryId}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

export function CityAssetCatalog({ catalog, buildingImages, onCatalogChange, onClose }: CityAssetCatalogProps) {
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null)
  const [editCategory, setEditCategory] = useState('')

  const categories = getCategories(catalog)
  const rootCategories = getRootCategories(categories)
  const assetsInView = getAssetsInCategory(catalog, selectedCategoryId)
  const uncategorized = getAssetsInCategory(catalog, null)

  function addCategory() {
    if (!newCategoryName.trim()) return
    const id = newCategoryName.trim().toLowerCase().replace(/\s+/g, '-')
    if (categories.some(c => c.id === id)) return
    const newCat: CityAssetCategory = {
      id,
      name: newCategoryName.trim(),
      parentId: selectedCategoryId || undefined,
    }
    onCatalogChange({
      ...catalog,
      categories: [...categories, newCat],
    })
    setNewCategoryName('')
  }

  function removeCategory(catId: string) {
    // Move assets in this category to uncategorized
    const childCats = getAllDescendantIds(categories, catId)
    const removedIds = new Set([catId, ...childCats])
    const updatedBuildings = catalog.buildings.map(b =>
      b.category && removedIds.has(b.category) ? { ...b, category: undefined } : b
    )
    const updatedCategories = categories.filter(c => !removedIds.has(c.id))
    onCatalogChange({ ...catalog, buildings: updatedBuildings, categories: updatedCategories })
    if (selectedCategoryId && removedIds.has(selectedCategoryId)) setSelectedCategoryId(null)
  }

  function moveAssetToCategory(assetId: string, categoryId: string | undefined) {
    const updatedBuildings = catalog.buildings.map(b =>
      b.id === assetId ? { ...b, category: categoryId } : b
    )
    onCatalogChange({ ...catalog, buildings: updatedBuildings })
    setEditingAssetId(null)
  }

  function removeAsset(assetId: string) {
    onCatalogChange({
      ...catalog,
      buildings: catalog.buildings.filter(b => b.id !== assetId),
    })
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Asset Catalog</div>
          <button style={btnStyle} onClick={onClose}>Close</button>
        </div>

        <div style={{ display: 'flex', gap: 8, flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {/* Left: Category tree */}
          <div style={{ width: 180, borderRight: '1px solid var(--border)', overflow: 'auto', flexShrink: 0 }}>
            <div
              onClick={() => setSelectedCategoryId(null)}
              style={{
                padding: '3px 6px',
                cursor: 'pointer',
                background: selectedCategoryId === null ? 'rgba(90, 140, 255, 0.2)' : 'transparent',
                borderLeft: selectedCategoryId === null ? '2px solid #5a8cff' : '2px solid transparent',
                fontWeight: 500,
                fontSize: 12,
              }}
            >
              All / Uncategorized
              <span style={{ fontSize: 10, opacity: 0.4, marginLeft: 6 }}>{uncategorized.length}</span>
            </div>

            {rootCategories.map(cat => (
              <CategoryNode
                key={cat.id}
                category={cat}
                allCategories={categories}
                catalog={catalog}
                buildingImages={buildingImages}
                depth={0}
                selectedCategoryId={selectedCategoryId}
                onSelect={setSelectedCategoryId}
              />
            ))}

            {/* Add category */}
            <div style={{ display: 'flex', gap: 2, padding: '6px 4px', marginTop: 4 }}>
              <input
                style={{ ...inputStyle, flex: 1, fontSize: 11 }}
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder={selectedCategoryId ? 'Sub-category...' : 'New category...'}
                onKeyDown={(e) => e.key === 'Enter' && addCategory()}
              />
              <button style={{ ...btnStyle, fontSize: 10, padding: '2px 4px' }} onClick={addCategory}>+</button>
            </div>

            {/* Remove selected category */}
            {selectedCategoryId && (
              <div style={{ padding: '0 4px' }}>
                <button style={{ ...dangerBtnStyle, width: '100%', fontSize: 10 }} onClick={() => removeCategory(selectedCategoryId)}>
                  Remove "{categories.find(c => c.id === selectedCategoryId)?.name}"
                </button>
              </div>
            )}
          </div>

          {/* Right: Assets in selected category */}
          <div style={{ flex: 1, overflow: 'auto' }}>
            <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 6 }}>
              {selectedCategoryId
                ? categories.find(c => c.id === selectedCategoryId)?.name || 'Category'
                : 'Uncategorized'}
              {' '}({assetsInView.length} assets)
            </div>

            {assetsInView.length === 0 && (
              <div style={{ fontSize: 11, opacity: 0.3, padding: 12, textAlign: 'center' }}>
                No assets in this category
              </div>
            )}

            {assetsInView.map(asset => (
              <div
                key={asset.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 6px',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                }}
              >
                {/* Thumbnail */}
                <div style={{
                  width: 28, height: 28, background: 'var(--bg-deep)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  {buildingImages[asset.id] && (
                    <img
                      src={buildingImages[asset.id].src}
                      style={{ maxWidth: 24, maxHeight: 24, imageRendering: 'pixelated' }}
                    />
                  )}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {asset.name}
                  </div>
                  <div style={{ fontSize: 10, opacity: 0.4 }}>
                    {asset.footprintW}x{asset.footprintH} tiles
                  </div>
                </div>

                {/* Move to category */}
                {editingAssetId === asset.id ? (
                  <select
                    style={{ ...inputStyle, fontSize: 10, width: 90 }}
                    value={asset.category || ''}
                    onChange={(e) => moveAssetToCategory(asset.id, e.target.value || undefined)}
                    autoFocus
                    onBlur={() => setEditingAssetId(null)}
                  >
                    <option value="">Uncategorized</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.parentId ? '  ' : ''}{c.name}</option>
                    ))}
                  </select>
                ) : (
                  <button style={{ ...btnStyle, fontSize: 10 }} onClick={() => setEditingAssetId(asset.id)} title="Move to category">
                    Move
                  </button>
                )}

                <button style={{ ...dangerBtnStyle, fontSize: 10, padding: '1px 4px' }} onClick={() => removeAsset(asset.id)} title="Remove asset">
                  x
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// Get all descendant category IDs (recursive)
function getAllDescendantIds(categories: CityAssetCategory[], parentId: string): string[] {
  const result: string[] = []
  const children = categories.filter(c => c.parentId === parentId)
  for (const child of children) {
    result.push(child.id)
    result.push(...getAllDescendantIds(categories, child.id))
  }
  return result
}
