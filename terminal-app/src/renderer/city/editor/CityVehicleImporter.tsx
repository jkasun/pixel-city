import { useState } from 'react'
import type { CityVehicleDef, VehicleDirection, CityBuildingCatalog } from '@pixel-city/shared/city/editor/cityLayoutTypes'
import { VEHICLE_DEFAULT_SPEED_MIN, VEHICLE_DEFAULT_SPEED_MAX } from '@pixel-city/shared/constants'
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
  minWidth: 400,
  maxWidth: 520,
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

const DIRECTIONS: { key: VehicleDirection; label: string }[] = [
  { key: 'down', label: 'Down' },
  { key: 'up', label: 'Up' },
  { key: 'left', label: 'Left' },
  { key: 'right', label: 'Right' },
]

interface CityVehicleImporterProps {
  projectCwd: string | null
  catalog: CityBuildingCatalog
  onClose: () => void
  onImport: (def: CityVehicleDef, destPaths: Record<VehicleDirection, string>) => void
}

export function CityVehicleImporter({ projectCwd, catalog, onClose, onImport }: CityVehicleImporterProps) {
  const [name, setName] = useState('')
  const [tileLrW, setTileLrW] = useState(1.5)
  const [tileLrH, setTileLrH] = useState(0.5)
  const [tileUdW, setTileUdW] = useState(0.5)
  const [tileUdH, setTileUdH] = useState(1.5)
  const [speedMin, setSpeedMin] = useState(VEHICLE_DEFAULT_SPEED_MIN)
  const [speedMax, setSpeedMax] = useState(VEHICLE_DEFAULT_SPEED_MAX)
  const [category, setCategory] = useState('')
  const [mirrorLR, setMirrorLR] = useState(true)
  const [sprites, setSprites] = useState<Record<VehicleDirection, { path: string; preview: string; w: number; h: number } | null>>({
    down: null, up: null, left: null, right: null,
  })
  const [importing, setImporting] = useState(false)

  async function handleBrowse(dir: VehicleDirection) {
    const filePath = await platform().dialog.openFile({
      filters: [{ name: 'Images', extensions: ['png'] }],
      title: `Select ${dir} sprite`,
    })
    if (!filePath) return

    const fs = window.require('fs')
    try {
      const data = fs.readFileSync(filePath)
      const base64 = data.toString('base64')
      const dataUrl = `data:image/png;base64,${base64}`

      const img = new Image()
      img.onload = () => {
        setSprites((prev) => {
          const updated = { ...prev, [dir]: { path: filePath, preview: dataUrl, w: img.width, h: img.height } }
          // Auto-fill mirrored direction
          if (mirrorLR) {
            if (dir === 'left') updated.right = { path: filePath, preview: dataUrl, w: img.width, h: img.height }
            if (dir === 'right') updated.left = { path: filePath, preview: dataUrl, w: img.width, h: img.height }
          }
          return updated
        })
      }
      img.src = dataUrl
    } catch { /* ignore */ }

    if (!name) {
      const fileName = filePath.split('/').pop()?.replace(/\.png$/i, '').replace(/[-_](down|up|left|right)$/i, '') || ''
      setName(fileName)
    }
  }

  // When mirrorLR is toggled on, sync sprites
  function handleMirrorLRToggle(checked: boolean) {
    setMirrorLR(checked)
    if (checked) {
      setSprites((prev) => {
        const updated = { ...prev }
        if (prev.left && !prev.right) updated.right = { ...prev.left }
        else if (prev.right && !prev.left) updated.left = { ...prev.right }
        return updated
      })
    }
  }

  const visibleDirections = mirrorLR
    ? DIRECTIONS.filter((d) => d.key !== 'right')
    : DIRECTIONS

  const allSpritesSet = DIRECTIONS.every((d) => sprites[d.key] !== null)

  async function handleImport() {
    if (!allSpritesSet || !name || importing) return
    setImporting(true)
    try {
      const files: Record<string, string> = {}
      const destPaths: Record<string, string> = {}

      for (const d of DIRECTIONS) {
        // For mirrorLR, right reuses left's file
        if (mirrorLR && d.key === 'right') {
          files['right'] = files['left']
          destPaths['right'] = destPaths['left']
          continue
        }
        const s = sprites[d.key]!
        const result = await ipcRenderer.invoke('city-import-vehicle-sprite', {
          srcPath: s.path,
          direction: d.key,
          projectDir: projectCwd,
        })
        if (!result.success) return
        files[d.key] = result.fileName
        destPaths[d.key] = result.destPath
      }

      const firstSprite = sprites.down!
      const def: CityVehicleDef = {
        id: `vehicle_${Date.now()}`,
        name,
        files: files as Record<VehicleDirection, string>,
        pixelW: firstSprite.w,
        pixelH: firstSprite.h,
        tileLrW,
        tileLrH,
        tileUdW,
        tileUdH,
        speedMin,
        speedMax,
        mirrorLR: mirrorLR || undefined,
        category: category || undefined,
      }
      onImport(def, destPaths as Record<VehicleDirection, string>)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Import Vehicle</div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          Name
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Vehicle name" />
        </label>

        {/* Mirror toggle */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={mirrorLR}
            onChange={(e) => handleMirrorLRToggle(e.target.checked)}
            style={{ accentColor: '#5a8cff' }}
          />
          <span style={{ fontSize: 12 }}>Mirror Left → Right (use one sprite for both)</span>
        </label>

        {/* Directional sprites */}
        <div style={{ fontSize: 12, fontWeight: 500 }}>
          Sprites ({mirrorLR ? '3 directions — Right is mirrored from Left' : '4 directions'})
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: mirrorLR ? '1fr 1fr 1fr' : '1fr 1fr', gap: 8 }}>
          {visibleDirections.map((d) => {
            const sprite = sprites[d.key]
            return (
              <div key={d.key} style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                <div style={{ fontSize: 11, opacity: 0.6 }}>{d.label}</div>
                {sprite ? (
                  <img
                    src={sprite.preview}
                    alt={d.label}
                    style={{ width: 40, height: 40, imageRendering: 'pixelated', objectFit: 'contain', background: 'var(--bg-deep)' }}
                  />
                ) : (
                  <div style={{ width: 40, height: 40, background: 'var(--bg-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, opacity: 0.3 }}>
                    —
                  </div>
                )}
                <button style={{ ...btnStyle, fontSize: 10, padding: '2px 8px' }} onClick={() => handleBrowse(d.key)}>
                  {sprite ? 'Change' : 'Browse...'}
                </button>
              </div>
            )
          })}
          {/* Show mirrored preview for right when mirrorLR is on */}
          {mirrorLR && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
              <div style={{ fontSize: 11, opacity: 0.6 }}>Right (mirrored)</div>
              {sprites.left ? (
                <img
                  src={sprites.left.preview}
                  alt="Right (mirrored)"
                  style={{ width: 40, height: 40, imageRendering: 'pixelated', objectFit: 'contain', background: 'var(--bg-deep)', transform: 'scaleX(-1)' }}
                />
              ) : (
                <div style={{ width: 40, height: 40, background: 'var(--bg-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, opacity: 0.3 }}>
                  —
                </div>
              )}
              <span style={{ fontSize: 9, opacity: 0.4 }}>auto</span>
            </div>
          )}
        </div>

        {/* Size — Left/Right */}
        <div style={{ fontSize: 11, opacity: 0.6, marginBottom: -6 }}>Left / Right size (tiles)</div>
        <div style={{ display: 'flex', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
            W
            <input style={inputStyle} type="number" min={0.1} max={8} step={0.1} value={tileLrW} onChange={(e) => setTileLrW(Math.max(0.1, parseFloat(e.target.value) || 0.1))} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
            H
            <input style={inputStyle} type="number" min={0.1} max={8} step={0.1} value={tileLrH} onChange={(e) => setTileLrH(Math.max(0.1, parseFloat(e.target.value) || 0.1))} />
          </label>
        </div>

        {/* Size — Up/Down */}
        <div style={{ fontSize: 11, opacity: 0.6, marginBottom: -6 }}>Up / Down size (tiles)</div>
        <div style={{ display: 'flex', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
            W
            <input style={inputStyle} type="number" min={0.1} max={8} step={0.1} value={tileUdW} onChange={(e) => setTileUdW(Math.max(0.1, parseFloat(e.target.value) || 0.1))} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
            H
            <input style={inputStyle} type="number" min={0.1} max={8} step={0.1} value={tileUdH} onChange={(e) => setTileUdH(Math.max(0.1, parseFloat(e.target.value) || 0.1))} />
          </label>
        </div>

        {/* Speed */}
        <div style={{ display: 'flex', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
            Min Speed (tiles/s)
            <input style={inputStyle} type="number" min={0.5} max={10} step={0.5} value={speedMin} onChange={(e) => setSpeedMin(parseFloat(e.target.value) || 1)} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
            Max Speed (tiles/s)
            <input style={inputStyle} type="number" min={0.5} max={10} step={0.5} value={speedMax} onChange={(e) => setSpeedMax(parseFloat(e.target.value) || 2)} />
          </label>
        </div>

        {/* Category */}
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

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button style={btnStyle} onClick={onClose}>Cancel</button>
          <button
            style={{
              ...btnStyle,
              background: allSpritesSet && name ? 'rgba(90, 140, 255, 0.25)' : 'rgba(255,255,255,0.04)',
              color: allSpritesSet && name ? '#aaccff' : 'rgba(255,255,255,0.3)',
            }}
            onClick={handleImport}
            disabled={!allSpritesSet || !name || importing}
          >
            {importing ? 'Importing...' : 'Add Vehicle'}
          </button>
        </div>
      </div>
    </div>
  )
}
