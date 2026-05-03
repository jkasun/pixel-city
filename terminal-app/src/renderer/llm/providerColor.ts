// ── Provider accent colors ──────────────────────────────────────────
// Single source of truth for the UI accent color applied to a model
// label based on its owning provider.

export function getModelAccentColor(providerId: string | undefined, modelId: string): string {
  if (providerId === 'claude-code') {
    return modelId.includes('opus') ? '#c87aff' : '#5ac8e8'
  }
  if (providerId === 'codex-cli') return '#7de08f'
  return '#e8b85a'
}
