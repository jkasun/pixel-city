/**
 * WakeAnimationQueue — pure rate-limited queue for wake/sleep transitions.
 *
 * Enqueue events with a synchronous `buildAtomic()` closure that performs the
 * visual handoff (e.g. remove-ghost + create-live-character) when the queue
 * worker pops the event. Rate-limited to MIN_STAGGER_MS between dispatches so
 * large offices don't wake all ghosts in lockstep.
 *
 * Invariants:
 *  - FIFO by enqueue time.
 *  - Dedupe by permId (last-write-wins): enqueueing an event with a permId
 *    already in the queue replaces the prior event, keeping FIFO position.
 *  - Reduced-motion: queue drains all pending events on the next tick with
 *    zero stagger.
 *  - `buildAtomic()` MUST be synchronous — async work would let ticks interleave.
 */
export type WakeKind = 'wake' | 'sleep'

export interface WakeEvent {
  kind: WakeKind
  permId: string
  /** Synchronous atomic payload — mutates OfficeState at dispatch time. */
  buildAtomic: () => void
}

export interface WakeAnimationQueueOptions {
  /** Minimum ms between dispatches. Default 250. */
  minStaggerMs?: number
  /** When true, drain skips stagger. Default false. */
  reducedMotion?: boolean
  /** Clock override for tests (returns ms). Default Date.now. */
  now?: () => number
}

const DEFAULT_MIN_STAGGER_MS = 250

export class WakeAnimationQueue {
  private queue: WakeEvent[] = []
  private lastDispatchMs = -Infinity
  private minStaggerMs: number
  private reducedMotion: boolean
  private now: () => number

  constructor(opts: WakeAnimationQueueOptions = {}) {
    this.minStaggerMs = opts.minStaggerMs ?? DEFAULT_MIN_STAGGER_MS
    this.reducedMotion = opts.reducedMotion ?? false
    this.now = opts.now ?? (() => Date.now())
  }

  setReducedMotion(v: boolean): void {
    this.reducedMotion = v
  }

  /** Dedupe-by-permId, preserves FIFO position of first insert. */
  enqueue(event: WakeEvent): void {
    const existingIdx = this.queue.findIndex((e) => e.permId === event.permId)
    if (existingIdx !== -1) {
      this.queue[existingIdx] = event
      return
    }
    this.queue.push(event)
  }

  /** Advance. Dispatches eligible events (all of them if reducedMotion). */
  tick(): void {
    if (this.queue.length === 0) return
    if (this.reducedMotion) {
      while (this.queue.length > 0) {
        const ev = this.queue.shift()!
        ev.buildAtomic()
      }
      this.lastDispatchMs = this.now()
      return
    }
    const nowMs = this.now()
    while (this.queue.length > 0 && nowMs - this.lastDispatchMs >= this.minStaggerMs) {
      const ev = this.queue.shift()!
      ev.buildAtomic()
      this.lastDispatchMs = nowMs
      // One dispatch per tick unless reducedMotion — next dispatch waits minStaggerMs.
      break
    }
  }

  /** Flush all pending events synchronously. Tests + reduced-motion fallback. */
  drain(): void {
    while (this.queue.length > 0) {
      const ev = this.queue.shift()!
      ev.buildAtomic()
    }
    this.lastDispatchMs = this.now()
  }

  size(): number {
    return this.queue.length
  }

  /** For tests: peek pending permIds in FIFO order. */
  peekPermIds(): string[] {
    return this.queue.map((e) => e.permId)
  }
}

/**
 * Stable deterministic hash for glyph phase seeding. djb2 variant — ~5 lines,
 * engine-stable, no async/crypto dependency. Output in [0, 1).
 *
 * Do NOT replace with crypto.subtle — it's async and defeats the point.
 */
export function hashToUnit(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return ((h >>> 0) % 100000) / 100000
}
