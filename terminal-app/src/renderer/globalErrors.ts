// Global error store for unhandled errors and promise rejections.
// Single module-level instance — listeners are installed once in main.tsx
// and the banner subscribes from React. Bounded to MAX_ENTRIES to prevent leaks.

import { log } from './logger'

export interface GlobalErrorEntry {
  id: number
  source: 'error' | 'unhandledrejection'
  message: string
  stack?: string
  at: number
}

const MAX_ENTRIES = 20
let nextId = 1
let entries: GlobalErrorEntry[] = []
const listeners = new Set<(entries: GlobalErrorEntry[]) => void>()

function emit() {
  for (const l of listeners) l(entries)
}

export function subscribeGlobalErrors(listener: (entries: GlobalErrorEntry[]) => void): () => void {
  listeners.add(listener)
  listener(entries)
  return () => { listeners.delete(listener) }
}

export function dismissGlobalError(id: number) {
  const next = entries.filter(e => e.id !== id)
  if (next.length === entries.length) return
  entries = next
  emit()
}

export function clearGlobalErrors() {
  if (entries.length === 0) return
  entries = []
  emit()
}

function push(entry: Omit<GlobalErrorEntry, 'id' | 'at'>) {
  const full: GlobalErrorEntry = { ...entry, id: nextId++, at: Date.now() }
  entries = [...entries, full].slice(-MAX_ENTRIES)
  emit()
}

function messageFromReason(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) return { message: reason.message || String(reason), stack: reason.stack }
  if (typeof reason === 'string') return { message: reason }
  try { return { message: JSON.stringify(reason) } } catch { return { message: String(reason) } }
}

let installed = false
let errorHandler: ((ev: ErrorEvent) => void) | null = null
let rejectionHandler: ((ev: PromiseRejectionEvent) => void) | null = null

export function installGlobalErrorHandlers() {
  if (installed) return
  installed = true

  errorHandler = (ev: ErrorEvent) => {
    const err = ev.error
    if (err instanceof Error) {
      push({ source: 'error', message: err.message || ev.message || 'Unknown error', stack: err.stack })
    } else {
      push({ source: 'error', message: ev.message || 'Unknown error' })
    }
    log.error('window.onerror', ev.error || new Error(ev.message), { filename: ev.filename, lineno: ev.lineno, colno: ev.colno })
  }

  rejectionHandler = (ev: PromiseRejectionEvent) => {
    const info = messageFromReason(ev.reason)
    push({ source: 'unhandledrejection', message: info.message, stack: info.stack })
    log.error('unhandledrejection', ev.reason instanceof Error ? ev.reason : new Error(String(ev.reason)))
  }

  window.addEventListener('error', errorHandler)
  window.addEventListener('unhandledrejection', rejectionHandler)
}

export function uninstallGlobalErrorHandlers() {
  if (!installed) return
  if (errorHandler) window.removeEventListener('error', errorHandler)
  if (rejectionHandler) window.removeEventListener('unhandledrejection', rejectionHandler)
  errorHandler = null
  rejectionHandler = null
  installed = false
}
