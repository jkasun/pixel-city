// ── Claude Code LLM Provider ────────────────────────────────────────
// Implements ILLMProvider for the Claude Code CLI (PTY-based).
// Spawns agents by creating a PTY process running `claude` and
// watching the resulting JSONL transcript for normalized events.

import type { ILLMProvider } from '../../ILLMProvider.js'
import type { LLMSession } from '../../LLMSession.js'
import type { ChipDescriptor, LLMCapabilities, LLMModel, LLMSessionConfig, ProviderId } from '../../types.js'
import { ClaudeCodeSession } from './ClaudeCodeSession.js'
import { buildSystemPrompt } from './systemPrompt.js'
import { recordClaudeSessionSpawn } from './sessionIndex.js'
import { claudeProjectFolder } from './sessionList.js'
import { platform } from '../../../platform/index.js'
import { setActiveSessionForAgent } from '../../../mcpBridge/canvasSessionResolver.js'

const osModule = window.require('os') as typeof import('os')

const CLAUDE_CODE_CAPABILITIES: LLMCapabilities = {
  hasTerminal: true,
  hasToolUse: true,
  hasSubagents: true,
  hasStreaming: true,
  hasJsonlLog: true,
  preferredRenderer: 'terminal',
}

const MODELS: LLMModel[] = [
  { id: 'claude-sonnet-4-6', label: 'Sonnet', providerId: 'claude-code' },
  { id: 'claude-opus-4-7', label: 'Opus', providerId: 'claude-code' },
]

/** Short name → full model ID */
const MODEL_ID_MAP: Record<string, string> = {
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-7',
  // Legacy opus 4.6 is silently run as 4.7 at spawn time; treat them as the
  // same canonical model so the chip stays consistent between offline config
  // and live agent.
  'claude-opus-4-6': 'claude-opus-4-7',
}

const CANONICAL_SONNET_ID = 'claude-sonnet-4-6'
const CANONICAL_OPUS_ID = 'claude-opus-4-7'

/** 'claude-sonnet-4-5' → '4.5'. Returns undefined for canonical IDs. */
function extractVersion(modelId: string): string | undefined {
  const m = modelId.match(/(\d+)-(\d+)$/)
  return m ? `${m[1]}.${m[2]}` : undefined
}

export class ClaudeCodeProvider implements ILLMProvider {
  readonly id: ProviderId = 'claude-code'
  readonly displayName = 'Claude Code (Terminal)'
  readonly capabilities = CLAUDE_CODE_CAPABILITIES
  readonly defaultModelId = CANONICAL_SONNET_ID

  getModels(): LLMModel[] {
    return MODELS
  }

  getChipDescriptor(modelId: string): ChipDescriptor | null {
    const resolved = MODEL_ID_MAP[modelId] ?? modelId
    if (resolved.includes('sonnet')) {
      return {
        letter: 'S',
        color: '#5ac8e8',
        versionLabel: resolved === CANONICAL_SONNET_ID ? undefined : extractVersion(resolved),
        providerLabel: 'Anthropic',
        modelLabel: 'Sonnet',
      }
    }
    if (resolved.includes('opus')) {
      return {
        letter: 'O',
        color: '#c87aff',
        versionLabel: resolved === CANONICAL_OPUS_ID ? undefined : extractVersion(resolved),
        providerLabel: 'Anthropic',
        modelLabel: 'Opus',
      }
    }
    return null
  }

  async checkAvailability(): Promise<string | null> {
    try {
      // Check if claude binary is accessible
      const result = await platform().app.checkCommandExists('claude') as any
      if (result?.exists) return null
      return 'Claude Code CLI not found on PATH. Install it with: npm install -g @anthropic-ai/claude-code'
    } catch {
      // If the IPC handler doesn't exist, try a simpler check
      return null // Assume available — will fail at spawn time if not
    }
  }

  async createSession(config: LLMSessionConfig): Promise<LLMSession> {
    const {
      sessionId,
      modelId,
      agentId,
      agentName,
      cwd,
      cols = 120,
      rows = 30,
      env = {},
      systemPrompt,
      initialPrompt,
      resume,
      providerOptions = {},
    } = config

    // Resolve model ID from short names
    const resolvedModelId = MODEL_ID_MAP[modelId] ?? modelId

    // Bind this (agentId, sessionId) pair as the active canvas session so
    // MCP canvas tool calls from the spawned process route to the right
    // on-disk path. Applies to both fresh spawns and resumes.
    if (agentId) setActiveSessionForAgent(agentId, sessionId)

    // Build permission args
    const permissionMode = (providerOptions.permissionMode as string) ?? 'bypass'
    const permArgs = permissionMode === 'auto'
      ? ['--enable-auto-mode']
      : ['--dangerously-skip-permissions']

    // Resume path: `--resume <id>` replays the existing JSONL. Using
    // `--session-id` on an existing UUID makes the CLI reject with
    // "Session ID <uuid> is already in use." Skip initialPrompt — the
    // transcript IS the conversation context.
    const idArgs = resume ? ['--resume', sessionId] : ['--session-id', sessionId]
    const args = [
      ...idArgs,
      ...permArgs,
      ...(resolvedModelId ? ['--model', resolvedModelId] : []),
      ...(systemPrompt ? ['--append-system-prompt', systemPrompt] : []),
      ...(!resume && initialPrompt ? [initialPrompt] : []),
    ]

    // Spawn PTY process
    const ptyId: number = await platform().pty.create({
      cols,
      rows,
      command: 'claude',
      args,
      cwd,
      env,
    } as any)

    // Compute JSONL path. Claude replaces `.` in addition to `[:/\]` when
    // naming `~/.claude/projects/<folder>` — pixel-city's `computeProjectHash`
    // doesn't, so we use a Claude-specific helper to match its actual layout.
    const projectHash = cwd ? claudeProjectFolder(cwd) : '00000000'
    const jsonlPath = `${osModule.homedir()}/.claude/projects/${projectHash}/${sessionId}.jsonl`

    // Record fresh spawns in the project-local index so the session chooser
    // can attribute past JSONL transcripts to this agent. Resume preserves
    // the existing entry; missing cwd has no resolvable index path.
    if (!resume && cwd) {
      recordClaudeSessionSpawn(cwd, sessionId, {
        agentId: agentId ?? '',
        agentName: agentName ?? '',
        modelId: resolvedModelId,
        spawnedAt: new Date().toISOString(),
      })
    }

    return new ClaudeCodeSession({
      ptyId,
      sessionId,
      projectHash,
      jsonlPath,
    })
  }
}
