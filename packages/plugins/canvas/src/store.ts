// Canvas Store — L1 Domain Layer
// Pure TypeScript, ZERO React or DOM imports.
//
// Storage is keyed internally by (agentId, sessionId). The snapshot exposed
// to React is keyed by raw agentId so existing tab UIs keep working: each
// agent shows the canvas of its currently-active session. The active
// session is tracked separately and updated by:
//   - the most recent set/setAt call (wins by default — agent typed something)
//   - explicit setActiveSession(agentId, sessionId) calls (user clicked a
//     different chat session in the UI)
//
// This is the single source of in-memory truth. The disk layer (L0 IPC)
// is the source of cross-restart truth and is reconciled via hydrateFromDisk.

export interface CanvasContent {
  html: string
  title: string | null
}

export interface CanvasVersion {
  id: number
  html: string
  title: string | null
  timestamp: number
}

const MAX_VERSIONS = 50
const DEFAULT_SESSION = '_default'

type Listener = () => void

function composeKey(agentId: string, sessionId: string): string {
  return `${agentId}::${sessionId}`
}

export class CanvasStore {
  /** Composite-keyed: `${agentId}::${sessionId}` → content. */
  private contentByKey = new Map<string, CanvasContent>()
  /** Composite-keyed version history. */
  private versionsByKey = new Map<string, CanvasVersion[]>()
  /** Composite-keyed monotonic version id counter. */
  private versionCounter = new Map<string, number>()
  /** agentId → currently-active sessionId in the UI. */
  private activeSession = new Map<string, string>()

  private listeners = new Set<Listener>()
  private snapshot: ReadonlyMap<string, CanvasContent> = new Map()

  // ── Public API ───────────────────────────────────────────────

  /**
   * Set canvas content. The (agentId, sessionId) pair becomes the active
   * session for that agent — most recent write wins.
   */
  set(agentId: string, html: string, title: string | null, sessionId: string = DEFAULT_SESSION): void {
    const key = composeKey(agentId, sessionId)
    this._captureVersion(key, html, title)
    this.contentByKey.set(key, { html, title })
    this.activeSession.set(agentId, sessionId)
    this.updateSnapshot()
  }

  /** Internal set that bypasses version capture — used by restoreVersion(). */
  private _setWithoutVersion(agentId: string, sessionId: string, html: string, title: string | null): void {
    const key = composeKey(agentId, sessionId)
    this.contentByKey.set(key, { html, title })
    this.activeSession.set(agentId, sessionId)
    this.updateSnapshot()
  }

  /**
   * Clear canvas content for an (agentId, sessionId) pair. If the cleared
   * session was the active one, falls back to any other surviving session
   * for that agent (most recently written), or removes the agent entirely
   * from the snapshot.
   */
  clear(agentId: string, sessionId: string = DEFAULT_SESSION): void {
    const key = composeKey(agentId, sessionId)
    if (!this.contentByKey.has(key)) return
    this.contentByKey.delete(key)
    this.versionsByKey.delete(key)
    this.versionCounter.delete(key)

    if (this.activeSession.get(agentId) === sessionId) {
      // Pick another session for this agent if any exist.
      const survivor = this._findSurvivingSessionForAgent(agentId)
      if (survivor) {
        this.activeSession.set(agentId, survivor)
      } else {
        this.activeSession.delete(agentId)
      }
    }
    this.updateSnapshot()
  }

  /**
   * Get canvas content. With no sessionId, returns the active session's
   * content for the agent. Pass a sessionId to read a specific one.
   */
  get(agentId: string, sessionId?: string): CanvasContent | undefined {
    const sid = sessionId ?? this.activeSession.get(agentId) ?? DEFAULT_SESSION
    return this.contentByKey.get(composeKey(agentId, sid))
  }

  /** Unique agent IDs that have at least one session with content. */
  getAgentIdsWithContent(): string[] {
    const seen = new Set<string>()
    for (const key of this.contentByKey.keys()) {
      const i = key.indexOf('::')
      seen.add(i >= 0 ? key.slice(0, i) : key)
    }
    return Array.from(seen)
  }

  /** All session IDs for a given agent that have content. */
  getSessionIdsForAgent(agentId: string): string[] {
    const out: string[] = []
    const prefix = `${agentId}::`
    for (const key of this.contentByKey.keys()) {
      if (key.startsWith(prefix)) {
        out.push(key.slice(prefix.length))
      }
    }
    return out
  }

  /** The currently-active session for an agent (or DEFAULT_SESSION). */
  getActiveSessionId(agentId: string): string {
    return this.activeSession.get(agentId) ?? DEFAULT_SESSION
  }

  /**
   * Switch the active session for an agent. Triggers a snapshot update so
   * the UI re-renders. No-op if the (agentId, sessionId) has no content
   * loaded — caller should hydrateFromDisk first.
   */
  setActiveSession(agentId: string, sessionId: string): void {
    if (this.activeSession.get(agentId) === sessionId) return
    this.activeSession.set(agentId, sessionId)
    this.updateSnapshot()
  }

  // ── Version History ──────────────────────────────────────────

  /**
   * Versions for an agent's session. With no sessionId, returns versions
   * for the active session.
   */
  getVersions(agentId: string | null, sessionId?: string): readonly CanvasVersion[] {
    if (!agentId) return []
    const sid = sessionId ?? this.activeSession.get(agentId) ?? DEFAULT_SESSION
    return this.versionsByKey.get(composeKey(agentId, sid)) ?? []
  }

  restoreVersion(agentId: string, versionId: number, sessionId?: string): boolean {
    const sid = sessionId ?? this.activeSession.get(agentId) ?? DEFAULT_SESSION
    const versions = this.versionsByKey.get(composeKey(agentId, sid))
    if (!versions) return false
    const version = versions.find(v => v.id === versionId)
    if (!version) return false
    this._setWithoutVersion(agentId, sid, version.html, version.title)
    return true
  }

  /**
   * Hydrate a session's content + versions from disk-loaded data without
   * triggering a fresh version capture. Used at boot and when the user
   * switches to a session whose content isn't in memory yet.
   */
  hydrateFromDisk(
    agentId: string,
    sessionId: string,
    content: CanvasContent,
    versions: readonly CanvasVersion[],
    makeActive: boolean = false,
  ): void {
    const key = composeKey(agentId, sessionId)
    this.contentByKey.set(key, content)
    this.versionsByKey.set(key, [...versions])
    if (versions.length > 0) {
      this.versionCounter.set(key, Math.max(...versions.map(v => v.id)))
    }
    if (makeActive || !this.activeSession.has(agentId)) {
      this.activeSession.set(agentId, sessionId)
    }
    this.updateSnapshot()
  }

  // ── Internals ────────────────────────────────────────────────

  private _captureVersion(key: string, html: string, title: string | null): void {
    let versions = this.versionsByKey.get(key)
    if (!versions) {
      versions = []
      this.versionsByKey.set(key, versions)
    }
    const counter = (this.versionCounter.get(key) ?? 0) + 1
    this.versionCounter.set(key, counter)
    versions.push({ id: counter, html, title, timestamp: Date.now() })
    if (versions.length > MAX_VERSIONS) {
      versions.shift()
    }
  }

  private _findSurvivingSessionForAgent(agentId: string): string | null {
    const prefix = `${agentId}::`
    for (const key of this.contentByKey.keys()) {
      if (key.startsWith(prefix)) {
        return key.slice(prefix.length)
      }
    }
    return null
  }

  // ── Snapshot & Subscribe ─────────────────────────────────────

  /**
   * Immutable snapshot for useSyncExternalStore. Keyed by raw agentId,
   * exposing each agent's currently-active session content. Agents with
   * no active content are omitted.
   */
  getSnapshot = (): ReadonlyMap<string, CanvasContent> => {
    return this.snapshot
  }

  /** Subscribe to changes — returns unsubscribe function. */
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private updateSnapshot(): void {
    const next = new Map<string, CanvasContent>()
    for (const [agentId, sessionId] of this.activeSession.entries()) {
      const content = this.contentByKey.get(composeKey(agentId, sessionId))
      if (content) next.set(agentId, content)
    }
    this.snapshot = next
    for (const listener of this.listeners) {
      listener()
    }
  }
}

// ── Module-level singleton ──────────────────────────────────
let store: CanvasStore = new CanvasStore()

export function getCanvasStore(): CanvasStore {
  return store
}

export function setCanvasStore(s: CanvasStore): void {
  store = s
}
