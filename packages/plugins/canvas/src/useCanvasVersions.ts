// useCanvasVersions — L2 Sync Layer
// Thin React hook bridging CanvasStore version history to React via useSyncExternalStore.

import { useSyncExternalStore } from 'react'
import { getCanvasStore } from './store.js'
import type { CanvasVersion } from './store.js'

export function useCanvasVersions(agentId: string | null): readonly CanvasVersion[] {
  const store = getCanvasStore()
  return useSyncExternalStore(
    store.subscribe,
    () => store.getVersions(agentId),
  )
}
