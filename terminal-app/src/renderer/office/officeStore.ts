/**
 * Office store module — terminal-app entry point.
 *
 * Re-exports the plugin's store API, backed by the local SQLite/IPC
 * implementation in layoutDbLocal.
 */

import { setOfficeStore } from '@pixel-city/plugin-office'
import type { OfficeStore } from '@pixel-city/plugin-office'
import { loadLayoutFromRtdb } from './layoutDbLocal.js'

class RtdbOfficeStore implements OfficeStore {
  async loadLayout(buildingId: string, floorId = 'floor-0') {
    const result = await loadLayoutFromRtdb(`${buildingId}--${floorId}`)
    return result.found && result.data ? result.data : null
  }
}

setOfficeStore(new RtdbOfficeStore())

export { setOfficeStore }
