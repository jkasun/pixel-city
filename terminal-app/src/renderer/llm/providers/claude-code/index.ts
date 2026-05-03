// ── Claude Code Provider — Barrel Export ────────────────────────────

import type { SessionChooserBinding } from '../../SessionChooser.js'
import { listClaudeSessions } from './sessionList.js'
import { readClaudeSessionIndex } from './sessionIndex.js'

export { ClaudeCodeProvider } from './ClaudeCodeProvider.js'
export { ClaudeCodeSession } from './ClaudeCodeSession.js'
export { JsonlWatcher, parseJsonlLine } from './jsonlParser.js'
export { buildSystemPrompt } from './systemPrompt.js'
export type { SystemPromptConfig } from './systemPrompt.js'

export const claudeCodeChooserBinding: SessionChooserBinding = {
  providerId: 'claude-code',
  listSessions: listClaudeSessions,
  readIndex: readClaudeSessionIndex,
  formatModelLabel: (modelId) => {
    if (modelId.includes('opus')) return 'Opus'
    if (modelId.includes('sonnet')) return 'Sonnet'
    if (modelId.includes('haiku')) return 'Haiku'
    return modelId
  },
}
