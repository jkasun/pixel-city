/**
 * Office module entry point.
 *
 * Exports a singleton OfficeStore instance. The consuming app
 * calls setOfficeStore() at startup to provide the implementation.
 */

import type { OfficeStore } from './types.js'

let store: OfficeStore | null = null

export function getOfficeStore(): OfficeStore {
  if (!store) throw new Error('[plugin-office] No OfficeStore set — call setOfficeStore() at startup')
  return store
}

export function setOfficeStore(s: OfficeStore): void {
  store = s
}

export type { OfficeStore, OfficeAgent } from './types.js'
