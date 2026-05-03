import { useState } from 'react'
import type { CityBuildingDef, CityBuildingCatalog } from '@pixel-city/shared/city/editor/cityLayoutTypes'
import { platform } from '../../platform/index.js'

const { ipcRenderer } = window.require('electron')

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
  padding: 20,
  minWidth: 360,
  maxWidth: 480,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  color: 'var(--text-bright)',
  fontSize: 13,
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-input)',
  border: '1px solid var(--border)',
  color: 'var(--text-bright)',
  padding: '4px 8px',
  fontSize: 13,
  borderRadius: 0,
  outline: 'none',
}

const btnStyle: React.CSSProperties = {
  padding: '4px 12px',
  fontSize: 12,
  background: 'rgba(255, 255, 255, 0.08)',
  color: 'rgba(255, 255, 255, 0.7)',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: 0,
  cursor: 'pointer',
}

interface CityBuildingImporterProps {
  projectCwd: string | null
  catalog: CityBuildingCatalog
  onClose: () => void
  onImport: (def: CityBuildingDef, destPath: string) => void
}

export function CityBuildingImporter({ projectCwd, catalog, onClose, onImport }: CityBuildingImporterProps) {
  const [srcPath, setSrcPath] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [type, setType] = useState('shop')
  const [category, setCategory] = useState('')
  const [footprintW, setFootprintW] = useState(2)
  const [footprintH, setFootprintH] = useState(2)
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)
  const [importing, setImporting] = useState(false)

  async function handleBrowse() {
    const filePath = await platform().dialog.openFile({
      filters: [{ name: 'Images', extensions: ['png'] }],
      title: 'Select Building Sprite',
    })
    if (!filePath) return
    setSrcPath(filePath)

    // Read file via fs and convert to base64 data URL (file:// blocked by Electron)
    const fs = window.require('fs')
    try {
      const data = fs.readFileSync(filePath)
      const base64 = data.toString('base64')
      const dataUrl = `data:image/png;base64,${base64}`
      setPreviewUrl(dataUrl)

      // Get image dimensions
      const img = new Image()
      img.onload = () => setImgSize({ w: img.width, h: img.height })
      img.src = dataUrl
    } catch { /* ignore */ }

    // Auto-fill name from filename
    const fileName = filePath.split('/').pop()?.replace(/\.png$/i, '') || ''
    if (!name) setName(fileName)
  }

  async function handleImport() {
    if (!srcPath || !name || importing) return
    setImporting(true)
    try {
      const pixelW = imgSize?.w || 32
      const pixelH = imgSize?.h || 32
      const result = await ipcRenderer.invoke('city-import-building', {
        srcPath,
        projectDir: projectCwd,
        meta: { name, type, footprintW, footprintH, pixelW, pixelH, ...(category ? { category } : {}) },
      })
      if (result.success) {
        const def: CityBuildingDef = {
          id: `custom_${Date.now()}`,
          name,
          type,
          file: result.fileName,
          footprintW,
          footprintH,
          pixelW,
          pixelH,
          category: category || undefined,
        }
        onImport(def, result.destPath)
      }
    } finally {
      setImporting(false)
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Import Building</div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button style={btnStyle} onClick={handleBrowse}>
            Browse...
          </button>
          {srcPath && <span style={{ fontSize: 11, opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 250 }}>{srcPath.split('/').pop()}</span>}
        </div>

        {previewUrl && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 8, background: 'var(--bg-deep)' }}>
            <img src={previewUrl} alt="preview" style={{ maxWidth: 128, maxHeight: 128, imageRendering: 'pixelated' }} />
          </div>
        )}

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          Name
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Building name" />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          Type
          <select style={inputStyle} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="shop">Shop</option>
            <option value="office">Office</option>
            <option value="apartment">Apartment</option>
            <option value="house">House</option>
            <option value="landmark">Landmark</option>
            <option value="other">Other</option>
          </select>
        </label>

        {(catalog.categories || []).length > 0 && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            Category
            <select style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Uncategorized</option>
              {(catalog.categories || []).map(c => (
                <option key={c.id} value={c.id}>{c.parentId ? '  ' : ''}{c.name}</option>
              ))}
            </select>
          </label>
        )}

        <div style={{ display: 'flex', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
            Footprint W (tiles)
            <input style={inputStyle} type="number" min={1} max={16} value={footprintW} onChange={(e) => setFootprintW(Math.max(1, parseInt(e.target.value) || 1))} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
            Footprint H (tiles)
            <input style={inputStyle} type="number" min={1} max={16} value={footprintH} onChange={(e) => setFootprintH(Math.max(1, parseInt(e.target.value) || 1))} />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button style={btnStyle} onClick={onClose}>
            Cancel
          </button>
          <button
            style={{ ...btnStyle, background: srcPath && name ? 'rgba(90, 140, 255, 0.25)' : 'rgba(255,255,255,0.04)', color: srcPath && name ? '#aaccff' : 'rgba(255,255,255,0.3)' }}
            onClick={handleImport}
            disabled={!srcPath || !name || importing}
          >
            {importing ? 'Importing...' : 'Add to Catalog'}
          </button>
        </div>
      </div>
    </div>
  )
}
