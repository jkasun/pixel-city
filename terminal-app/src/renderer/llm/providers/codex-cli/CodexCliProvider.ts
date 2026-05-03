// ── Codex CLI LLM Provider ───────────────────────────────────────────
// Implements ILLMProvider for the OpenAI Codex CLI (PTY-based).
// Spawns agents by creating a PTY process running `codex` and writing
// an AGENTS.md system prompt file in the working directory.

import type { ILLMProvider } from '../../ILLMProvider.js'
import type { LLMSession } from '../../LLMSession.js'
import type { ChipDescriptor, LLMCapabilities, LLMModel, LLMSessionConfig, ProviderId } from '../../types.js'
import { CodexCliSession } from './CodexCliSession.js'
import { platform } from '../../../platform/index.js'
import { claimNextCodexSession } from './sessionIndex.js'
import { snapshotCodexSessionIds } from './sessionList.js'
import { injectPixelCitySection } from './agentsMd.js'

const fs = window.require('fs') as typeof import('fs')
const path = window.require('path') as typeof import('path')

const CODEX_CLI_CAPABILITIES: LLMCapabilities = {
  hasTerminal: true,
  hasToolUse: true,
  hasSubagents: false,
  hasStreaming: true,
  hasJsonlLog: false,
  preferredRenderer: 'terminal',
}

const DEFAULT_CODEX_MODEL_ID = 'gpt-5.5'

const MODELS: LLMModel[] = [
  { id: DEFAULT_CODEX_MODEL_ID, label: 'GPT-5.5', providerId: 'codex-cli' },
]

const MODEL_ID_MAP: Record<string, string> = {
  codex: DEFAULT_CODEX_MODEL_ID,
  'gpt-5-codex': DEFAULT_CODEX_MODEL_ID,
  'gpt-5.1-codex': DEFAULT_CODEX_MODEL_ID,
  'gpt-5.1-codex-mini': DEFAULT_CODEX_MODEL_ID,
  'gpt-5.2-codex': DEFAULT_CODEX_MODEL_ID,
  'gpt-5.3-codex': DEFAULT_CODEX_MODEL_ID,
  'gpt-5.5': DEFAULT_CODEX_MODEL_ID,
}

function resolveCodexModelId(modelId: string): string {
  return MODEL_ID_MAP[modelId] ?? DEFAULT_CODEX_MODEL_ID
}

const CODEX_GREEN = '#7de08f'
const CANONICAL_O_SERIES_ID = 'o4'

export class CodexCliProvider implements ILLMProvider {
  readonly id: ProviderId = 'codex-cli'
  readonly displayName = 'Codex CLI (Terminal)'
  readonly capabilities = CODEX_CLI_CAPABILITIES
  readonly defaultModelId = DEFAULT_CODEX_MODEL_ID

  getModels(): LLMModel[] {
    return MODELS
  }

  getChipDescriptor(modelId: string): ChipDescriptor | null {
    // o-series reasoning models: lowercase 'o' to distinguish from Anthropic Opus 'O'.
    // Collision is resolved by color (OpenAI green vs Anthropic purple) and case.
    const oSeriesMatch = modelId.match(/^o(\d+)$/)
    if (oSeriesMatch) {
      return {
        letter: 'o',
        color: CODEX_GREEN,
        versionLabel: modelId === CANONICAL_O_SERIES_ID ? undefined : oSeriesMatch[1],
        providerLabel: 'OpenAI',
        modelLabel: 'o-series',
      }
    }
    // Codex / GPT family: map everything through MODEL_ID_MAP, canonical = gpt-5.5.
    // Non-canonical inputs ('gpt-5.3-codex' etc.) extract a version label from the input,
    // not the resolved canonical ID.
    if (modelId in MODEL_ID_MAP || modelId.startsWith('gpt-')) {
      const resolved = resolveCodexModelId(modelId)
      const isCanonical = resolved === DEFAULT_CODEX_MODEL_ID && modelId === DEFAULT_CODEX_MODEL_ID
      const versionMatch = modelId.match(/gpt-(\d+(?:\.\d+)?)/)
      return {
        letter: 'C',
        color: CODEX_GREEN,
        versionLabel: isCanonical ? undefined : versionMatch?.[1],
        providerLabel: 'OpenAI',
        modelLabel: 'Codex',
      }
    }
    return null
  }

  async checkAvailability(): Promise<string | null> {
    try {
      const result = await platform().app.checkCommandExists('codex') as any
      if (result?.exists) return null
      return 'Codex CLI not found on PATH. Install it with: npm install -g @openai/codex'
    } catch {
      return null
    }
  }

  async createSession(config: LLMSessionConfig): Promise<LLMSession> {
    const {
      sessionId,
      modelId,
      cwd,
      cols = 120,
      rows = 30,
      env = {},
      systemPrompt,
      initialPrompt,
      resume,
      providerOptions = {},
      agentId,
      agentName,
    } = config

    const resolvedModelId = resolveCodexModelId(modelId)

    // Default: bypass approvals + sandbox (mirrors Claude's --dangerously-skip-permissions).
    // 'auto' mode: on-failure approvals with workspace-write sandbox.
    const permissionMode = (providerOptions.permissionMode as string) ?? 'bypass'
    const permArgs = permissionMode === 'auto'
      ? ['--ask-for-approval', 'on-failure', '--sandbox', 'workspace-write']
      : ['--dangerously-bypass-approvals-and-sandbox']

    // Resume path: `codex resume <session-id>` (positional UUID). Skip
    // initialPrompt — the rollout transcript IS the conversation context.
    // Fresh path: `codex [PROMPT]` with positional initial prompt.
    const args = resume
      ? [
          'resume',
          ...permArgs,
          ...(resolvedModelId ? ['--model', resolvedModelId] : []),
          sessionId,
        ]
      : [
          ...permArgs,
          ...(resolvedModelId ? ['--model', resolvedModelId] : []),
          ...(initialPrompt ? [initialPrompt] : []),
        ]

    // AGENTS.md handling — upsert our marker-delimited section so successive
    // spawns replace (not stack) the prompt, and any user content around it
    // is preserved. Track whether the file existed pre-injection so cleanup
    // can remove it if we created it ourselves.
    let agentsMdExisted = false
    if (systemPrompt && cwd) {
      const agentsMdPath = path.join(cwd, 'AGENTS.md')
      let existing = ''
      try {
        existing = fs.readFileSync(agentsMdPath, 'utf8')
        agentsMdExisted = true
      } catch {
        existing = ''
        agentsMdExisted = false
      }
      fs.writeFileSync(agentsMdPath, injectPixelCitySection(existing, systemPrompt), 'utf8')
    }

    // For fresh spawns, snapshot the existing rollout IDs BEFORE we start
    // codex. After the PTY launches, claimNextCodexSession will diff this
    // snapshot to identify the new rollout file and write our index entry.
    // (Codex mints session IDs server-side, so we only learn the real ID
    // after the rollout file appears on disk.)
    const priorIdsForClaim = !resume && cwd ? snapshotCodexSessionIds(cwd) : null

    // Codex refuses to start if CODEX_HOME doesn't exist, so create it eagerly.
    const codexHome = cwd ? path.join(cwd, '.pixelcity', 'codex') : null
    if (codexHome) {
      fs.mkdirSync(codexHome, { recursive: true })
    }

    // Refresh MCP configs (.mcp.json, codex config.toml)
    // before spawn so the agent picks up the latest launcher entries — including
    // any user extensions added to pixelcity.mcp.json since the project opened.
    // Per-agent identity is delivered via the system prompt (AGENTS.md), not env,
    // because codex doesn't reliably forward parent env to MCP children.
    if (cwd) {
      try {
        await platform().workspace.ensureMcpConfig(cwd)
      } catch (err) {
        console.error('[CodexCliProvider] ensureMcpConfig failed for', cwd, err)
      }
    }

    const ptyId: number = await platform().pty.create({
      cols,
      rows,
      command: 'codex',
      args,
      cwd,
      env: codexHome
        ? { ...env, CODEX_HOME: codexHome }
        : env,
    } as any)

    if (priorIdsForClaim && cwd) {
      claimNextCodexSession(cwd, priorIdsForClaim, {
        agentId: agentId ?? '',
        agentName: agentName ?? '',
        modelId: resolvedModelId,
        spawnedAt: new Date().toISOString(),
      })
    }

    return new CodexCliSession({
      ptyId,
      sessionId,
      cwd,
      agentsMdExisted,
    })
  }
}
