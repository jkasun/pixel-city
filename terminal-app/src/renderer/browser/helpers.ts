import type { ConsoleEntry } from './types.js'

export const DEFAULT_URL = 'https://www.google.com'

export const PALETTE_COLORS = [
  '#5ac88c', '#6b8fb5', '#c97b7b', '#c4894a',
  '#a07bb5', '#6ba5a0', '#b5a06b', '#8b8b8b',
]

export function paletteColor(p: number): string {
  return PALETTE_COLORS[p % PALETTE_COLORS.length]
}

// Electron console-message event levels: 0=verbose, 1=info, 2=warning, 3=error
export const LEVEL_MAP: Record<number, ConsoleEntry['level']> = {
  0: 'debug',
  1: 'log',
  2: 'warn',
  3: 'error',
}

export function resolveUrl(input: string): string {
  let finalUrl = input.trim()
  if (!finalUrl) return ''
  // Allow file:// and other known protocols through as-is
  if (/^(https?|file|data|blob):\/\//i.test(finalUrl)) return finalUrl
  if (/\s/.test(finalUrl) || !finalUrl.includes('.')) {
    finalUrl = 'https://www.google.com/search?q=' + encodeURIComponent(finalUrl)
  } else {
    finalUrl = 'https://' + finalUrl
  }
  return finalUrl
}
