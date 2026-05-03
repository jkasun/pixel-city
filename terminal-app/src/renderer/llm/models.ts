// ── Model ID resolution ─────────────────────────────────────────────
// Maps short model aliases to full provider model IDs,
// and normalizes incoming model strings to canonical short names.

export const MODEL_IDS: Record<string, string> = {
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-6',
  // Anthropic API (direct, no terminal) — use api: prefix
  'api:opus': 'api:claude-opus-4-6',
  'api:sonnet': 'api:claude-sonnet-4-6',
  'api:haiku': 'api:claude-haiku-4-5',
}

/** Normalize model string. For Claude Code short names, returns 'sonnet'/'opus'.
 *  For other providers (Model Studio etc.), returns the model ID as-is. */
export function normalizeModel(model: string): string {
  // Anthropic API short names
  if (model === 'api:sonnet' || model === 'api:opus' || model === 'api:haiku') return model
  if (model === 'sonnet' || model === 'opus') return model
  if (model === 'claude-sonnet-4-6' || model.includes('sonnet')) return 'sonnet'
  if (model === 'claude-opus-4-6' || model === 'claude-opus-4-7' || model.includes('opus')) return 'opus'
  // Non-Claude models pass through as full IDs (e.g. 'qwen3.5-flash', 'deepseek-v3.2')
  return model
}
