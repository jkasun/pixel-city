// DrawTab — L4 Component
// Embeds Excalidraw for user drawing. Per-building — one shared canvas per building.
// Persists scene snapshots to UserDrawingStore (L1) and exposes the API ref (L2).

import { useCallback, useEffect, useRef, useState } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from '@excalidraw/excalidraw/types'
import type { PluginHost } from '@pixel-city/core'
import { getUserDrawingStore } from '../userDrawingStore.js'
import { setDrawingEditor } from '../userDrawingEditorRef.js'

interface DrawTabProps {
  host: PluginHost
  visible: boolean
}

const SAVE_DEBOUNCE_MS = 400

// Themes that should render Excalidraw in light mode. Anything else → dark.
const LIGHT_THEMES = new Set(['light', 'creme'])

function readAppTheme(): 'light' | 'dark' {
  const t = document.documentElement.getAttribute('data-theme') ?? 'dark'
  return LIGHT_THEMES.has(t) ? 'light' : 'dark'
}

export function DrawTab({ host, visible }: DrawTabProps) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>(readAppTheme)
  const buildingId = host.buildingId
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const handler = () => setTheme(readAppTheme())
    window.addEventListener('pixelcity:theme-changed', handler)
    return () => window.removeEventListener('pixelcity:theme-changed', handler)
  }, [])

  const handleChange = useCallback(
    (elements: readonly unknown[], appState: unknown, files: unknown) => {
      if (!buildingId) return
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        getUserDrawingStore().set(buildingId, {
          elements,
          appState: { viewBackgroundColor: (appState as { viewBackgroundColor?: string })?.viewBackgroundColor ?? '#ffffff' },
          files,
        })
      }, SAVE_DEBOUNCE_MS)
    },
    [buildingId],
  )

  // Wire/unwire the L2 editor ref as visibility / api changes.
  useEffect(() => {
    if (visible && api) {
      setDrawingEditor(api)
    } else {
      setDrawingEditor(null)
    }
    return () => setDrawingEditor(null)
  }, [visible, api])

  // Flush any pending save when unmounting.
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  if (!visible) return null

  const existing = buildingId ? getUserDrawingStore().get(buildingId) : undefined
  const initialData = existing?.state as ExcalidrawInitialDataState | undefined

  return (
    <div className="flex flex-col flex-1 overflow-hidden" style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <Excalidraw
          excalidrawAPI={setApi}
          initialData={initialData}
          onChange={handleChange}
          theme={theme}
          autoFocus={false}
        />
      </div>
    </div>
  )
}
