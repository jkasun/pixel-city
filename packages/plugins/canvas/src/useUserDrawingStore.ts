// useUserDrawingStore — L2 Sync Layer
// Thin React hook bridging UserDrawingStore to React via useSyncExternalStore.

import { useSyncExternalStore } from 'react'
import { getUserDrawingStore } from './userDrawingStore.js'
import type { UserDrawingSnapshot } from './userDrawingStore.js'

export function useUserDrawingStore(): ReadonlyMap<string, UserDrawingSnapshot> {
  const store = getUserDrawingStore()
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
