import path from 'path'
import os from 'os'
import fs from 'fs'
import { IpcMain } from 'electron'

function getAgentsDir(projectDir?: string): string {
  if (projectDir) return path.join(projectDir, '.pixelcity', 'agents')
  return path.join(os.homedir(), '.pixelcity', 'agents')
}

function getMempalaceDir(projectDir?: string): string {
  const base = projectDir || os.homedir()
  return path.join(base, '.pixelcity', 'mempalace')
}

interface AgentRecord {
  id: string
  settings: Record<string, unknown>
  soul: string
}

function readAgent(agentsDir: string, id: string): AgentRecord | null {
  const dir = path.join(agentsDir, id)
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null

  const agentJsonPath = path.join(dir, 'agent.json')
  const soulPath = path.join(dir, 'soul.md')

  let settings: Record<string, unknown> = {}
  if (fs.existsSync(agentJsonPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(agentJsonPath, 'utf8'))
    } catch {
      settings = {}
    }
  }

  const soul = fs.existsSync(soulPath) ? fs.readFileSync(soulPath, 'utf8') : ''

  return { id, settings, soul }
}

function listAgents(agentsDir: string): AgentRecord[] {
  if (!fs.existsSync(agentsDir)) return []
  const entries = fs.readdirSync(agentsDir, { withFileTypes: true })
  const records: AgentRecord[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const rec = readAgent(agentsDir, entry.name)
    if (rec) records.push(rec)
  }
  return records
}

function writeAgentJson(dir: string, settings: Record<string, unknown>): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'agent.json'), JSON.stringify(settings, null, 2), 'utf8')
}

function writeSoul(dir: string, soul: string): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'soul.md'), soul, 'utf8')
}

// Mempalace MCP server gates memory writes via permanent_agents.json — keep it
// in sync with the folder list so auth keeps working without changes there.
function syncPermanentAgentsRegistry(projectDir?: string): void {
  try {
    if (!projectDir) return
    const agentsDir = getAgentsDir(projectDir)
    const ids = new Set<string>()
    if (fs.existsSync(agentsDir)) {
      for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        ids.add(entry.name)
        const rec = readAgent(agentsDir, entry.name)
        const handle = rec?.settings?.handle
        if (typeof handle === 'string' && handle) ids.add(handle)
      }
    }
    const mempalaceDir = getMempalaceDir(projectDir)
    fs.mkdirSync(mempalaceDir, { recursive: true })
    fs.writeFileSync(
      path.join(mempalaceDir, 'permanent_agents.json'),
      JSON.stringify([...ids], null, 2),
      'utf8',
    )
  } catch (err) {
    console.warn('[employeeHandlers] Failed to sync permanent_agents.json:', err instanceof Error ? err.message : err)
  }
}

export function register(ipcMain: IpcMain) {
  ipcMain.handle('permanent-employee-list', (_event, { projectDir } = {} as any) => {
    try {
      const employees = listAgents(getAgentsDir(projectDir))
      return { success: true, employees }
    } catch (err: any) {
      return { success: false, error: err.message, employees: [] }
    }
  })

  ipcMain.handle('permanent-employee-create', (_event, { id, settings, soul, projectDir }: any) => {
    try {
      const agentsDir = getAgentsDir(projectDir)
      const dir = path.join(agentsDir, id)
      if (fs.existsSync(dir)) return { success: false, error: 'Employee already exists' }

      const finalSettings = { ...settings }
      if (!finalSettings.floorId && finalSettings.officeId) finalSettings.floorId = 'floor-0'

      writeAgentJson(dir, finalSettings)
      if (soul) writeSoul(dir, soul)

      syncPermanentAgentsRegistry(projectDir)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('permanent-employee-save-settings', (_event, { id, settings, projectDir }: any) => {
    try {
      const agentsDir = getAgentsDir(projectDir)
      const dir = path.join(agentsDir, id)

      const finalSettings = { ...settings }
      if (!finalSettings.floorId && finalSettings.officeId) finalSettings.floorId = 'floor-0'

      writeAgentJson(dir, finalSettings)
      syncPermanentAgentsRegistry(projectDir)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('permanent-employee-save-soul', (_event, { id, soul, projectDir }: any) => {
    try {
      const agentsDir = getAgentsDir(projectDir)
      const dir = path.join(agentsDir, id)
      if (!fs.existsSync(dir)) return { success: false, error: 'Employee not found' }

      writeSoul(dir, soul)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('permanent-employee-delete', (_event, { id, projectDir }: any) => {
    try {
      const dir = path.join(getAgentsDir(projectDir), id)
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
      syncPermanentAgentsRegistry(projectDir)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('permanent-employee-query', (_event, { query, projectDir }: any) => {
    try {
      let employees = listAgents(getAgentsDir(projectDir))
      if (query && Object.keys(query).length > 0) {
        employees = employees.filter((emp) =>
          Object.entries(query).every(([k, v]) => (emp as any)[k] === v),
        )
      }
      return { success: true, employees }
    } catch (err: any) {
      return { success: false, error: err.message, employees: [] }
    }
  })
}
