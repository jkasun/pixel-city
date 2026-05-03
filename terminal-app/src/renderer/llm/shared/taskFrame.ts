// ── Task Frame Wrapper ──────────────────────────────────────────────
// Wraps user messages in structured task/instruction frames for API-based
// agents. This shifts the interaction from "chat with LLM" to "assign task
// to agent", which keeps models (especially smaller ones) on track.

/**
 * Wrap the first user message as a task assignment.
 * The agent should begin executing immediately with tool calls.
 */
export function wrapAsTaskAssignment(text: string): string {
  return `<task>
Execute this task to completion. Begin immediately with tool calls.
Do not describe what you will do — just do it.
Do not output a plan or summary — start working.

${text}

When the task is fully complete, call the \`task_done\` tool with a brief summary.
If you need human input to proceed, call \`request_clarification\` with your question.
</task>`
}

/**
 * Wrap follow-up user messages as additional instructions.
 * Lighter than the initial frame — just directs the agent to continue.
 */
export function wrapAsFollowUp(text: string): string {
  return `<instruction>
${text}

Continue working. Call task_done when the full task is complete.
</instruction>`
}
