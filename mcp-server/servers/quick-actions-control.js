#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { sendCommand } from '../shared/ws-client.js'
import {
  SELF_AGENT_ID,
  SELF_AGENT_NAME,
  SELF_PROJECT_DIR,
  SELF_BUILDING_ID,
} from '../shared/env.js'
import { generateAgentId, resolveAgentId } from '../shared/helpers.js'

const server = new McpServer({
  name: 'pixel-city-quick-actions',
  version: '1.0.0',
})

// ── Config helpers ──────────────────────────────────────────────

function getConfigPath(projectDir) {
  if (projectDir) return path.join(projectDir, '.pixelcity', 'config.json')
  if (SELF_PROJECT_DIR) return path.join(SELF_PROJECT_DIR, '.pixelcity', 'config.json')
  throw new Error('No project directory available — set PIXEL_CITY_PROJECT_DIR or pass projectDir')
}

function readConfig(projectDir) {
  const p = getConfigPath(projectDir)
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch { /* ignore */ }
  return { cityInstructions: '', officeInstructions: {} }
}

function writeConfig(projectDir, data) {
  const p = getConfigPath(projectDir)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8')
}

function getBuildingKey(buildingId) {
  return buildingId || SELF_BUILDING_ID || 'default'
}

function getQuickActions(projectDir, buildingId) {
  const config = readConfig(projectDir)
  const key = getBuildingKey(buildingId)
  const raw = config.quickActions?.[key] ?? []
  return raw.map(a => ({ ...a, type: a.type || 'ai' }))
}

function saveQuickActions(projectDir, buildingId, actions) {
  const config = readConfig(projectDir)
  if (!config.quickActions) config.quickActions = {}
  const key = getBuildingKey(buildingId)
  config.quickActions[key] = actions
  writeConfig(projectDir, config)
}

// ── Tools ───────────────────────────────────────────────────────

server.tool(
  'list_quick_actions',
  'List all quick actions for the current office/building. Quick actions are reusable shortcuts that either spawn an AI agent with a prompt or run a terminal command.',
  {
    buildingId: z.string().optional().describe('Building ID (defaults to current building)'),
    projectDir: z.string().optional().describe('Project directory (defaults to PIXEL_CITY_PROJECT_DIR)'),
  },
  async (params) => {
    const actions = getQuickActions(params.projectDir, params.buildingId)
    return { content: [{ type: 'text', text: JSON.stringify(actions, null, 2) }] }
  }
)

server.tool(
  'add_quick_action',
  'Add a new quick action to the office sidebar. Type "ai" spawns a new agent with the description as its prompt. Type "terminal" runs the command in a shell terminal.',
  {
    title: z.string().describe('Short title for the quick action (e.g. "Run tests", "Deploy staging")'),
    description: z.string().describe('For AI type: the prompt/task for the spawned agent. For terminal type: a description of what the command does.'),
    type: z.enum(['ai', 'terminal']).describe('Action type — "ai" spawns an agent, "terminal" runs a shell command'),
    command: z.string().optional().describe('Shell command to run (required when type is "terminal")'),
    buildingId: z.string().optional().describe('Building ID (defaults to current building)'),
    projectDir: z.string().optional().describe('Project directory (defaults to PIXEL_CITY_PROJECT_DIR)'),
  },
  async (params) => {
    if (params.type === 'terminal' && !params.command) {
      return { content: [{ type: 'text', text: 'Error: "command" is required when type is "terminal"' }], isError: true }
    }

    const actions = getQuickActions(params.projectDir, params.buildingId)
    const action = {
      id: crypto.randomUUID(),
      title: params.title,
      description: params.description,
      type: params.type,
      ...(params.command ? { command: params.command } : {}),
    }
    actions.push(action)
    saveQuickActions(params.projectDir, params.buildingId, actions)

    return { content: [{ type: 'text', text: JSON.stringify({ success: true, action }) }] }
  }
)

server.tool(
  'update_quick_action',
  'Update an existing quick action by ID.',
  {
    id: z.string().describe('Quick action ID to update'),
    title: z.string().optional().describe('New title'),
    description: z.string().optional().describe('New description/prompt'),
    type: z.enum(['ai', 'terminal']).optional().describe('New action type'),
    command: z.string().optional().describe('New shell command (for terminal type)'),
    buildingId: z.string().optional().describe('Building ID (defaults to current building)'),
    projectDir: z.string().optional().describe('Project directory (defaults to PIXEL_CITY_PROJECT_DIR)'),
  },
  async (params) => {
    const actions = getQuickActions(params.projectDir, params.buildingId)
    const idx = actions.findIndex(a => a.id === params.id)
    if (idx === -1) {
      return { content: [{ type: 'text', text: `Error: Quick action "${params.id}" not found` }], isError: true }
    }

    const existing = actions[idx]
    if (params.title !== undefined) existing.title = params.title
    if (params.description !== undefined) existing.description = params.description
    if (params.type !== undefined) existing.type = params.type
    if (params.command !== undefined) existing.command = params.command

    if (existing.type === 'terminal' && !existing.command) {
      return { content: [{ type: 'text', text: 'Error: "command" is required when type is "terminal"' }], isError: true }
    }
    if (existing.type === 'ai') delete existing.command

    actions[idx] = existing
    saveQuickActions(params.projectDir, params.buildingId, actions)

    return { content: [{ type: 'text', text: JSON.stringify({ success: true, action: existing }) }] }
  }
)

server.tool(
  'remove_quick_action',
  'Remove a quick action by ID.',
  {
    id: z.string().describe('Quick action ID to remove'),
    buildingId: z.string().optional().describe('Building ID (defaults to current building)'),
    projectDir: z.string().optional().describe('Project directory (defaults to PIXEL_CITY_PROJECT_DIR)'),
  },
  async (params) => {
    const actions = getQuickActions(params.projectDir, params.buildingId)
    const idx = actions.findIndex(a => a.id === params.id)
    if (idx === -1) {
      return { content: [{ type: 'text', text: `Error: Quick action "${params.id}" not found` }], isError: true }
    }

    const removed = actions.splice(idx, 1)[0]
    saveQuickActions(params.projectDir, params.buildingId, actions)

    return { content: [{ type: 'text', text: JSON.stringify({ success: true, removed }) }] }
  }
)

server.tool(
  'run_quick_action',
  'Run a quick action by ID. AI actions spawn a new agent with the description as its task. Terminal actions run the command in the calling agent\'s terminal via PTY input.',
  {
    id: z.string().describe('Quick action ID to run'),
    buildingId: z.string().optional().describe('Building ID (defaults to current building)'),
    projectDir: z.string().optional().describe('Project directory (defaults to PIXEL_CITY_PROJECT_DIR)'),
  },
  async (params) => {
    const actions = getQuickActions(params.projectDir, params.buildingId)
    const action = actions.find(a => a.id === params.id)
    if (!action) {
      return { content: [{ type: 'text', text: `Error: Quick action "${params.id}" not found` }], isError: true }
    }

    if (action.type === 'terminal') {
      if (!action.command) {
        return { content: [{ type: 'text', text: 'Error: Terminal action has no command' }], isError: true }
      }
      // Send the command to the current agent's PTY
      const agentId = SELF_AGENT_ID
      if (!agentId) {
        return { content: [{ type: 'text', text: 'Error: No agent ID — cannot send PTY input without PIXEL_CITY_AGENT_ID' }], isError: true }
      }
      const result = await sendCommand('send_pty_input', { id: agentId, message: action.command, pressEnter: true })
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, type: 'terminal', command: action.command, result }) }] }
    }

    // AI type — spawn a new agent with the description as its prompt
    const agentId = generateAgentId()
    const palette = Math.floor(Math.random() * 8)
    const spawnParams = {
      id: agentId,
      name: action.title,
      model: 'sonnet',
      palette,
      buildingId: getBuildingKey(params.buildingId),
      prompt: action.description,
    }

    const result = await sendCommand('spawn_agent', spawnParams)
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, type: 'ai', agentId, title: action.title, result }) }] }
  }
)

// --- Start ---
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('[pixel-city-quick-actions] MCP server started\n')
}

main().catch((err) => {
  process.stderr.write(`[pixel-city-quick-actions] Fatal: ${err.message}\n`)
  process.exit(1)
})
