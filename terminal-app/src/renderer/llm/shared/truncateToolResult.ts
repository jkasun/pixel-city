// ── Tool Result Truncation ──────────────────────────────────────────
// Prevents large tool results (file contents, directory trees) from
// bloating conversation history. Full results stay in chatHistory for
// UI display; only the API message history gets truncated.

const MAX_TOOL_RESULT_CHARS = 8000 // ~2K tokens

export function truncateToolResult(result: string): string {
  if (result.length <= MAX_TOOL_RESULT_CHARS) return result
  const half = Math.floor(MAX_TOOL_RESULT_CHARS / 2)
  return (
    result.slice(0, half) +
    '\n\n… [truncated — middle portion removed to save tokens] …\n\n' +
    result.slice(-half)
  )
}
