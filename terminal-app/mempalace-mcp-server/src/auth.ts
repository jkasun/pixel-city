import fs from 'fs'
import path from 'path'

const REGISTRY_FILE = 'permanent_agents.json'

function registryPath(configDir: string): string {
  return path.join(configDir, REGISTRY_FILE)
}

export function readPermanentAgents(configDir: string): string[] | null {
  const p = registryPath(configDir)
  if (!fs.existsSync(p)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'))
    return Array.isArray(raw) ? raw.map(String) : null
  } catch {
    return null
  }
}

export function writePermanentAgents(configDir: string, agentIds: string[]): void {
  fs.mkdirSync(configDir, { recursive: true })
  fs.writeFileSync(registryPath(configDir), JSON.stringify(agentIds, null, 2), 'utf-8')
}

export interface AuthResult {
  ok: boolean
  reason?: string
}

export function requirePermanentAgent(agentId: string | undefined, configDir: string): AuthResult {
  if (!agentId || typeof agentId !== 'string' || agentId.trim() === '') {
    return { ok: false, reason: 'missing_agent_id' }
  }
  const registry = readPermanentAgents(configDir)
  if (registry === null) {
    return { ok: true }
  }
  if (!registry.includes(agentId)) {
    return { ok: false, reason: 'temporary_agent_cannot_write_memory' }
  }
  return { ok: true }
}
