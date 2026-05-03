/**
 * Messaging module entry point.
 *
 * Exports a singleton MessageStore instance. The consuming app
 * calls setMessageStore() at startup to provide the implementation
 * (RtdbMessageStore, InMemoryMessageStore, etc.)
 */

import { InMemoryMessageStore } from './inMemoryMessageStore.js'
import type { MessageStore } from './types.js'

let store: MessageStore | null = null

export function getMessageStore(): MessageStore {
  if (!store) store = new InMemoryMessageStore()
  return store
}

export function setMessageStore(s: MessageStore): void {
  store = s
}

export type { AgentMessage, MessageQuery, MessageStore } from './types.js'
export { InMemoryMessageStore } from './inMemoryMessageStore.js'
