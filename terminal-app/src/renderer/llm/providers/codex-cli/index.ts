// ── Codex CLI Provider — Barrel Export ──────────────────────────────

import type { SessionChooserBinding } from '../../SessionChooser.js'
import { listCodexSessions } from './sessionList.js'
import { readCodexSessionIndex } from './sessionIndex.js'

export { CodexCliProvider } from './CodexCliProvider.js'
export { CodexCliSession } from './CodexCliSession.js'

/** SessionChooser binding for the chooser UI. */
export const codexCliChooserBinding: SessionChooserBinding = {
  providerId: 'codex-cli',
  listSessions: listCodexSessions,
  readIndex: readCodexSessionIndex,
  formatModelLabel: (modelId) => {
    // gpt-5.5 → GPT-5.5; o4 → o4; fall back to upper-cased input
    if (/^gpt-/i.test(modelId)) return modelId.replace(/^gpt-/i, 'GPT-')
    return modelId
  },
}
