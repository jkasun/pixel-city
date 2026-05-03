/**
 * POSIX-only path utilities for the shared files plugin.
 *
 * Both platforms (terminal-app in Docker/Mac and web-app targeting Docker)
 * use forward-slash paths. This module replaces Node.js `path` with a
 * minimal set of pure functions that work in any JS environment.
 */

export const sep = '/'

export function join(...segments: string[]): string {
  const parts: string[] = []
  for (const seg of segments) {
    for (const part of seg.split('/')) {
      if (part === '..') {
        parts.pop()
      } else if (part && part !== '.') {
        parts.push(part)
      }
    }
  }
  const result = parts.join('/')
  // Preserve leading slash if the first segment was absolute
  return segments[0]?.startsWith('/') ? '/' + result : result
}

export function dirname(filePath: string): string {
  const idx = filePath.lastIndexOf('/')
  if (idx <= 0) return filePath.startsWith('/') ? '/' : '.'
  return filePath.substring(0, idx)
}

export function basename(filePath: string, ext?: string): string {
  const name = filePath.substring(filePath.lastIndexOf('/') + 1)
  if (ext && name.endsWith(ext)) return name.slice(0, -ext.length)
  return name
}

export function extname(filePath: string): string {
  const name = basename(filePath)
  const idx = name.lastIndexOf('.')
  return idx > 0 ? name.substring(idx) : ''
}

export function relative(from: string, to: string): string {
  const fromParts = from.split('/').filter(Boolean)
  const toParts = to.split('/').filter(Boolean)

  let common = 0
  while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) {
    common++
  }

  const ups = fromParts.length - common
  const rest = toParts.slice(common)
  return [...Array(ups).fill('..'), ...rest].join('/') || '.'
}

export function isAbsolute(filePath: string): boolean {
  return filePath.startsWith('/')
}

export function resolve(...segments: string[]): string {
  let resolved = ''
  for (let i = segments.length - 1; i >= 0; i--) {
    resolved = segments[i] + (resolved ? '/' + resolved : '')
    if (segments[i].startsWith('/')) break
  }
  return join(resolved)
}
