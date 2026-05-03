// ── Plugin Event Bus ─────────────────────────────────────────────────
// Typed pub/sub replacing ad-hoc window.dispatchEvent(new CustomEvent(...))
// calls. Plugins subscribe via host.on() and emit via host.emit().

import type { PluginEvent } from './types.js'

type Listener = (...args: any[]) => void

export class PluginEventBus {
  private listeners = new Map<PluginEvent, Set<Listener>>()

  /** Subscribe to an event. Returns an unsubscribe function. */
  on(event: PluginEvent, callback: Listener): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(callback)
    return () => {
      this.listeners.get(event)?.delete(callback)
    }
  }

  /** Emit an event to all subscribers. Errors in handlers are caught and logged. */
  emit(event: PluginEvent, ...args: any[]): void {
    this.listeners.get(event)?.forEach(cb => {
      try {
        cb(...args)
      } catch (e) {
        console.error(`[PluginEventBus] Error in "${event}" handler:`, e)
      }
    })
  }

  /** Remove all listeners (used during teardown). */
  removeAll(): void {
    this.listeners.clear()
  }
}
