// ── Chat Renderer Registry ──────────────────────────────────────────
// Runtime registry for chat UI renderers. Mirrors the LLM provider
// registry pattern. Renderers register themselves at startup; the
// AgentPanel queries the registry to find the right UI for each agent.

import type { IChatRenderer } from './IChatRenderer.js'
import type { RendererId } from './IChatRenderer.js'

class ChatRendererRegistry {
  private renderers = new Map<RendererId, IChatRenderer>()
  private defaultId: RendererId = 'builtin-chat'

  /** Register a renderer. Overwrites any existing renderer with the same ID. */
  register(renderer: IChatRenderer): void {
    this.renderers.set(renderer.id, renderer)
  }

  /** Remove a renderer by ID. */
  unregister(id: RendererId): void {
    this.renderers.delete(id)
  }

  /** Get a renderer by ID. Returns undefined if not registered. */
  get(id: RendererId): IChatRenderer | undefined {
    return this.renderers.get(id)
  }

  /** Get all registered renderers. */
  getAll(): IChatRenderer[] {
    return Array.from(this.renderers.values())
  }

  /** Set the default renderer ID (fallback when preferred renderer not found). */
  setDefault(id: RendererId): void {
    this.defaultId = id
  }

  /** Get the default renderer. Falls back to first registered if default not found. */
  getDefault(): IChatRenderer | undefined {
    return this.renderers.get(this.defaultId) ?? this.renderers.values().next().value
  }

  /**
   * Resolve a renderer by ID with fallback to default.
   * This is the primary method used by AgentPanel.
   */
  resolve(id: RendererId | undefined): IChatRenderer | undefined {
    if (id) {
      const renderer = this.renderers.get(id)
      if (renderer) return renderer
    }
    return this.getDefault()
  }
}

/** Singleton registry instance — import and use throughout the app */
export const rendererRegistry = new ChatRendererRegistry()
