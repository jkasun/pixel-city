// ── AGENTS.md helpers for the Codex CLI provider ─────────────────────
// Codex reads `<cwd>/AGENTS.md` at session start to seed its system prompt.
// We need to inject Pixel City's prompt without clobbering anything the user
// (or another tool) has written into the file. Marker-based replace lets us
// upsert our section on every spawn and strip it on cleanup, with no risk of
// duplicate content stacking up across sessions if cleanup is skipped.

export const PIXEL_CITY_BEGIN = '<!-- PIXEL_CITY_PROMPT_START -->'
export const PIXEL_CITY_END = '<!-- PIXEL_CITY_PROMPT_END -->'

/** Remove any Pixel City–marked block. Leaves user content as-is. */
export function stripPixelCitySection(content: string): string {
  const begin = content.indexOf(PIXEL_CITY_BEGIN)
  if (begin === -1) return content
  const end = content.indexOf(PIXEL_CITY_END, begin)
  if (end === -1) return content
  const before = content.slice(0, begin).replace(/\s+$/, '')
  const after = content.slice(end + PIXEL_CITY_END.length).replace(/^\s+/, '')
  if (!before) return after
  if (!after) return before
  return `${before}\n\n${after}`
}

/** Upsert our marked section. Replaces any prior block; preserves user content. */
export function injectPixelCitySection(existing: string, prompt: string): string {
  const stripped = stripPixelCitySection(existing)
  const marked = `${PIXEL_CITY_BEGIN}\n${prompt}\n${PIXEL_CITY_END}`
  if (!stripped) return `${marked}\n`
  return `${marked}\n\n${stripped}`
}
