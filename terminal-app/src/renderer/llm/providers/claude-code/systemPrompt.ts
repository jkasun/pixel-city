// ── System Prompt Builder for Claude Code Provider ──────────────────
// Assembles the system prompt from hierarchical instruction sources:
// world → city → office → permanent employee → memories
// Extracted from OfficeContext.tsx to keep provider logic self-contained.

import worldInstructions from '../../../../../system-prompts/world-instructions.md?raw'
import permanentEmployeeInstructions from '../../../../../system-prompts/permanent-employee-instructions.md?raw'
import { platform } from '../../../platform/index.js'
import { buildWingName } from '@pixel-city/shared/utils/agentAddress'
import { employeeStore } from '../../../employee/EmployeeStore.js'

export interface SystemPromptConfig {
  /** This session's agent ID — embedded into the prompt so the agent can pass
   * `id` explicitly to MCP tools when env-based defaults aren't available
   * (Codex doesn't reliably forward parent env to MCP children). */
  agentId?: string
  /** This session's agent display name */
  agentName?: string
  /** Root project directory */
  projectDir: string
  /** Building ID for office-specific instructions */
  buildingId?: string
  /** Permanent employee ID (if applicable) */
  employeeId?: string
  /** Human-friendly handle for the permanent employee. Used for wing name and diary tool agent_id. */
  employeeHandle?: string
  /** Reserved for future cached values — kept so callers can pass a cache
   * shape without breaking. Currently unused; instructions are read from
   * their dedicated .md files at build time. */
  configCache?: Record<string, unknown> | null
}

/**
 * Build the full system prompt for a Claude Code agent session.
 * Reads city/office instructions from their dedicated `.pixelcity/*.md`
 * files, injects permanent employee instructions and level-1 memories if
 * applicable.
 */
export async function buildSystemPrompt(config: SystemPromptConfig): Promise<string> {
  const { agentId, agentName, projectDir, buildingId, employeeId, employeeHandle } = config

  // City instructions live in `~/.pixelcity/city-configuration.md` —
  // a single user-editable markdown file (OSS local-first).
  let resolvedCity: string | null = null
  try {
    const city = await platform().config.loadCityConfiguration()
    const text = city?.content?.trim()
    resolvedCity = text ? text : null
  } catch { /* fall back to null */ }

  // Office instructions live in `.pixelcity/office-instructions.md` —
  // a single user-editable markdown file (OSS local-first).
  let resolvedOffice: string | null = null
  try {
    const office = await platform().config.loadOfficeInstructions(projectDir)
    const text = office?.content?.trim()
    resolvedOffice = text ? text : null
  } catch { /* fall back to null */ }

  // Assemble instruction parts in priority order
  const parts: string[] = [worldInstructions]

  // Identity block — embedded so the agent can pass `id`, `buildingId`,
  // `projectDir` etc. explicitly to MCP tools. Required for Codex (which
  // doesn't reliably forward parent env to MCP children); harmless for Claude.
  if (agentId) {
    const identityLines: string[] = [
      `- Agent ID: \`${agentId}\``,
    ]
    if (agentName) identityLines.push(`- Name: ${agentName}`)
    if (buildingId) identityLines.push(`- Building ID: \`${buildingId}\``)
    if (employeeId) identityLines.push(`- Employee ID: \`${employeeId}\``)
    if (projectDir) identityLines.push(`- Project: \`${projectDir}\``)
    parts.push(
      `# Your Identity\n${identityLines.join('\n')}\n\n` +
      `Whenever an MCP tool accepts an \`id\` parameter, pass \`id: "${agentId}"\` explicitly — including tools that act on your own inbox or status (\`check_messages\`, \`read_message\`, \`list_messages\`, \`send_message\`, \`set_agent_working\`, \`set_agent_idle\`, \`show_current_status\`, etc.). ` +
      `When a tool needs project or building context, pass \`projectDir\` and \`buildingId\` explicitly using the values above.`
    )
  }

  if (resolvedCity) parts.push(resolvedCity)
  if (resolvedOffice) parts.push(resolvedOffice)

  // Permanent employee instructions + memories
  if (employeeId) {
    parts.push(permanentEmployeeInstructions)

    // Inject the employee's soul (from .pixelcity/agents/<id>/soul.md).
    // This is their identity prompt — role, personality, anything the user
    // edits in the file shows up here.
    const soul = employeeStore.get(employeeId)?.soul?.trim()
    if (soul) parts.push(`# Your Soul\n\n${soul}`)

    // Inject MemPalace wing identity so the employee knows their wing name.
    // Prefer the handle (unique per user) so agents with similar names don't
    // collapse their wings. Fall back to the raw employeeId for legacy
    // employees that were created before handles existed.
    const diaryAgentId = employeeHandle || employeeId
    const wingName = buildWingName(diaryAgentId)
    parts.push(
      `# Your MemPalace Identity\nYour wing in the memory palace is: **${wingName}**\nYour agent name for diary tools (pass as \`agent_id\` to mempalace_diary_*) is: **${diaryAgentId}**`
    )

    // ── Auto-load level-1 memories ──
    try {
      const memResult = await platform().config.readMemory(employeeId) as any
      if (memResult.success && memResult.memories.length > 0) {
        const memoryLines = memResult.memories.map(
          (m: { summary: string; content: string }) => `- **${m.summary}**: ${m.content}`
        )
        parts.push(
          `# Your Memories (Level 1 — Core)\nThese are your persistent memories from previous sessions:\n${memoryLines.join('\n')}`
        )
      }
    } catch { /* no memories to inject */ }

    // ── Auto-load MemPalace wake-up context ──
    try {
      const mp = await platform().config.readMempalace(projectDir, employeeHandle || employeeId)
      if (mp.success) {
        const wakeUpParts: string[] = []

        // Palace status
        if (mp.status) {
          const wingList = Object.entries(mp.status.wings)
            .map(([w, c]) => `${w}: ${c} drawers`)
            .join(', ')
          wakeUpParts.push(`**Palace:** ${mp.status.total_drawers} total drawers. Wings: ${wingList || 'empty'}`)
        }

        // Recent diary entries
        if (mp.diary && mp.diary.length > 0) {
          const diaryLines = mp.diary.map(
            (d: { date: string; topic: string; content: string }) =>
              `- [${d.date}] (${d.topic}): ${d.content}`
          )
          wakeUpParts.push(`**Your recent diary entries:**\n${diaryLines.join('\n')}`)
        }

        // Recent drawers (knowledge stored)
        if (mp.recent_drawers && mp.recent_drawers.length > 0) {
          const drawerLines = mp.recent_drawers.map(
            (d: { room: string; content: string }) =>
              `- [${d.room}]: ${d.content}`
          )
          wakeUpParts.push(`**Your recent stored knowledge:**\n${drawerLines.join('\n')}`)
        }

        if (wakeUpParts.length > 0) {
          parts.push(
            `# MemPalace Wake-Up (Auto-Loaded)\nThis context was loaded automatically from your memory palace. You do NOT need to call mempalace_status or mempalace_diary_read — it's already here.\n\n${wakeUpParts.join('\n\n')}`
          )
        }
      }
    } catch { /* mempalace not available */ }
  }

  return parts.join('\n\n')
}
