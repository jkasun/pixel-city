// ── LLM Event → Status Text Formatter ───────────────────────────────
// Converts LLMEvents into human-readable status strings for the office UI.
// This is the provider-agnostic replacement for toolStatus.ts.
// Provider-specific formatters can override this by emitting LLMStatusEvent directly.

import type { LLMEvent } from './types.js'

/**
 * Given an LLMEvent, return a short status string for the office UI.
 * Returns null if the event doesn't warrant a status update.
 */
export function formatEventStatus(event: LLMEvent): string | null {
  switch (event.type) {
    case 'tool_use':
      return formatToolStatus(event.toolName, event.input)
    case 'thinking':
      return 'Thinking\u2026'
    case 'text':
      return null // text output doesn't change status
    case 'turn_end':
      return null // caller should clear status on turn end
    case 'error':
      return `Error: ${event.message}`
    case 'subagent_spawn':
      return event.description ? `Subtask: ${truncate(event.description)}` : 'Running subtask'
    case 'status':
      return event.text
    default:
      return null
  }
}

const MAX_LEN = 36
const truncate = (s: string) => s.length > MAX_LEN ? s.slice(0, MAX_LEN) + '\u2026' : s
const basename = (p: unknown): string => {
  if (typeof p !== 'string') return ''
  const parts = p.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || p
}

/**
 * Format a tool invocation into a short human-readable status string.
 * This covers common tool names across providers. Provider-specific tools
 * should emit LLMStatusEvent directly for best results.
 */
function formatToolStatus(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    // File operations (Claude Code, and any provider using MCP file tools)
    case 'Read': return `Reading ${basename(input.file_path)}`
    case 'Edit': return `Editing ${basename(input.file_path)}`
    case 'MultiEdit': return `Editing ${basename(input.file_path)}`
    case 'Write': return `Writing ${basename(input.file_path)}`

    // Shell
    case 'Bash': {
      const cmd = ((input.command as string) || '').trim()
      if (/^node\b/.test(cmd))     return `Running JavaScript: ${truncate(cmd.replace(/^node\s+/, ''))}`
      if (/^python3?\b/.test(cmd)) return `Running Python: ${truncate(cmd.replace(/^python3?\s+/, ''))}`
      if (/^ts-node\b|^tsx\b/.test(cmd)) return `Running TypeScript: ${truncate(cmd.replace(/^\S+\s+/, ''))}`
      if (/^npm\b/.test(cmd))      return `npm ${truncate(cmd.replace(/^npm\s+/, ''))}`
      if (/^npx\b/.test(cmd))      return `npx ${truncate(cmd.replace(/^npx\s+/, ''))}`
      if (/^pnpm\b/.test(cmd))     return `pnpm ${truncate(cmd.replace(/^pnpm\s+/, ''))}`
      if (/^yarn\b/.test(cmd))     return `yarn ${truncate(cmd.replace(/^yarn\s+/, ''))}`
      if (/^bun\b/.test(cmd))      return `bun ${truncate(cmd.replace(/^bun\s+/, ''))}`
      if (/^git\b/.test(cmd))      return `git ${truncate(cmd.replace(/^git\s+/, ''))}`
      if (/^docker\b/.test(cmd))   return `docker ${truncate(cmd.replace(/^docker\s+/, ''))}`
      if (/^curl\b/.test(cmd))     return 'Fetching URL'
      if (/^wget\b/.test(cmd))     return 'Downloading file'
      if (/^ls\b|^dir\b/.test(cmd)) return 'Listing files'
      if (/^cat\b/.test(cmd))      return `Reading ${truncate(cmd.replace(/^cat\s+/, ''))}`
      if (/^mkdir\b/.test(cmd))    return 'Creating directory'
      if (/^rm\b/.test(cmd))       return 'Removing files'
      if (/^cp\b/.test(cmd))       return 'Copying files'
      if (/^mv\b/.test(cmd))       return 'Moving files'
      if (/^grep\b|^rg\b/.test(cmd)) return `Searching: ${truncate(cmd.replace(/^\S+\s+/, ''))}`
      if (/^find\b/.test(cmd))     return 'Finding files'
      return `Running: ${truncate(cmd)}`
    }

    // Search
    case 'Glob': return 'Searching files'
    case 'Grep': {
      const pattern = typeof input.pattern === 'string' ? input.pattern : ''
      return pattern ? `Searching: ${truncate(pattern)}` : 'Searching code'
    }
    case 'LS': {
      const p = typeof input.path === 'string' ? basename(input.path) : ''
      return p ? `Listing: ${p}` : 'Listing files'
    }

    // Web
    case 'WebFetch': return 'Fetching web content'
    case 'WebSearch': {
      const q = typeof input.query === 'string' ? input.query : ''
      return q ? `Searching: ${truncate(q)}` : 'Searching the web'
    }

    // Sub-agents / tasks
    case 'Task': {
      const desc = typeof input.description === 'string' ? input.description : ''
      return desc ? `Subtask: ${truncate(desc)}` : 'Running subtask'
    }

    // Interactive
    case 'AskUserQuestion': return 'Waiting for your answer'
    case 'EnterPlanMode': return 'Planning'
    case 'NotebookRead': return 'Reading notebook'
    case 'NotebookEdit': return 'Editing notebook'
    case 'TodoRead': return 'Reading todos'
    case 'TodoWrite': return 'Updating todos'

    default: {
      // MCP tools: mcp__service__action
      if (toolName.startsWith('mcp__')) {
        const parts = toolName.split('__')
        const service = parts[1] ?? ''
        const action = (parts[2] ?? '').replace(/_/g, ' ')
        const hint = input.query ?? input.description ?? input.pattern ?? input.command
        if (typeof hint === 'string' && hint) return `${service}: ${truncate(hint)}`
        return action ? `${service}: ${action}` : `Using ${service}`
      }
      // Generic fallback
      const firstVal = Object.values(input).find(v => typeof v === 'string' && (v as string).length > 0)
      if (typeof firstVal === 'string') return `${toolName}: ${truncate(firstVal)}`
      return `Using ${toolName}`
    }
  }
}
