#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { sendCommand } from '../shared/ws-client.js'
import { withProjectDir, resolveSelfAssigneeKey } from '../shared/helpers.js'

const server = new McpServer({
  name: 'pixel-city-board-control',
  version: '1.0.0',
})

// Get board (paginated)
server.tool(
  'get_board',
  'Get the task board for a building. Returns tasks paginated to avoid large responses. Use column filter to fetch specific columns. Returns compact results by default (no changelog, subtask counts only).',
  {
    buildingId: z.string().optional().describe('Building ID (defaults to current office)'),
    projectDir: z.string().optional().describe('Project directory for scoping'),
    column: z.string().optional().describe('Filter by column key (e.g. "planning", "planned", "todo", "progress", "testing", "closed"). If omitted, returns all columns.'),
    limit: z.number().optional().describe('Max number of tasks to return (default: 20)'),
    offset: z.number().optional().describe('Number of tasks to skip (default: 0). Use with limit for pagination.'),
    verbose: z.boolean().optional().describe('If true, include full changelog and subtask details. Default: false (compact mode).'),
  },
  async (params) => {
    const result = await sendCommand('get_board', withProjectDir(params))
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// List tasks (with optional filters)
server.tool(
  'list_tasks',
  'List tasks on the board, optionally filtered by column or assignee. Pass assignee "self" to list your own tasks. By default returns compact results (no changelog or full subtask lists). Use verbose=true for full details.',
  {
    buildingId: z.string().optional().describe('Building ID'),
    projectDir: z.string().optional().describe('Project directory'),
    column: z.string().optional().describe('Filter by column key (e.g. "planning", "planned", "todo", "progress", "testing", "closed")'),
    assignee: z.string().optional().describe('Filter by assignee key (e.g. "emp:alice", "agent:3", or "self" for own tasks)'),
    verbose: z.boolean().optional().describe('If true, include full changelog and subtask details. Default: false (compact mode — strips changelog, replaces subtasks with counts)'),
  },
  async (params) => {
    const resolved = withProjectDir({ ...params })
    if (resolved.assignee === 'self') {
      const selfKey = resolveSelfAssigneeKey()
      if (!selfKey) throw new Error('Cannot resolve self assignee — no PIXEL_CITY_EMPLOYEE_ID or PIXEL_CITY_AGENT_ID set')
      resolved.assignee = selfKey
    }
    const result = await sendCommand('list_tasks', resolved)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// Get a single task or story by ID
server.tool(
  'get_task',
  'Get full details of a single task or story by ID, including changelog and subtasks for stories.',
  {
    taskId: z.string().describe('Task ID (e.g. "PC-43")'),
    buildingId: z.string().optional().describe('Building ID'),
    projectDir: z.string().optional().describe('Project directory'),
  },
  async (params) => {
    const result = await sendCommand('get_task', withProjectDir(params))
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// Create task
server.tool(
  'create_task',
  'Create a new task or story on the board. Stories have their own sub-board for subtasks. Assignee defaults to self if not specified. Assignee must be currently in the office.',
  {
    title: z.string().describe('Task title'),
    type: z.enum(['task', 'story']).optional().describe('Type: "task" (default) or "story" (has its own sub-board for subtasks)'),
    buildingId: z.string().optional().describe('Building ID'),
    projectDir: z.string().optional().describe('Project directory'),
    column: z.enum(['planning', 'planned', 'backlog']).optional().describe('Column key to add to (default: "planning"). Tasks can only be created in "planning", "planned", or "backlog" columns.'),
    description: z.string().optional().describe('Task description (markdown supported)'),
    assignee: z.string().optional().describe('Assignee key (e.g. "emp:alice", "agent:3", or "self"). Defaults to self.'),
    tags: z.array(z.object({
      label: z.string(),
      color: z.enum(['accent', 'warm', 'error']).optional(),
    })).optional().describe('Tags for the task'),
  },
  async (params) => {
    const resolved = withProjectDir({ ...params })
    if (!resolved.assignee || resolved.assignee === 'self') {
      resolved.assignee = resolveSelfAssigneeKey() ?? undefined
    }
    resolved._callerKey = resolveSelfAssigneeKey() ?? 'mcp'
    const result = await sendCommand('create_task', resolved)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// Update task
server.tool(
  'update_task',
  'Update an existing task (title, description, assignee, tags). Assignee must be currently in the office.',
  {
    taskId: z.string().describe('Task ID (e.g. "PC-1")'),
    buildingId: z.string().optional().describe('Building ID'),
    projectDir: z.string().optional().describe('Project directory'),
    title: z.string().optional().describe('New title'),
    description: z.string().optional().describe('New description'),
    assignee: z.string().optional().describe('New assignee key (e.g. "emp:alice", "agent:3", or "self")'),
    tags: z.array(z.object({
      label: z.string(),
      color: z.enum(['accent', 'warm', 'error']).optional(),
    })).optional().describe('New tags'),
  },
  async (params) => {
    const resolved = withProjectDir({ ...params })
    if (resolved.assignee === 'self') {
      resolved.assignee = resolveSelfAssigneeKey() ?? undefined
    }
    resolved._callerKey = resolveSelfAssigneeKey() ?? 'mcp'
    const result = await sendCommand('update_task', resolved)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Move task between columns
server.tool(
  'move_task',
  'Move a task to a different column. Moving to "closed" is disabled via MCP. Moving to/from "backlog" skips adjacency validation.',
  {
    taskId: z.string().describe('Task ID (e.g. "PC-1")'),
    toColumn: z.string().describe('Target column key (e.g. "planning", "planned", "todo", "progress", "testing", "backlog"). Note: moving to "closed" is not allowed via MCP. Moving to/from "backlog" skips adjacency validation.'),
    buildingId: z.string().optional().describe('Building ID'),
    projectDir: z.string().optional().describe('Project directory'),
  },
  async (params) => {
    if (params.toColumn === 'closed') {
      throw new Error('Moving tasks to "closed" is disabled via MCP. Use the Pixel City interface directly instead.')
    }

    const resolved = withProjectDir({ ...params })
    resolved._callerKey = resolveSelfAssigneeKey() ?? 'mcp'
    try {
      const result = await sendCommand('move_task', resolved)
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    } catch (err) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: true, message: err.message }) }], isError: true }
    }
  }
)

// Archive a task
server.tool(
  'archive_task',
  'Archive a task (moves it to a hidden archive, removing it from the board). Typically used for closed tasks to keep the board clean.',
  {
    taskId: z.string().describe('Task ID (e.g. "PC-1")'),
    buildingId: z.string().optional().describe('Building ID'),
    projectDir: z.string().optional().describe('Project directory'),
  },
  async (params) => {
    const resolved = withProjectDir({ ...params })
    resolved._callerKey = resolveSelfAssigneeKey() ?? 'mcp'
    const result = await sendCommand('archive_task', resolved)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Archive all closed tasks
server.tool(
  'archive_all_closed',
  'Archive all tasks currently in the "closed" column. Moves them to a hidden archive to keep the board clean.',
  {
    buildingId: z.string().optional().describe('Building ID'),
    projectDir: z.string().optional().describe('Project directory'),
  },
  async (params) => {
    const resolved = withProjectDir({ ...params })
    resolved._callerKey = resolveSelfAssigneeKey() ?? 'mcp'
    const result = await sendCommand('archive_all_closed', resolved)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Restore a task from archive
server.tool(
  'restore_task',
  'Restore an archived task back to the board. By default restores to "closed" column.',
  {
    taskId: z.string().describe('Task ID (e.g. "PC-1")'),
    toColumn: z.string().optional().describe('Column to restore to (default: "closed")'),
    buildingId: z.string().optional().describe('Building ID'),
    projectDir: z.string().optional().describe('Project directory'),
  },
  async (params) => {
    const resolved = withProjectDir({ ...params })
    resolved._callerKey = resolveSelfAssigneeKey() ?? 'mcp'
    const result = await sendCommand('restore_task', resolved)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// List archived tasks
server.tool(
  'list_archived_tasks',
  'List all archived tasks. These are tasks that were moved to the archive to keep the board clean.',
  {
    buildingId: z.string().optional().describe('Building ID'),
    projectDir: z.string().optional().describe('Project directory'),
    verbose: z.boolean().optional().describe('If true, include full details. Default: false (compact mode).'),
  },
  async (params) => {
    const result = await sendCommand('list_archived_tasks', withProjectDir(params))
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// --- Subtask tools (inside stories) ---

// Create subtask inside a story
server.tool(
  'create_subtask',
  'Create a subtask inside a story. The subtask is added to the story\'s sub-board. Assignee must be currently in the office.',
  {
    storyId: z.string().describe('Parent story ID (e.g. "PC-3")'),
    title: z.string().describe('Subtask title'),
    buildingId: z.string().optional().describe('Building ID'),
    projectDir: z.string().optional().describe('Project directory'),
    column: z.enum(['planning', 'planned']).optional().describe('Column key to add to (default: "planning"). Subtasks can only be created in "planning" or "planned" columns.'),
    description: z.string().optional().describe('Subtask description'),
    assignee: z.string().optional().describe('Assignee key (e.g. "emp:alice", "agent:3", or "self"). Defaults to self.'),
    tags: z.array(z.object({
      label: z.string(),
      color: z.enum(['accent', 'warm', 'error']).optional(),
    })).optional().describe('Tags for the subtask'),
  },
  async (params) => {
    const resolved = withProjectDir({ ...params })
    if (!resolved.assignee || resolved.assignee === 'self') {
      resolved.assignee = resolveSelfAssigneeKey() ?? undefined
    }
    resolved._callerKey = resolveSelfAssigneeKey() ?? 'mcp'
    const result = await sendCommand('create_subtask', resolved)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// List subtasks in a story
server.tool(
  'list_subtasks',
  'List subtasks inside a story, optionally filtered by column or assignee.',
  {
    storyId: z.string().describe('Parent story ID (e.g. "PC-3")'),
    buildingId: z.string().optional().describe('Building ID'),
    projectDir: z.string().optional().describe('Project directory'),
    column: z.string().optional().describe('Filter by column key'),
    assignee: z.string().optional().describe('Filter by assignee key (use "self" for own subtasks)'),
  },
  async (params) => {
    const resolved = withProjectDir({ ...params })
    if (resolved.assignee === 'self') {
      const selfKey = resolveSelfAssigneeKey()
      if (!selfKey) throw new Error('Cannot resolve self assignee — no PIXEL_CITY_EMPLOYEE_ID or PIXEL_CITY_AGENT_ID set')
      resolved.assignee = selfKey
    }
    const result = await sendCommand('list_subtasks', resolved)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// Update subtask
server.tool(
  'update_subtask',
  'Update a subtask inside a story (title, description, assignee, tags). Assignee must be currently in the office.',
  {
    storyId: z.string().describe('Parent story ID (e.g. "PC-3")'),
    subtaskId: z.string().describe('Subtask ID (e.g. "PC-3-1")'),
    buildingId: z.string().optional().describe('Building ID'),
    projectDir: z.string().optional().describe('Project directory'),
    title: z.string().optional().describe('New title'),
    description: z.string().optional().describe('New description'),
    assignee: z.string().optional().describe('New assignee key'),
    tags: z.array(z.object({
      label: z.string(),
      color: z.enum(['accent', 'warm', 'error']).optional(),
    })).optional().describe('New tags'),
  },
  async (params) => {
    const resolved = withProjectDir({ ...params })
    if (resolved.assignee === 'self') {
      resolved.assignee = resolveSelfAssigneeKey() ?? undefined
    }
    resolved._callerKey = resolveSelfAssigneeKey() ?? 'mcp'
    const result = await sendCommand('update_subtask', resolved)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Move subtask between columns
server.tool(
  'move_subtask',
  'Move a subtask to a different column within its parent story\'s sub-board. Moving to "closed" is disabled via MCP.',
  {
    storyId: z.string().describe('Parent story ID (e.g. "PC-3")'),
    subtaskId: z.string().describe('Subtask ID (e.g. "PC-3-1")'),
    toColumn: z.string().describe('Target column key (e.g. "planning", "planned", "todo", "progress", "testing"). Note: moving to "closed" is not allowed via MCP.'),
    buildingId: z.string().optional().describe('Building ID'),
    projectDir: z.string().optional().describe('Project directory'),
  },
  async (params) => {
    if (params.toColumn === 'closed') {
      throw new Error('Moving subtasks to "closed" is disabled via MCP. Use the Pixel City interface directly instead.')
    }

    const resolved = withProjectDir({ ...params })
    resolved._callerKey = resolveSelfAssigneeKey() ?? 'mcp'
    try {
      const result = await sendCommand('move_subtask', resolved)
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    } catch (err) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: true, message: err.message }) }], isError: true }
    }
  }
)

// Delete subtask
server.tool(
  'delete_subtask',
  'Delete a subtask from a story\'s sub-board',
  {
    storyId: z.string().describe('Parent story ID (e.g. "PC-3")'),
    subtaskId: z.string().describe('Subtask ID (e.g. "PC-3-1")'),
    buildingId: z.string().optional().describe('Building ID'),
    projectDir: z.string().optional().describe('Project directory'),
  },
  async (params) => {
    const result = await sendCommand('delete_subtask', withProjectDir(params))
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// --- Start ---
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('[pixel-city-board-control] MCP server started\n')
}

main().catch((err) => {
  process.stderr.write(`[pixel-city-board-control] Fatal: ${err.message}\n`)
  process.exit(1)
})
