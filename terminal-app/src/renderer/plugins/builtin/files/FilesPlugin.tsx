// ── Files Plugin — uses shared @pixel-city/plugin-files ─────────────

import React, { useEffect, useState } from 'react'
import { FilesView, MonacoConfigProvider } from '@pixel-city/plugin-files/components'
import { setFilesAdapter } from '@pixel-city/plugin-files'
import type { MonacoConfig } from '@pixel-city/plugin-files/components'
import { terminalFilesAdapter } from '../../../platform/filesAdapter.js'
// Register custom Monaco themes before EditorPanel mounts
import '../../../platform/monacoThemes.js'
import type { PluginProps } from '../../types.js'
import { useWorldContext } from '../../../contexts/WorldContext.js'
import { loadPixelCitySettings } from '../../../settings.js'
import type { ThemeName } from '../../../settings.js'

// Register the adapter once at module load
setFilesAdapter(terminalFilesAdapter)

function monacoTheme(t: ThemeName): string {
  if (t === 'dark') return 'vs-dark'
  if (t === 'creme') return 'pixelcity-creme'
  if (t === 'nord') return 'pixelcity-nord'
  if (t === 'monokai') return 'pixelcity-monokai'
  return 'vs'
}

export function FilesPlugin({ host }: PluginProps) {
  const { editorSettings } = useWorldContext()
  const [currentTheme, setCurrentTheme] = useState(() => monacoTheme(loadPixelCitySettings().theme ?? 'dark'))

  useEffect(() => {
    const handler = (e: Event) => setCurrentTheme(monacoTheme((e as CustomEvent).detail?.theme ?? 'dark'))
    window.addEventListener('pixelcity:theme-changed', handler)
    return () => window.removeEventListener('pixelcity:theme-changed', handler)
  }, [])

  if (!host.projectCwd) return null

  const monacoConfig: MonacoConfig = {
    ready: true,
    currentTheme,
  }

  return (
    <MonacoConfigProvider config={monacoConfig}>
      <FilesView
        key={host.projectCwd}
        projectCwd={host.projectCwd}
        editorSettings={editorSettings}
      />
    </MonacoConfigProvider>
  )
}
