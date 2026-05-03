import { useState, useCallback } from 'react'
import type { ThemeName } from '../settings.js'
import { applyTheme, loadPixelCitySettings, savePixelCitySettings } from '../settings.js'
import { platform } from '../platform/index.js'

export function useUserTheme() {
  const [theme, setThemeState] = useState<ThemeName | null>(() => {
    const saved = loadPixelCitySettings().theme ?? null
    if (saved) applyTheme(saved)
    return saved
  })

  const setTheme = useCallback((newTheme: ThemeName) => {
    setThemeState(newTheme)
    applyTheme(newTheme)
    savePixelCitySettings({ theme: newTheme })
    platform().settings.update({ theme: newTheme })
    window.dispatchEvent(new CustomEvent('pixelcity:theme-changed', { detail: { theme: newTheme } }))
  }, [])

  return { theme, loading: false, setTheme }
}
