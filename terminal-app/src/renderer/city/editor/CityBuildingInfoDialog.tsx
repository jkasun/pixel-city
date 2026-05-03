import { useState, useRef, useEffect, useMemo } from 'react'
import { platform } from '../../platform/index.js'
import { slugifyHandle, validateHandle } from '@pixel-city/shared/utils/agentAddress'

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
  minWidth: 320,
  maxWidth: 400,
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
  width: '100%',
  boxSizing: 'border-box',
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

interface CityBuildingInfoDialogProps {
  buildingDefName: string
  takenHandles?: ReadonlySet<string>
  onConfirm: (title: string, description: string, workingDir: string, handle: string) => void
  onCancel: () => void
}

export function CityBuildingInfoDialog({ buildingDefName, takenHandles, onConfirm, onCancel }: CityBuildingInfoDialogProps) {
  const [title, setTitle] = useState(buildingDefName)
  const [description, setDescription] = useState('')
  const [workingDir, setWorkingDir] = useState('')
  const [handle, setHandle] = useState(() => slugifyHandle(buildingDefName))
  const [handleTouched, setHandleTouched] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
    titleRef.current?.select()
  }, [])

  useEffect(() => {
    if (!handleTouched) setHandle(slugifyHandle(title))
  }, [title, handleTouched])

  const handleValidation = useMemo(() => {
    const v = validateHandle(handle)
    if (!v.ok) return v
    if (takenHandles?.has(handle)) return { ok: false as const, reason: 'Handle already in use by another building' }
    return { ok: true as const }
  }, [handle, takenHandles])

  const handleBrowseDir = async () => {
    const folder = await platform().dialog.openFolder()
    if (folder) setWorkingDir(folder)
  }

  const canSubmit = !!title.trim() && handleValidation.ok

  const handleSubmit = () => {
    if (!canSubmit) return
    onConfirm(title.trim(), description.trim(), workingDir.trim(), handle.trim())
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  const handleFieldError = handleTouched && !handleValidation.ok ? handleValidation.reason : null

  return (
    <div style={overlayStyle} onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div style={panelStyle} onKeyDown={handleKeyDown}>
        <div style={{ fontWeight: 'bold', fontSize: 14, color: '#eae7e0' }}>Building Details</div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Title</span>
          <input
            ref={titleRef}
            style={inputStyle}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Building name..."
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Handle</span>
          <input
            style={inputStyle}
            value={handle}
            onChange={(e) => { setHandleTouched(true); setHandle(e.target.value) }}
            onBlur={() => setHandleTouched(true)}
            placeholder="e.g. myproject"
          />
          <span style={{ fontSize: 11, color: handleFieldError ? '#ff6a6a' : 'rgba(255,255,255,0.35)' }}>
            {handleFieldError ?? 'Lowercase letters, numbers, dashes. Used in agent addresses.'}
          </span>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Description <span style={{ color: 'rgba(255,255,255,0.35)' }}>(optional)</span></span>
          <textarea
            style={{ ...inputStyle, minHeight: 60, resize: 'vertical', fontFamily: 'inherit' }}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this building?"
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Working Directory <span style={{ color: 'rgba(255,255,255,0.35)' }}>(optional)</span></span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              value={workingDir}
              onChange={(e) => setWorkingDir(e.target.value)}
              placeholder="Select a folder..."
              readOnly
            />
            <button style={{ ...btnStyle, whiteSpace: 'nowrap' }} onClick={handleBrowseDir}>
              Browse
            </button>
          </div>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
            Saved locally on this machine. Agents in this building will work here.
          </span>
        </label>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button style={btnStyle} onClick={onCancel}>Cancel</button>
          <button
            style={{ ...btnStyle, background: canSubmit ? 'rgba(90, 140, 255, 0.3)' : 'rgba(255,255,255,0.04)', border: canSubmit ? '1px solid rgba(90, 140, 255, 0.5)' : '1px solid rgba(255,255,255,0.2)', color: canSubmit ? '#aaccff' : 'rgba(255,255,255,0.3)' }}
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            Place Building
          </button>
        </div>
      </div>
    </div>
  )
}
