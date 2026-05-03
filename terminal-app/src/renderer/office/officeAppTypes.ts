import type { OfficeLayout, FloorColor, Character } from '@pixel-city/shared/office/types'
import type { LoadedAssetData } from '@pixel-city/shared/office/layout/furnitureCatalog'
import type { ExistingAgentsData } from '../OfficeRouter.js'

export interface FloorEntry {
  id: string
  name: string
}

export interface PermanentEmployeeSettings {
  palette: number
  hueShift: number
  seatId?: string | null
  name: string
  /** Human-friendly handle like "bumblepebble" — unique per user. Required for new employees. */
  handle?: string
  role?: string
  personality?: string
  /** The buildingId this employee belongs to, or null for the default (non-building) office */
  officeId?: string | null
  /** Floor ID within the office (defaults to "floor-0" if not set) */
  floorId?: string
  /** Claude model to use (e.g. "sonnet" | "opus") */
  model?: string
}

export interface PermanentEmployeeData {
  id: string
  settings: PermanentEmployeeSettings
  soul: string
}

export interface AppProps {
  buildingId?: string
  onAddAgent?: (agentId: string, palette: number, name: string, model: string, buildingId: string | null, initialMessage?: string, permanentId?: string) => void
  onRemoveAgent?: (agentId: string) => void
  onResetAgents?: () => void
  externalSelectedId?: string | null
  onAgentSelect?: (agentId: string | null) => void
  /** Map of agentId → current status text (from Claude CLI output) */
  agentStatusMap?: Map<string, string>
  /** Map of agentId → worker status (idle/working/tool) from MCP */
  agentWorkerStatusMap?: Map<string, 'idle' | 'working' | 'tool'>
  /** Project working directory — office configs are stored in <projectCwd>/.pixelcity/ */
  projectCwd?: string | null
  /** Existing agents from App.tsx to restore when re-entering this office */
  existingAgents?: ExistingAgentsData
  /** Current list of active agent IDs — used to detect when agents are removed from the sidebar */
  agentIds?: string[]
}

export interface BuildingInfo {
  id: string
  name: string
  layout: string
  /** Building handle (unique per user) — used to scope permanent employee handles per building. */
  handle?: string
}
