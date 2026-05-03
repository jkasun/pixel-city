// ── Execution Backend Registry ──────────────────────────────────────
// Runtime registry for execution backends. Mirrors the LLM provider
// registry pattern. The office layer queries this to find the right
// backend for each agent based on the provider's capabilities and
// the current environment.

import type { IExecutionBackend, BackendId } from './types.js'
import type { ILLMProvider } from '../llm/ILLMProvider.js'

class BackendRegistry {
  private backends = new Map<BackendId, IExecutionBackend>()
  private defaultId: BackendId = 'local'

  /** Register a backend. Overwrites any existing backend with the same ID. */
  register(backend: IExecutionBackend): void {
    this.backends.set(backend.id, backend)
  }

  /** Remove a backend by ID. */
  unregister(id: BackendId): void {
    this.backends.delete(id)
  }

  /** Get a backend by ID. Returns undefined if not registered. */
  get(id: BackendId): IExecutionBackend | undefined {
    return this.backends.get(id)
  }

  /** Get all registered backends. */
  getAll(): IExecutionBackend[] {
    return Array.from(this.backends.values())
  }

  /** Set the default backend ID. */
  setDefault(id: BackendId): void {
    this.defaultId = id
  }

  /**
   * Resolve the best backend for a given LLM provider.
   *
   * Logic:
   * - If the provider needs a terminal (hasTerminal: true), pick a backend
   *   that supports terminals (local or docker).
   * - If the provider is API-only, pick serverless if available, otherwise
   *   fall back to local (which can also host API sessions).
   * - Always falls back to the default backend.
   */
  resolve(provider: ILLMProvider): IExecutionBackend {
    if (provider.capabilities.hasTerminal) {
      // Terminal-based provider — need a backend with PTY support
      // Prefer docker (web) > local (desktop)
      const docker = this.backends.get('docker')
      if (docker && docker.capabilities.hasTerminal) return docker

      const local = this.backends.get('local')
      if (local) return local
    } else {
      // API-based provider — serverless is ideal, but any backend works
      const serverless = this.backends.get('serverless')
      if (serverless) return serverless
    }

    // Fallback to default
    const fallback = this.backends.get(this.defaultId)
    if (fallback) return fallback

    // Last resort: first registered backend
    const first = this.backends.values().next().value
    if (first) return first

    throw new Error('No execution backend registered')
  }

  /** Check availability of all backends. Returns map of id → error (null if ready). */
  async checkAllAvailability(): Promise<Map<BackendId, string | null>> {
    const results = new Map<BackendId, string | null>()
    await Promise.all(
      this.getAll().map(async backend => {
        const error = await backend.checkAvailability()
        results.set(backend.id, error)
      })
    )
    return results
  }
}

/** Singleton registry instance — import and use throughout the app */
export const backendRegistry = new BackendRegistry()
