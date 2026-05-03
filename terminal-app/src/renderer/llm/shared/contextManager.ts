// ── Context Manager ─────────────────────────────────────────────────
// Trims conversation history to fit within a token budget before each
// API call. Keeps recent messages intact, removes oldest tool results
// first (they are the largest), and maintains message pairing constraints.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiMessage = Record<string, any>

export interface ContextManagerOptions {
  /** Max estimated tokens for the messages array (default: 30000) */
  maxTokenBudget?: number
  /** Number of recent messages to always keep (default: 6) */
  keepRecentMessages?: number
}

const DEFAULT_MAX_BUDGET = 30000
const DEFAULT_KEEP_RECENT = 6
const CHARS_PER_TOKEN = 4

/** Estimate token count for a message */
function estimateTokens(msg: ApiMessage): number {
  const content = typeof msg.content === 'string'
    ? msg.content
    : JSON.stringify(msg.content)
  return Math.ceil((content?.length ?? 0) / CHARS_PER_TOKEN)
}

/**
 * Trim messages to fit within a token budget.
 *
 * Strategy:
 * 1. Always keep the first message (system prompt for Model Studio)
 * 2. Always keep the last N messages
 * 3. For messages in between, remove the largest tool results first
 * 4. If still over budget, remove oldest messages
 * 5. Never orphan tool_use/tool_result pairs (Anthropic) or
 *    assistant.tool_calls/tool messages (OpenAI)
 *
 * Returns a NEW array — does not mutate the input.
 */
export function trimMessages(
  messages: ReadonlyArray<ApiMessage>,
  options: ContextManagerOptions = {},
): ApiMessage[] {
  const maxBudget = options.maxTokenBudget ?? DEFAULT_MAX_BUDGET
  const keepRecent = options.keepRecentMessages ?? DEFAULT_KEEP_RECENT

  // Quick check: if under budget, return as-is
  const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m), 0)
  if (totalTokens <= maxBudget) return [...messages]

  const len = messages.length
  if (len <= keepRecent + 1) return [...messages]

  // Split: first message (possibly system) | middle | recent tail
  const first = messages[0]
  const recentStart = Math.max(1, len - keepRecent)
  const recent = messages.slice(recentStart)
  const middle = messages.slice(1, recentStart)

  // Budget remaining after first + recent messages
  const fixedTokens = estimateTokens(first) + recent.reduce((s, m) => s + estimateTokens(m), 0)
  let remainingBudget = maxBudget - fixedTokens

  if (remainingBudget <= 0) {
    // Even recent messages exceed budget — just keep first + recent
    return [first, { role: 'user', content: '[Earlier conversation trimmed to save tokens]' }, ...recent]
  }

  // Score middle messages: tool results are most expendable
  const scored = middle.map((msg, idx) => ({
    msg,
    idx,
    tokens: estimateTokens(msg),
    isToolResult: msg.role === 'tool' || (Array.isArray(msg.content) && msg.content.some((b: ApiMessage) => b.type === 'tool_result')),
  }))

  // Find paired indices — we must remove tool_use + tool_result together
  const pairedRemoval = new Set<number>()

  // Try to fit middle messages within remaining budget
  // Start by keeping all, then remove largest tool results from the oldest end
  let middleTokens = scored.reduce((s, m) => s + m.tokens, 0)
  const removed = new Set<number>()

  if (middleTokens > remainingBudget) {
    // Phase 1: Remove tool results (largest), oldest first
    const toolResults = scored
      .filter(s => s.isToolResult)
      .sort((a, b) => a.idx - b.idx) // oldest first

    for (const tr of toolResults) {
      if (middleTokens <= remainingBudget) break
      removed.add(tr.idx)
      middleTokens -= tr.tokens

      // Find and remove the paired tool_use/assistant message
      // Anthropic: tool_result in user message paired with tool_use in assistant message
      // OpenAI: tool message paired with assistant.tool_calls
      if (tr.idx > 0) {
        const prev = scored[tr.idx - 1]
        if (prev && !removed.has(prev.idx)) {
          const content = prev.msg.content
          const hasToolUse = Array.isArray(content)
            ? content.some((b: ApiMessage) => b.type === 'tool_use')
            : prev.msg.tool_calls
          if (hasToolUse) {
            removed.add(prev.idx)
            middleTokens -= prev.tokens
          }
        }
      }
    }

    // Phase 2: If still over budget, remove oldest non-tool messages
    if (middleTokens > remainingBudget) {
      for (const s of scored) {
        if (middleTokens <= remainingBudget) break
        if (!removed.has(s.idx)) {
          removed.add(s.idx)
          middleTokens -= s.tokens
        }
      }
    }
  }

  // Rebuild middle array, skipping removed messages
  const keptMiddle = scored
    .filter(s => !removed.has(s.idx))
    .map(s => s.msg)

  const result: ApiMessage[] = [first]

  if (removed.size > 0) {
    result.push({
      role: 'user',
      content: `[${removed.size} earlier messages trimmed to save tokens]`,
    })
  }

  result.push(...keptMiddle, ...recent)
  return result
}
