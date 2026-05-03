import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const TERMINAL_APP_DIR = path.resolve(__dirname, '..', '..', 'terminal-app')

// In bundled CJS (prod), system-prompts lives at mcp-server/system-prompts/
// (copied by bundle-mcp-servers.mjs). In dev ESM, it's at terminal-app/system-prompts/.
// __dirname in CJS bundle = resources/mcp-server/servers/
// __dirname in dev ESM    = mcp-server/shared/
const _bundledPromptsDir = path.resolve(__dirname, '..', 'system-prompts')
export const SYSTEM_PROMPTS_DIR = fs.existsSync(_bundledPromptsDir)
  ? _bundledPromptsDir
  : path.join(TERMINAL_APP_DIR, 'system-prompts')

export const WS_URL = process.env.PIXEL_CITY_WS_URL || 'ws://localhost:19840'
export const CONNECT_TIMEOUT = 5000
export const REQUEST_TIMEOUT = 10000
export const BROWSER_REQUEST_TIMEOUT = 30000
export const HEAVY_REQUEST_TIMEOUT = 60000

// Agent identity — set by Pixel City when spawning a Claude session
export const SELF_AGENT_ID = process.env.PIXEL_CITY_AGENT_ID || null
export const SELF_AGENT_NAME = process.env.PIXEL_CITY_AGENT_NAME || null
export const SELF_PROJECT_DIR = process.env.PIXEL_CITY_PROJECT_DIR || null
export const SELF_EMPLOYEE_ID = process.env.PIXEL_CITY_EMPLOYEE_ID || null
export const SELF_BUILDING_ID = process.env.PIXEL_CITY_BUILDING_ID || null
export const SELF_WORKSPACE_DIR = process.env.PIXEL_CITY_WORKSPACE_DIR || null
