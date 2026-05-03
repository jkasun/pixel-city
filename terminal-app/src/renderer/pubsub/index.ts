/**
 * PubSub module entry point.
 *
 * Provides a singleton WebSocket-backed transport configured via config.yml.
 */

import { WsTransport } from './wsTransport'
import { config } from '../../config'
import type { PubSubTransport } from './types'

let transport: PubSubTransport | null = null

/** Create a transport from the central config. */
function createTransport(): PubSubTransport {
  return new WsTransport(config.pubsub.ws.url)
}

/** Get or create the singleton transport. Auto-connects on first call. */
export async function getTransport(): Promise<PubSubTransport> {
  if (transport) return transport
  transport = createTransport()
  await transport.connect()
  return transport
}

/** Get or create the transport synchronously — kicks off connect() in the background.
 * Safe to use immediately: IPC-backed store methods don't need the socket open.
 * Pubsub subscriptions queue up in pendingSubscriptions and flush on open. */
export function getOrCreateTransport(): PubSubTransport {
  if (!transport) {
    transport = createTransport()
    transport.connect() // fire-and-forget — resolves when socket opens or 5s timeout
  }
  return transport
}

/** Get the transport synchronously (returns null if not yet initialized). */
export function getTransportSync(): PubSubTransport | null {
  return transport
}

/** Tear down and recreate the transport (e.g., after config change). */
export async function resetTransport(): Promise<PubSubTransport> {
  if (transport) {
    transport.dispose()
    transport = null
  }
  return getTransport()
}

export type { PubSubTransport, PubSubConfig, MessageHandler } from './types'
export { DEFAULT_PUBSUB_CONFIG } from './types'
export { WsTransport } from './wsTransport'
