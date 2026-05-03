// ── Dynamic Plugin Loader Hook ──────────────────────────────────────
// Subscribes to RTDB for the current building's dynamic plugins and
// registers/unregisters them in the plugin registry in real-time.

import { useEffect, useRef } from 'react'
import { subscribeDynamicPlugins } from './dynamicPluginDbLocal.js'
import { createDynamicPluginModule } from './createDynamicPluginModule.js'
import { pluginRegistry } from '../registry.js'

/**
 * Subscribe to dynamic plugins for the given building and keep the
 * plugin registry in sync. Call this from PluginPanel.
 */
export function useDynamicPlugins(buildingId: string | null): void {
  const prevIdsRef = useRef(new Set<string>())

  useEffect(() => {
    if (!buildingId) return

    const unsub = subscribeDynamicPlugins(buildingId, (records) => {
      const newIds = new Set(Object.keys(records))

      // Unregister plugins that were removed
      for (const id of prevIdsRef.current) {
        if (!newIds.has(id)) {
          pluginRegistry.unregister(id)
        }
      }

      // Register or update current plugins
      for (const [id, record] of Object.entries(records)) {
        pluginRegistry.register(createDynamicPluginModule(record, buildingId))
      }

      prevIdsRef.current = newIds
    })

    return () => {
      unsub()
      // Clean up: unregister all dynamic plugins for this building
      for (const id of prevIdsRef.current) {
        pluginRegistry.unregister(id)
      }
      prevIdsRef.current = new Set()
    }
  }, [buildingId])
}
