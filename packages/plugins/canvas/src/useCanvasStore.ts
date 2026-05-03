// useCanvasStore — L2 Sync Layer
// Thin React hook bridging the pure-TS CanvasStore to React via useSyncExternalStore.

import { useSyncExternalStore } from 'react'
import { getCanvasStore } from './store.js'
import type { CanvasContent } from './store.js'

export function useCanvasStore(): ReadonlyMap<string, CanvasContent> {
  const store = getCanvasStore()
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
