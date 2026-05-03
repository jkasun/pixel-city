import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import type { SearchAddon } from '@xterm/addon-search'
import type { LLMSession } from './llm/LLMSession.js'
import type { AgentHandle } from './backend/types.js'

export interface AgentJsonlSession {
  jsonlPath: string
  fileOffset: number
  lineBuffer: string
  watcher: ReturnType<typeof import('fs').watch> | null
  existencePoller: ReturnType<typeof setInterval> | null
  pollInterval: ReturnType<typeof setInterval> | null
}

export interface AgentTerminalData {
  terminal?: Terminal // undefined for API-based providers (no xterm)
  fitAddon?: FitAddon
  searchAddon?: SearchAddon
  ptyId: number
  session?: LLMSession // LLM adapter session (when using provider-based flow)
  agentHandle?: AgentHandle // backend handle for cleanup
  exited?: boolean // true when the PTY process has exited
  lastOutputAt?: number // timestamp of last PTY output (for busy detection)
  bgToolIds?: Set<string> // active background tool IDs (PTY suppressed while non-empty)
}

export interface StatusHistoryEntry {
  agentId: string
  text: string
  timestamp: number
}

export interface ShellTerminalData {
  terminal: Terminal
  fitAddon: FitAddon
  searchAddon: SearchAddon
  ptyId: number
  name: string
}
