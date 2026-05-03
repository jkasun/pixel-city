/**
 * Agent lifecycle tool definitions in OpenAI tool-calling format.
 *
 * These describe the locally-handled tools (task_done, request_clarification)
 * that any LLM session must expose to the model in addition to whatever
 * external MCP servers provide.
 */

export interface OpenAITool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export const MCP_TOOLS: OpenAITool[] = [
  {
    type: 'function',
    function: {
      name: 'task_done',
      description: 'Signal that the assigned task is fully complete. Provide a brief summary of what was done.',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'Brief summary of what was accomplished.',
          },
        },
        required: ['summary'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'request_clarification',
      description: 'Signal that you are blocked and need a human to clarify before you can continue. Use sparingly — try to make a reasonable judgement first.',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'The question that needs clarification.',
          },
        },
        required: ['question'],
      },
    },
  },
]
