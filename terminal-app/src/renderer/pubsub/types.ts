/**
 * PubSub transport abstraction.
 *
 * Provides a unified publish/subscribe interface backed by a local
 * WebSocket pubsub server.
 */

export interface PubSubMessage {
  topic: string
  payload: string
  retain?: boolean
}

export type MessageHandler = (topic: string, payload: string) => void

export interface PubSubTransport {
  /** Connect to the broker/server. Resolves when connected or after timeout. */
  connect(): Promise<void>

  /** Publish a message to a topic. */
  publish(topic: string, payload: string, options?: { retain?: boolean }): void

  /** Subscribe to a topic pattern (supports wildcards like `foo/#`). */
  subscribe(pattern: string): void

  /** Unsubscribe from a topic pattern. */
  unsubscribe(pattern: string): void

  /** Register a handler for incoming messages. Returns unsubscribe fn. */
  onMessage(handler: MessageHandler): () => void

  /** Whether the transport is currently connected. */
  readonly connected: boolean

  /** Disconnect and clean up. */
  dispose(): void
}

/** Configuration for the pubsub transport. */
export interface PubSubConfig {
  ws: {
    /** WebSocket server URL (default: ws://localhost:19850) */
    url: string
  }
}

export const DEFAULT_PUBSUB_CONFIG: PubSubConfig = {
  ws: {
    url: 'ws://localhost:19850',
  },
}
