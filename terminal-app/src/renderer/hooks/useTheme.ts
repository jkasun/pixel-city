/**
 * useTheme — Centralized theme management hook.
 *
 * Provides theme state, switching, and helpers for all components.
 * This is the single source of truth for theme across the app.
 */

import { useState, useCallback, useEffect } from 'react'
import type { ThemeName } from '../settings.js'
import {
  applyTheme,
  getTerminalTheme,
  loadPixelCitySettings,
  savePixelCitySettings,
} from '../settings.js'
import type { ITheme } from '@xterm/xterm'

import { platform } from '../platform/index.js'

/** CSS variable names exposed by the theme system */
export type ThemeToken =
  | 'bg' | 'bg-card' | 'bg-hover' | 'bg-deep' | 'bg-popup' | 'bg-input'
  | 'text' | 'text-dim' | 'text-muted' | 'text-bright'
  | 'accent' | 'accent-dim'
  | 'border' | 'border-subtle'

/** Read the current value of a CSS theme variable */
export function getThemeVar(token: ThemeToken): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--${token}`).trim()
}

/** Get the current theme name from persisted settings */
export function getCurrentTheme(): ThemeName {
  return loadPixelCitySettings().theme ?? 'dark'
}

/** Get the terminal (xterm) theme object for the current theme */
export function getCurrentTerminalTheme(): ITheme {
  return getTerminalTheme(getCurrentTheme())
}

export interface UseThemeReturn {
  /** Current theme name */
  theme: ThemeName
  /** Switch to a new theme — applies CSS, persists, and broadcasts via IPC */
  setTheme: (theme: ThemeName) => void
  /** Get the xterm ITheme for the current theme */
  terminalTheme: ITheme
  /** Whether the current theme is a light variant (light or creme) */
  isLight: boolean
}

/**
 * Hook for components that need to read or change the theme.
 * Listens for cross-window theme changes via IPC.
 */
export function useTheme(): UseThemeReturn {
  const [theme, setThemeState] = useState<ThemeName>(getCurrentTheme)

  const setTheme = useCallback((newTheme: ThemeName) => {
    setThemeState(newTheme)
    applyTheme(newTheme)
    savePixelCitySettings({ theme: newTheme })
    platform().settings.update({ theme: newTheme })
  }, [])

  // Listen for theme changes from other windows / IPC
  useEffect(() => {
    const handler = (data: Record<string, unknown>) => {
      if (data.theme) {
        setThemeState(data.theme as ThemeName)
        applyTheme(data.theme as ThemeName)
      }
    }
    return platform().settings.onChange(handler)
  }, [])

  return {
    theme,
    setTheme,
    terminalTheme: getTerminalTheme(theme),
    isLight: theme === 'light' || theme === 'creme',
  }
}
