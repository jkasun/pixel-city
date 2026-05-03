#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { sendCommand } from '../shared/ws-client.js'
import {
  SELF_AGENT_ID,
  SELF_AGENT_NAME,
  SELF_PROJECT_DIR,
  SELF_EMPLOYEE_ID,
  SELF_BUILDING_ID,
  SELF_WORKSPACE_DIR,
} from '../shared/env.js'
import {
  generateAgentId,
  resolveAgentId,
  withProjectDir,
  buildInstructions,
} from '../shared/helpers.js'

const server = new McpServer({
  name: 'pixel-city-office-control',
  version: '1.0.0',
})

// Whoami — returns this session's agent identity
server.tool(
  'whoami',
  'Get this agent\'s Pixel City identity (agent ID and name). Returns null values if not spawned by Pixel City.',
  {},
  async () => {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          agentId: SELF_AGENT_ID,
          agentName: SELF_AGENT_NAME,
          hasIdentity: SELF_AGENT_ID !== null,
          projectDir: SELF_PROJECT_DIR,
          buildingId: SELF_BUILDING_ID,
          employeeId: SELF_EMPLOYEE_ID,
          workspaceDir: SELF_WORKSPACE_DIR,
          assigneeKey: SELF_EMPLOYEE_ID ? `emp:${SELF_EMPLOYEE_ID}` : SELF_AGENT_ID !== null ? `agent:${SELF_AGENT_ID}` : null,
        }),
      }],
    }
  }
)

// Ping — check if Pixel City is running
server.tool(
  'ping',
  'Check if Pixel City is running and responsive',
  {},
  async () => {
    try {
      const result = await sendCommand('ping')
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    } catch (err) {
      return { content: [{ type: 'text', text: `Pixel City is not available: ${err.message}` }], isError: true }
    }
  }
)

// List agents
server.tool(
  'list_agents',
  'List all agents currently in the Pixel City office',
  {},
  async () => {
    const result = await sendCommand('list_agents')
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// Get office info
server.tool(
  'get_office_info',
  'Get information about the current office (size, seat count, agent count)',
  {},
  async () => {
    const result = await sendCommand('get_office_info')
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// Spawn agent
server.tool(
  'spawn_agent',
  'Spawn a new agent in the Pixel City office',
  {
    name: z.string().optional().describe('Display name for the agent'),
    model: z.string().optional().describe('Claude model (e.g. "sonnet", "opus")'),
    palette: z.number().optional().describe('Skin palette index (0-5)'),
    buildingId: z.string().optional().describe('Building to spawn in'),
    prompt: z.string().optional().describe('Initial prompt/task to send to the agent after spawning (e.g. "Complete PC-43: MCP spawn agent with pre prompt")'),
  },
  async (params) => {
    const id = generateAgentId()
    const resolved = withProjectDir({ ...params })

    // City + office instructions are read from their `.md` files inside
    // buildInstructions. City config is global (`~/.pixelcity/`); office
    // instructions are project-scoped.
    const enhancedPrompt = buildInstructions(null, resolved.projectDir, resolved.prompt)

    const spawnParams = {
      id,
      name: resolved.name,
      model: resolved.model,
      palette: resolved.palette,
      buildingId: resolved.buildingId,
      prompt: enhancedPrompt,
    }

    const result = await sendCommand('spawn_agent', spawnParams)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Remove agent
server.tool(
  'remove_agent',
  'Remove an agent from the Pixel City office',
  {
    id: z.string().describe('Agent ID to remove'),
  },
  async (params) => {
    const result = await sendCommand('remove_agent', params)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Set agent to working mode
server.tool(
  'set_agent_working',
  'Signal that this Claude Code session is actively working (typing, running tools). The agent character will sit at their desk and type. Call this when you start working on a task. If no id is provided, uses this session\'s own agent ID.',
  {
    id: z.string().optional().describe('Agent ID (defaults to own agent ID)'),
  },
  async (params) => {
    const id = resolveAgentId(params)
    const result = await sendCommand('set_agent_working', { id })
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Set agent to idle mode
server.tool(
  'set_agent_idle',
  'Signal that this Claude Code session is done working and waiting for user input. The agent character will stop typing and wander around the office. Call this when you finish a task or are waiting for user action. If no id is provided, uses this session\'s own agent ID.',
  {
    id: z.string().optional().describe('Agent ID (defaults to own agent ID)'),
  },
  async (params) => {
    const id = resolveAgentId(params)
    const result = await sendCommand('set_agent_idle', { id })
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Show current status
server.tool(
  'show_current_status',
  'Display a short status text above the agent showing what specific part of the task they are working on (e.g. "Reading config files", "Writing tests", "Fixing bug in auth module"). If no id is provided, uses this session\'s own agent ID.',
  {
    id: z.string().optional().describe('Agent ID (defaults to own agent ID)'),
    text: z.string().describe('Short status text describing current activity'),
  },
  async (params) => {
    const id = resolveAgentId(params)
    const result = await sendCommand('show_current_status', { id, text: params.text })
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// Send PTY input to an agent's terminal session
server.tool(
  'send_pty_input',
  'Send text input to an agent\'s terminal (PTY) session. The text is typed into the terminal as if a user typed it. By default, a newline (Enter) is appended. Use this to send commands or messages to a running Claude Code session.',
  {
    id: z.string().optional().describe('Agent ID (defaults to own agent ID)'),
    message: z.string().describe('Text to send to the terminal'),
    pressEnter: z.boolean().optional().describe('Whether to append a newline (Enter) after the message (default: true)'),
  },
  async (params) => {
    const id = resolveAgentId(params)
    const result = await sendCommand('send_pty_input', { id, message: params.message, pressEnter: params.pressEnter ?? true })
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// ── Dynamic Plugins ─────────────────────────────────────────────────

server.tool(
  'plugin_guide',
  'Get the complete guide for creating Pixel City plugins. Read this BEFORE creating or installing a plugin. Returns documentation on directory structure, plugin.json manifest format, index.html requirements, the window.pixelCity bridge API, state management, tool definitions, and examples.',
  {},
  async () => {
    const guide = `# Pixel City Plugin Development Guide

## Overview
Plugins appear as tabs in the office sidebar. Each plugin has its own sandboxed iframe UI with access to the \`window.pixelCity\` bridge API for state management and inter-agent communication.

## Directory Structure
Create a directory with two files:

\`\`\`
my-plugin/
  plugin.json    ← manifest (required)
  index.html     ← UI (required)
\`\`\`

## plugin.json — Manifest

\`\`\`json
{
  "name": "My Plugin",
  "icon": "🎮",
  "description": "What this plugin does",
  "tools": [
    {
      "name": "do_something",
      "description": "Description of what this tool does",
      "inputSchema": {
        "type": "object",
        "properties": {
          "param1": { "type": "string", "description": "A parameter" }
        },
        "required": ["param1"]
      }
    }
  ],
  "initialState": {
    "counter": 0,
    "items": []
  }
}
\`\`\`

Fields:
- **name** (required): Display name shown in sidebar tab
- **icon** (optional, default "🔌"): Emoji icon for the sidebar tab
- **description** (optional): What the plugin does
- **tools** (optional): Array of tool definitions that agents can call via \`plugin_call\`
- **initialState** (optional): Initial state object, persisted to database

## index.html — Plugin UI

Write a complete HTML document. It runs in a sandboxed iframe (no access to parent DOM or cookies). The \`window.pixelCity\` API is automatically injected.

### window.pixelCity API

**State Management** (persisted to database, shared across all viewers):
- \`window.pixelCity.getState()\` — returns current state object
- \`window.pixelCity.setState(newState)\` — replaces entire state, syncs to database
- \`window.pixelCity.onStateChange((state) => { ... })\` — subscribe to state changes. Returns unsubscribe function.

**Context** (read-only info about the office):
- \`window.pixelCity.context\` — object with: \`{ agentIds, agentNames, buildingId, activeAgentId }\`
- \`window.pixelCity.onContextChange((ctx) => { ... })\` — subscribe to context updates

**Host Actions:**
- \`window.pixelCity.showNotification(message, level)\` — show a notification (level: "info", "warn", "error")
- \`window.pixelCity.selectAgent(agentId)\` — select an agent in the office view
- \`window.pixelCity.switchToPlugin(pluginId)\` — switch to another plugin tab
- \`window.pixelCity.sendPtyInput(agentId, message, pressEnter?)\` — send text to an agent's terminal (like typing a command). \`pressEnter\` defaults to true. Returns a promise.
- \`window.pixelCity.listAgents()\` — get list of all agents in the office. Returns a promise with agent details.

**Tool Call Handling** (for agent-callable tools):
- \`window.pixelCity.onToolCall((toolName, params) => { ... return result })\` — register handler for incoming tool calls from agents

### Styling Tips
- Use dark theme colors (the office UI is dark): background \`#1a1a2e\` or \`#16213e\`, text \`#e0e0e0\`
- Use \`font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif\`
- The iframe fills the full panel area — use \`height: 100vh\` for full height

## Example: Simple Counter Plugin

**plugin.json:**
\`\`\`json
{
  "name": "Counter",
  "icon": "🔢",
  "description": "A shared click counter",
  "initialState": { "count": 0 }
}
\`\`\`

**index.html:**
\`\`\`html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { background: #1a1a2e; color: #e0e0e0; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    button { padding: 12px 24px; font-size: 18px; cursor: pointer; background: #4a6fa5; color: white; border: none; border-radius: 8px; }
    button:hover { background: #5a8fc5; }
  </style>
</head>
<body>
  <h1 id="display">Count: 0</h1>
  <button onclick="increment()">Click me!</button>
  <script>
    window.pixelCity.onStateChange(function(state) {
      document.getElementById('display').textContent = 'Count: ' + state.count;
    });

    function increment() {
      var s = window.pixelCity.getState();
      window.pixelCity.setState({ count: s.count + 1 });
    }

    // Initialize display
    var s = window.pixelCity.getState();
    document.getElementById('display').textContent = 'Count: ' + (s.count || 0);
  </script>
</body>
</html>
\`\`\`

## Example: Plugin with Agent-Callable Tools

**plugin.json:**
\`\`\`json
{
  "name": "Tic Tac Toe",
  "icon": "🎮",
  "description": "Two agents play tic-tac-toe",
  "tools": [
    {
      "name": "make_move",
      "description": "Place X or O on the board",
      "inputSchema": {
        "type": "object",
        "properties": {
          "row": { "type": "number", "description": "Row (0-2)" },
          "col": { "type": "number", "description": "Column (0-2)" }
        },
        "required": ["row", "col"]
      }
    }
  ],
  "initialState": {
    "board": [[null,null,null],[null,null,null],[null,null,null]],
    "turn": "X",
    "winner": null
  }
}
\`\`\`

In index.html, handle tool calls:
\`\`\`html
<script>
  window.pixelCity.onToolCall(function(toolName, params) {
    if (toolName === 'make_move') {
      var state = window.pixelCity.getState();
      if (state.board[params.row][params.col]) throw new Error('Cell already taken');
      state.board[params.row][params.col] = state.turn;
      state.turn = state.turn === 'X' ? 'O' : 'X';
      window.pixelCity.setState(state);
      return { success: true, board: state.board };
    }
  });
</script>
\`\`\`

Agents call tools via: \`plugin_call({ pluginId: "dyn-tic-tac-toe", action: "make_move", params: { row: 1, col: 1 } })\`

## Installation
After creating the directory, install with:
\`install_plugin({ directory: "/absolute/path/to/my-plugin" })\`

## MCP Tools for Plugin Management
- \`install_plugin\` — Install from a directory
- \`create_plugin\` — Create with inline HTML (for simple plugins)
- \`update_plugin\` — Update HTML, tools, name, etc.
- \`remove_plugin\` — Delete a plugin
- \`list_plugins\` — List all plugins in the office
- \`get_plugin_state\` / \`set_plugin_state\` — Read/write plugin state
- \`plugin_call\` — Call a tool defined by a plugin
`
    return { content: [{ type: 'text', text: guide }] }
  }
)

server.tool(
  'install_plugin',
  'Install a plugin from a local directory (like a Chrome extension). The directory must contain plugin.json (manifest with name, icon, description, tools, initialState) and index.html (the UI). The plugin appears as a new tab in the sidebar. Use window.pixelCity API inside the HTML for state management and tool handling.',
  {
    directory: z.string().describe('Absolute path to the plugin directory containing plugin.json and index.html'),
    id: z.string().optional().describe('Plugin ID (auto-generated from name if omitted)'),
    buildingId: z.string().optional().describe('Building ID (defaults to current building)'),
    agentId: z.string().optional().describe('Creator agent ID (defaults to self)'),
  },
  async (params) => {
    const result = await sendCommand('install_plugin', {
      ...params,
      buildingId: params.buildingId || SELF_BUILDING_ID,
      agentId: params.agentId || SELF_AGENT_ID,
    })
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'create_plugin',
  'Create a dynamic plugin for this office. The plugin appears as a new tab in the sidebar with its own UI (rendered in a sandboxed iframe). Use window.pixelCity API inside the HTML for state management and tool handling. The plugin is scoped to the current building.',
  {
    name: z.string().describe('Plugin display name'),
    description: z.string().describe('Description of the plugin'),
    icon: z.string().describe('Emoji icon for the sidebar tab (e.g. "🎮")'),
    html: z.string().describe('Full HTML document for the plugin UI. Use window.pixelCity.onStateChange, window.pixelCity.setState(), window.pixelCity.getState(), and window.pixelCity.onToolCall inside <script> tags.'),
    id: z.string().optional().describe('Plugin ID (auto-generated from name if omitted)'),
    tools: z.array(z.object({
      name: z.string().describe('Tool name'),
      description: z.string().describe('Tool description'),
      inputSchema: z.record(z.string(), z.any()).describe('JSON Schema for parameters'),
    })).optional().describe('Custom tools this plugin exposes via plugin_call'),
    initialState: z.record(z.string(), z.any()).optional().describe('Initial state (persisted, accessible via pixelCity.getState/setState)'),
    buildingId: z.string().optional().describe('Building ID (defaults to current building)'),
    agentId: z.string().optional().describe('Creator agent ID (defaults to self)'),
  },
  async (params) => {
    const result = await sendCommand('create_plugin', {
      ...params,
      buildingId: params.buildingId || SELF_BUILDING_ID,
      agentId: params.agentId || SELF_AGENT_ID,
    })
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'update_plugin',
  'Update a dynamic plugin\'s HTML, tools, name, or other properties.',
  {
    pluginId: z.string().describe('Plugin ID to update'),
    name: z.string().optional().describe('New display name'),
    description: z.string().optional().describe('New description'),
    icon: z.string().optional().describe('New emoji icon'),
    html: z.string().optional().describe('New HTML document'),
    tools: z.array(z.object({
      name: z.string(),
      description: z.string(),
      inputSchema: z.record(z.string(), z.any()),
    })).optional().describe('New tool definitions (replaces all)'),
    buildingId: z.string().optional().describe('Building ID (defaults to current building)'),
  },
  async (params) => {
    const result = await sendCommand('update_plugin', {
      ...params,
      buildingId: params.buildingId || SELF_BUILDING_ID,
    })
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'remove_plugin',
  'Remove a dynamic plugin from this office.',
  {
    pluginId: z.string().describe('Plugin ID to remove'),
    buildingId: z.string().optional().describe('Building ID (defaults to current building)'),
  },
  async (params) => {
    const result = await sendCommand('remove_plugin', {
      ...params,
      buildingId: params.buildingId || SELF_BUILDING_ID,
    })
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'list_plugins',
  'List all dynamic plugins in the current office/building.',
  {
    buildingId: z.string().optional().describe('Building ID (defaults to current building)'),
  },
  async (params) => {
    const result = await sendCommand('list_plugins', {
      buildingId: params.buildingId || SELF_BUILDING_ID,
    })
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'get_plugin_state',
  'Read the state of a dynamic plugin.',
  {
    pluginId: z.string().describe('Plugin ID'),
    buildingId: z.string().optional().describe('Building ID (defaults to current building)'),
  },
  async (params) => {
    const result = await sendCommand('get_plugin_state', {
      ...params,
      buildingId: params.buildingId || SELF_BUILDING_ID,
    })
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'set_plugin_state',
  'Update the state of a dynamic plugin.',
  {
    pluginId: z.string().describe('Plugin ID'),
    value: z.record(z.string(), z.any()).describe('New state value'),
    buildingId: z.string().optional().describe('Building ID (defaults to current building)'),
  },
  async (params) => {
    const result = await sendCommand('set_plugin_state', {
      ...params,
      buildingId: params.buildingId || SELF_BUILDING_ID,
    })
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'plugin_call',
  'Call a custom tool defined by a dynamic plugin. The tool call is routed to the plugin\'s iframe via postMessage. The plugin must have registered an onToolCall handler. Use list_plugins to see available tools per plugin.',
  {
    pluginId: z.string().describe('Plugin ID'),
    action: z.string().describe('Tool name defined by the plugin'),
    params: z.record(z.string(), z.any()).optional().describe('Parameters for the tool'),
    buildingId: z.string().optional().describe('Building ID (defaults to current building)'),
  },
  async (params) => {
    const result = await sendCommand('plugin_call', {
      pluginId: params.pluginId,
      action: params.action,
      params: params.params || {},
      buildingId: params.buildingId || SELF_BUILDING_ID,
    })
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// Trigger a visual canvas effect — a hidden surprise for users
server.tool(
  'trigger_fx',
  'Trigger a fun visual effect on the Pixel City canvas. Use sparingly for special moments: task completed, bug found, long build done, something worth celebrating. Effects are self-cleaning overlays that never block interaction.',
  {
    effect: z.enum(['matrix', 'binary', 'confetti', 'shockwave', 'neon', 'glitch', 'circuit']).describe(
      'matrix: green katakana rain. binary: multi-color 0/1 cascade. confetti: colorful particle burst. shockwave: expanding ring pulse. neon: glowing triangles. glitch: chromatic flicker. circuit: PCB traces spreading across the screen.'
    ),
  },
  async ({ effect }) => {
    const result = await sendCommand('trigger_fx', { effect })
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
)

// --- Start ---
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('[pixel-city-office-control] MCP server started\n')
}

main().catch((err) => {
  process.stderr.write(`[pixel-city-office-control] Fatal: ${err.message}\n`)
  process.exit(1)
})
