// ── LLM Provider Registry ───────────────────────────────────────────
// Runtime registry for LLM providers. Providers register themselves
// at startup; the office layer queries the registry to find available
// providers and their models.

import type { ILLMProvider } from './ILLMProvider.js'
import type { ChipDescriptor, LLMModel, ProviderId } from './types.js'

class LLMProviderRegistry {
  private providers = new Map<ProviderId, ILLMProvider>()

  /** Register a provider. Overwrites any existing provider with the same ID. */
  register(provider: ILLMProvider): void {
    this.providers.set(provider.id, provider)
  }

  /** Remove a provider by ID. */
  unregister(id: ProviderId): void {
    this.providers.delete(id)
  }

  /** Get a provider by ID. Returns undefined if not registered. */
  get(id: ProviderId): ILLMProvider | undefined {
    return this.providers.get(id)
  }

  /** Get all registered providers. */
  getAll(): ILLMProvider[] {
    return Array.from(this.providers.values())
  }

  /** Get all models across all providers, grouped by provider. */
  getAllModels(): Array<{ provider: ILLMProvider; models: LLMModel[] }> {
    return this.getAll().map(provider => ({
      provider,
      models: provider.getModels(),
    }))
  }

  /** Find the provider that owns a given model ID. */
  findProviderForModel(modelId: string): ILLMProvider | undefined {
    for (const provider of this.providers.values()) {
      if (provider.getModels().some(m => m.id === modelId)) {
        return provider
      }
    }
    return undefined
  }

  /**
   * Resolve a provider for a model ID, accepting provider-specific aliases
   * (e.g. 'codex' → codex-cli, 'sonnet' → claude-code). Falls back to chip
   * descriptors so providers can claim aliases without listing every variant
   * in `getModels()`.
   */
  resolveProviderForModel(modelId: string): ILLMProvider | undefined {
    const exact = this.findProviderForModel(modelId)
    if (exact) return exact
    for (const provider of this.providers.values()) {
      if (provider.getChipDescriptor(modelId)) return provider
    }
    return undefined
  }

  /**
   * Resolve a model ID to its chip descriptor by asking each provider in turn.
   * Providers accept their short aliases (e.g. 'sonnet', 'codex') — stricter
   * than findProviderForModel which only matches the canonical MODELS list.
   */
  getChipDescriptorForModel(modelId: string): ChipDescriptor | null {
    for (const provider of this.providers.values()) {
      const descriptor = provider.getChipDescriptor(modelId)
      if (descriptor) return descriptor
    }
    return null
  }

  /** Check availability of all providers. Returns map of providerId → error (null if ready). */
  async checkAllAvailability(): Promise<Map<ProviderId, string | null>> {
    const results = new Map<ProviderId, string | null>()
    await Promise.all(
      this.getAll().map(async provider => {
        const error = await provider.checkAvailability()
        results.set(provider.id, error)
      })
    )
    return results
  }
}

/** Singleton registry instance — import and use throughout the app */
export const llmRegistry = new LLMProviderRegistry()
