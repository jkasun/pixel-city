// ── Background Tools ────────────────────────────────────────────────
// Tools that should run silently — their verbose PTY output is
// suppressed and replaced with a compact one-liner in the terminal.

/** Tool name patterns considered "background" (output collapsed in terminal). */
const BG_PATTERNS = [
  /mempalace/i,
]

/** Returns true if the tool should run silently (PTY output suppressed). */
export function isBackgroundTool(toolName: string): boolean {
  return BG_PATTERNS.some(p => p.test(toolName))
}

/** Short human-readable label for a collapsed background tool call. */
export function bgToolLabel(toolName: string): string {
  // mcp__pixelcity-mempalace__mempalace_search → mempalace search
  if (toolName.startsWith('mcp__')) {
    const action = (toolName.split('__')[2] ?? '').replace(/_/g, ' ')
    return action || 'memory operation'
  }
  return toolName.replace(/_/g, ' ')
}
