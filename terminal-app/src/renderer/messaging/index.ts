/**
 * Messaging module — terminal-app entry point.
 *
 * Wires the renderer messaging UI to the main-process IPC store and a
 * local WebSocket pubsub transport for real-time event notifications.
 */

import {
  getMessageStore as _get,
  setMessageStore,
} from '@pixel-city/plugin-messages'
import { PubSubMessageStore } from './pubsubMessageStore.js'
import { getOrCreateTransport } from '../pubsub/index.js'
import type { MessageStore } from '@pixel-city/plugin-messages'

// Set the IPC-backed store synchronously at module load time.
// PubSubMessageStore.query/send/markRead all delegate to ipcRenderer.invoke() —
// they don't need the transport socket to be open. The transport is only used
// for pubsub event notifications (real-time UI refresh after messages arrive).
// getOrCreateTransport() starts the connection in the background; subscriptions
// queue up and flush once the socket opens (~100ms for a local WS).
setMessageStore(new PubSubMessageStore(getOrCreateTransport()))

export function getMessageStore(): MessageStore {
  return _get()
}

export { setMessageStore }
export type { AgentMessage, MessageQuery, MessageStore } from '@pixel-city/plugin-messages'
