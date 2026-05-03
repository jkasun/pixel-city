// ── LLM Provider Interface ──────────────────────────────────────────
// Every LLM backend implements this interface. The office layer talks
// to providers exclusively through this contract.

import type { ChipDescriptor, LLMCapabilities, LLMModel, LLMSessionConfig, ProviderId } from './types.js'
import type { LLMSession } from './LLMSession.js'

export interface ILLMProvider {
  /** Unique provider identifier (e.g. 'claude-code', 'codex-cli') */
  readonly id: ProviderId

  /** Human-readable name for the UI (e.g. 'Claude Code (Terminal)') */
  readonly displayName: string

  /** What this provider can do — drives UI decisions */
  readonly capabilities: LLMCapabilities

  /**
   * Model spawned when the caller doesn't pick one (e.g. "use provider default").
   * Separate from chip rendering — each adapter decides per-model whether to
   * emit a versionLabel in getChipDescriptor.
   */
  readonly defaultModelId: string

  /** List of models available through this provider */
  getModels(): LLMModel[]

  /**
   * Describe how a given model renders in the sidebar chip.
   * Return null if the provider doesn't recognize the model — the UI
   * falls back to first-char + neutral grey.
   *
   * Omit versionLabel for the canonical/latest version of each model family
   * (chip shows letter only). Include it for older/alternate versions so the
   * chip disambiguates (e.g. 'O 4.6' vs 'O').
   */
  getChipDescriptor(modelId: string): ChipDescriptor | null

  /**
   * Spawn a new LLM session with the given config.
   * For PTY providers, this creates a terminal process.
   * For API providers, this initializes a streaming API connection.
   */
  createSession(config: LLMSessionConfig): Promise<LLMSession>

  /**
   * Check whether this provider is currently usable.
   * E.g. API key configured, CLI binary on PATH, etc.
   * Returns null if ready, or an error message if not.
   */
  checkAvailability(): Promise<string | null>
}
