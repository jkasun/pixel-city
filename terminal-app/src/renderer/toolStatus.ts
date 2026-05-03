export function formatToolStatusJsonl(toolName: string, input: Record<string, unknown>): string {
  const base = (p: unknown): string => {
    if (typeof p !== 'string') return ''
    const parts = p.replace(/\\/g, '/').split('/')
    return parts[parts.length - 1] || p
  }
  const MAX = 36
  const short = (s: string) => s.length > MAX ? s.slice(0, MAX) + '\u2026' : s

  switch (toolName) {
    case 'Read': return `Reading ${base(input.file_path)}`
    case 'Edit': return `Editing ${base(input.file_path)}`
    case 'MultiEdit': return `Editing ${base(input.file_path)}`
    case 'Write': return `Writing ${base(input.file_path)}`
    case 'Bash': {
      const cmd = ((input.command as string) || '').trim()
      if (/^node\b/.test(cmd))   return `Running JavaScript: ${short(cmd.replace(/^node\s+/, ''))}`
      if (/^python3?\b/.test(cmd)) return `Running Python: ${short(cmd.replace(/^python3?\s+/, ''))}`
      if (/^ts-node\b|^tsx\b/.test(cmd)) return `Running TypeScript: ${short(cmd.replace(/^\S+\s+/, ''))}`
      if (/^npm\b/.test(cmd))    return `npm ${short(cmd.replace(/^npm\s+/, ''))}`
      if (/^npx\b/.test(cmd))    return `npx ${short(cmd.replace(/^npx\s+/, ''))}`
      if (/^pnpm\b/.test(cmd))   return `pnpm ${short(cmd.replace(/^pnpm\s+/, ''))}`
      if (/^yarn\b/.test(cmd))   return `yarn ${short(cmd.replace(/^yarn\s+/, ''))}`
      if (/^bun\b/.test(cmd))    return `bun ${short(cmd.replace(/^bun\s+/, ''))}`
      if (/^git\b/.test(cmd))    return `git ${short(cmd.replace(/^git\s+/, ''))}`
      if (/^docker\b/.test(cmd)) return `docker ${short(cmd.replace(/^docker\s+/, ''))}`
      if (/^curl\b/.test(cmd))   return `Fetching URL`
      if (/^wget\b/.test(cmd))   return `Downloading file`
      if (/^ls\b|^dir\b/.test(cmd)) return 'Listing files'
      if (/^cat\b/.test(cmd))    return `Reading ${short(cmd.replace(/^cat\s+/, ''))}`
      if (/^mkdir\b/.test(cmd))  return `Creating directory`
      if (/^rm\b/.test(cmd))     return `Removing files`
      if (/^cp\b/.test(cmd))     return `Copying files`
      if (/^mv\b/.test(cmd))     return `Moving files`
      if (/^grep\b|^rg\b/.test(cmd)) return `Searching: ${short(cmd.replace(/^\S+\s+/, ''))}`
      if (/^find\b/.test(cmd))   return `Finding files`
      return `Running: ${short(cmd)}`
    }
    case 'Glob': return 'Searching files'
    case 'Grep': {
      const pattern = typeof input.pattern === 'string' ? input.pattern : ''
      return pattern ? `Searching: ${short(pattern)}` : 'Searching code'
    }
    case 'LS': {
      const p = typeof input.path === 'string' ? base(input.path) : ''
      return p ? `Listing: ${p}` : 'Listing files'
    }
    case 'WebFetch': return 'Fetching web content'
    case 'WebSearch': {
      const q = typeof input.query === 'string' ? input.query : ''
      return q ? `Searching: ${short(q)}` : 'Searching the web'
    }
    case 'Task': {
      const desc = typeof input.description === 'string' ? input.description : ''
      return desc ? `Subtask: ${short(desc)}` : 'Running subtask'
    }
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
        if (typeof hint === 'string' && hint) return `${service}: ${short(hint)}`
        return action ? `${service}: ${action}` : `Using ${service}`
      }
      // Generic: show tool name + first meaningful string input
      const firstVal = Object.values(input).find(v => typeof v === 'string' && (v as string).length > 0)
      if (typeof firstVal === 'string') return `${toolName}: ${short(firstVal)}`
      return `Using ${toolName}`
    }
  }
}
