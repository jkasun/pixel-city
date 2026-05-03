#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const server = new McpServer({
  name: 'pixel-city-git-control',
  version: '1.0.0',
})

// Placeholder — git tools will be added here in the future

// --- Start ---
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('[pixel-city-git-control] MCP server started\n')
}

main().catch((err) => {
  process.stderr.write(`[pixel-city-git-control] Fatal: ${err.message}\n`)
  process.exit(1)
})
