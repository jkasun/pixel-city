import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  SELF_AGENT_ID,
  SELF_PROJECT_DIR,
  SELF_EMPLOYEE_ID,
  SELF_BUILDING_ID,
} from './env.js'

// Helper: generate a random 16-character agent ID
export function generateAgentId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let i = 0; i < 16; i++) id += chars[Math.floor(Math.random() * chars.length)]
  return id
}

// Helper: resolve agent ID — use explicit param, fall back to env-based self ID
export function resolveAgentId(params) {
  const id = params.id ?? SELF_AGENT_ID
  if (id === null || id === undefined) {
    throw new Error('Missing agent id (no PIXEL_CITY_AGENT_ID env var set)')
  }
  return id
}

// Helper: inject projectDir and buildingId from env if not explicitly provided
export function withProjectDir(params) {
  const resolved = { ...params }
  if (!resolved.projectDir && SELF_PROJECT_DIR) resolved.projectDir = SELF_PROJECT_DIR
  if (!resolved.buildingId && SELF_BUILDING_ID) resolved.buildingId = SELF_BUILDING_ID
  return resolved
}

// Helper: resolve assignee key — prefer emp:<id> for permanent employees, fall back to agent:<id>
export function resolveSelfAssigneeKey() {
  if (SELF_EMPLOYEE_ID) return `emp:${SELF_EMPLOYEE_ID}`
  if (SELF_AGENT_ID !== null) return `agent:${SELF_AGENT_ID}`
  return null
}

// Helper: load project configuration from config.json
export function loadProjectConfig(projectDir) {
  if (!projectDir) return null

  const configPath = path.join(projectDir, '.pixelcity', 'config.json')
  try {
    if (!fs.existsSync(configPath)) return null
    const configData = fs.readFileSync(configPath, 'utf8')
    return JSON.parse(configData)
  } catch (err) {
    process.stderr.write(`[pixel-city-mcp] Warning: Could not load config from ${configPath}: ${err.message}\n`)
    return null
  }
}

// Helper: resolve instruction text — returns trimmed text or null if empty
export function resolveInstructionText(text) {
  if (!text || typeof text !== 'string' || !text.trim()) return null
  return text.trim()
}

// Helper: read office instructions from `.pixelcity/office-instructions.md`.
// Returns the file contents (trimmed) or null if missing/empty. The OSS
// version stores office instructions as a single user-editable markdown
// file rather than the legacy per-buildingId map in config.json.
export function readOfficeInstructionsFile(projectDir) {
  if (!projectDir) return null
  const filePath = path.join(projectDir, '.pixelcity', 'office-instructions.md')
  try {
    if (!fs.existsSync(filePath)) return null
    const text = fs.readFileSync(filePath, 'utf8').trim()
    return text || null
  } catch (err) {
    process.stderr.write(`[pixel-city-mcp] Warning: Could not read ${filePath}: ${err.message}\n`)
    return null
  }
}

// Helper: read a markdown file under `~/.pixelcity/`. Used for global
// (per-machine) settings like city configuration and canvas preferences.
function readHomePixelcityMarkdown(filename) {
  const filePath = path.join(os.homedir(), '.pixelcity', filename)
  try {
    if (!fs.existsSync(filePath)) return null
    const text = fs.readFileSync(filePath, 'utf8').trim()
    return text || null
  } catch (err) {
    process.stderr.write(`[pixel-city-mcp] Warning: Could not read ${filePath}: ${err.message}\n`)
    return null
  }
}

// Helper: read city configuration from `~/.pixelcity/city-configuration.md`.
export function readCityConfigurationFile() {
  return readHomePixelcityMarkdown('city-configuration.md')
}

// Helper: read canvas preferences from `~/.pixelcity/canvas-preferences.md`.
export function readCanvasPreferencesFile() {
  return readHomePixelcityMarkdown('canvas-preferences.md')
}

// Helper: build hierarchical instructions for agent spawning.
// City instructions come from `~/.pixelcity/city-configuration.md`; office
// instructions come from `<projectDir>/.pixelcity/office-instructions.md`.
export function buildInstructions(_config, projectDir, userPrompt = '') {
  const dir = projectDir || ''
  const instructions = []

  const cityText = readCityConfigurationFile()
  if (cityText) {
    instructions.push(`**City Instructions:**\n${cityText}`)
  }

  const officeText = readOfficeInstructionsFile(dir)
  if (officeText) {
    instructions.push(`**Office Instructions:**\n${officeText}`)
  }

  if (instructions.length > 0) {
    const combinedInstructions = instructions.join('\n\n')
    if (userPrompt && userPrompt.trim()) {
      return `${combinedInstructions}\n\n**Task:**\n${userPrompt.trim()}`
    } else {
      return combinedInstructions
    }
  }

  return userPrompt || ''
}
