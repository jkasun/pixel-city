// UserDrawingStore — L1 Domain Layer
// Pure TypeScript, ZERO React or DOM imports.
// Stores Excalidraw scene snapshots per building for the user's drawing board.

export interface UserDrawingSnapshot {
  /** Opaque Excalidraw scene snapshot — serializable JSON ({ elements, appState, files }) */
  state: unknown
  updatedAt: number
}

type Listener = () => void

export class UserDrawingStore {
  private drawings = new Map<string, UserDrawingSnapshot>()
  private listeners = new Set<Listener>()
  private snapshot: ReadonlyMap<string, UserDrawingSnapshot> = new Map()

  set(buildingId: string, state: unknown): void {
    this.drawings.set(buildingId, { state, updatedAt: Date.now() })
    this.updateSnapshot()
  }

  get(buildingId: string): UserDrawingSnapshot | undefined {
    return this.drawings.get(buildingId)
  }

  clear(buildingId: string): void {
    if (this.drawings.has(buildingId)) {
      this.drawings.delete(buildingId)
      this.updateSnapshot()
    }
  }

  // ── Snapshot & Subscribe ─────────────────────────────────────

  getSnapshot = (): ReadonlyMap<string, UserDrawingSnapshot> => {
    return this.snapshot
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private updateSnapshot(): void {
    this.snapshot = new Map(this.drawings)
    for (const listener of this.listeners) {
      listener()
    }
  }
}

// ── Module-level singleton ──────────────────────────────────
let store: UserDrawingStore = new UserDrawingStore()

export function getUserDrawingStore(): UserDrawingStore {
  return store
}

export function setUserDrawingStore(s: UserDrawingStore): void {
  store = s
}
