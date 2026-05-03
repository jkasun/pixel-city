import { useRef, useEffect, useCallback } from 'react'
import { platform } from '../platform/index.js'
import { getCanvasStore } from '@pixel-city/plugin-canvas'
import { getTerminalTheme, loadPixelCitySettings } from '../settings.js'
import { claudeProjectFolder } from '../llm/providers/claude-code/sessionList.js'
import type { AgentTerminalData, ShellTerminalData } from '../appTypes.js'
import { useJsonlWatch } from './useJsonlWatch.js'
import { usePtyListeners } from './usePtyListeners.js'
import { officeRegistry } from '../office/officeStateRefs.js'
import { llmRegistry, buildSystemPrompt, MODEL_IDS } from '../llm/index.js'
import { backendRegistry } from '../backend/registry.js'
import { LocalTerminal } from '../backend/local/LocalTerminal.js'
import type { AgentTrack } from '../permissionTimer.js'
import type { DebugEventKind } from '../DebugPanel.js'

const osModule = window.require('os') as typeof import('os')

interface TerminalLifecycleDeps {
  pendingPromptsRef: React.RefObject<Map<string, string>>
  agentModelsRef: React.RefObject<Map<string, string>>
  agentNamesRef: React.RefObject<Map<string, string>>
  agentPermanentIdMapRef: React.RefObject<Map<string, string>>
  agentBuildingMapRef: React.RefObject<Map<string, string>>
  agentTrackRef: React.RefObject<Map<string, AgentTrack>>
  startPermTimerRef: React.RefObject<(agentId: string, track: AgentTrack) => void>
  configCacheRef: React.RefObject<{ permissionMode?: 'bypass' | 'auto'; claudeConfigDir?: string } | null>
  projectCwdRef: React.RefObject<string | null>
  currentBuildingIdRef: React.RefObject<string | null>
  settingsRef: React.RefObject<{ fontFamily: string; fontSize: number; lineHeight: number; cursorStyle: string; cursorBlink: boolean; scrollback: number }>
  settings: { fontSize: number; fontFamily: string; lineHeight: number; cursorStyle: string; cursorBlink: boolean }
  statusCallbackRef: React.RefObject<(id: string, status: string | null) => void>
  debugCallbackRef: React.RefObject<(agentId: string | number, kind: DebugEventKind, label: string) => void>
  shellTerminalsRef: React.RefObject<Map<number, ShellTerminalData>>
  ptyStatusCallbackRef: React.RefObject<(id: string, status: string | null) => void>
  updateShellName: (ptyId: number, name: string) => void
}

export function useTerminalLifecycle({
  pendingPromptsRef,
  agentModelsRef,
  agentNamesRef,
  agentPermanentIdMapRef,
  agentBuildingMapRef,
  agentTrackRef,
  startPermTimerRef,
  configCacheRef,
  projectCwdRef,
  currentBuildingIdRef,
  settingsRef,
  settings,
  statusCallbackRef,
  debugCallbackRef,
  shellTerminalsRef,
  ptyStatusCallbackRef,
  updateShellName,
}: TerminalLifecycleDeps) {
  const agentTerminalsRef = useRef<Map<string, AgentTerminalData>>(new Map())
  const pendingTerminalInitRef = useRef<Set<string>>(new Set())

  // ── JSONL watch ───────────────────────────────────────
  const { agentJsonlRef, startJsonlWatch, stopJsonlWatch } = useJsonlWatch({
    agentTrackRef,
    agentTerminalsRef,
    statusCallbackRef,
    debugCallbackRef,
    startPermTimerRef,
  })

  // ── PTY listeners (no-op callback — JSONL is authoritative) ──
  usePtyListeners({
    agentTerminalsRef,
    shellTerminalsRef,
    statusCallbackRef: ptyStatusCallbackRef,
    debugCallbackRef,
    onShellProcessChange: updateShellName,
  })

  // ── Apply settings to terminals ───────────────────────
  useEffect(() => {
    for (const t of agentTerminalsRef.current.values()) {
      if (!t.terminal || !t.fitAddon) continue
      t.terminal.options.fontSize   = settings.fontSize
      t.terminal.options.fontFamily = settings.fontFamily
      t.terminal.options.lineHeight = settings.lineHeight
      t.terminal.options.cursorStyle = settings.cursorStyle as 'block' | 'underline' | 'bar'
      t.terminal.options.cursorBlink = settings.cursorBlink
      setTimeout(() => t.fitAddon?.fit(), 50)
    }
  }, [settings])

  // ── Apply theme changes ───────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const theme = (e as CustomEvent).detail?.theme
      if (!theme) return
      const xtermTheme = getTerminalTheme(theme)
      for (const t of agentTerminalsRef.current.values()) {
        if (t.terminal) t.terminal.options.theme = xtermTheme
      }
    }
    window.addEventListener('pixelcity:theme-changed', handler)
    return () => window.removeEventListener('pixelcity:theme-changed', handler)
  }, [])

  // ── initTerminal ──────────────────────────────────────
  const initTerminal = useCallback(async (agentId: string, container: HTMLDivElement, options?: { resumeSessionId?: string }) => {
    if (agentTerminalsRef.current.has(agentId)) return
    if (pendingTerminalInitRef.current.has(agentId)) return
    pendingTerminalInitRef.current.add(agentId)

    try {
      getCanvasStore().clear(agentId)

      const resumeSessionId = options?.resumeSessionId
      const sessionId = resumeSessionId ?? crypto.randomUUID()
      const model = agentModelsRef.current.get(agentId)
      const modelId = model ? (MODEL_IDS[model] ?? model) : null
      const pendingPrompt = pendingPromptsRef.current.get(agentId)
      if (pendingPrompt) pendingPromptsRef.current.delete(agentId)

      const provider = (modelId ? llmRegistry.resolveProviderForModel(modelId) : null) ?? llmRegistry.get('claude-code')
      if (!provider) throw new Error('No LLM provider available')
      const hasTerminal = provider.capabilities.hasTerminal

      const backend = backendRegistry.resolve(provider)

      try {
        const cfgResult = await platform().config.load(projectCwdRef.current!) as any
        if (cfgResult.success && cfgResult.config) configCacheRef.current = cfgResult.config
      } catch { /* use cached */ }
      const agentBuildingId = agentBuildingMapRef.current.get(agentId) ?? currentBuildingIdRef.current
      const empId = agentPermanentIdMapRef.current.get(agentId)
      const empHandle = empId && agentBuildingId
        ? officeRegistry.getBuilding(agentBuildingId)?.permanentEmployees.get(empId)?.settings.handle
        : undefined

      const agentName = agentNamesRef.current.get(agentId) ?? `Agent ${agentId}`

      const appendSystemPrompt = await buildSystemPrompt({
        agentId,
        agentName,
        projectDir: projectCwdRef.current ?? '',
        buildingId: agentBuildingId || undefined,
        employeeId: empId || undefined,
        employeeHandle: empHandle,
        configCache: configCacheRef.current,
      })

      const workspaceOpts = hasTerminal && projectCwdRef.current ? {
        agentId,
        employeeId: empId || undefined,
        projectDir: projectCwdRef.current,
      } : undefined

      const env: Record<string, string> = {
        PIXEL_CITY_AGENT_ID: agentId,
        PIXEL_CITY_AGENT_NAME: agentName,
      }
      if (projectCwdRef.current) env.PIXEL_CITY_PROJECT_DIR = projectCwdRef.current
      if (empId) env.PIXEL_CITY_EMPLOYEE_ID = empId
      const buildingForEnv = agentBuildingMapRef.current.get(agentId)
      if (buildingForEnv) env.PIXEL_CITY_BUILDING_ID = buildingForEnv

      const claudeConfigDir = configCacheRef.current?.claudeConfigDir || loadPixelCitySettings().claudeConfigDir
      if (claudeConfigDir) env.CLAUDE_CONFIG_DIR = claudeConfigDir

      const s = settingsRef.current
      const terminalOptions = hasTerminal ? {
        theme: getTerminalTheme(loadPixelCitySettings().theme ?? 'dark') as unknown as Record<string, string>,
        fontFamily: s.fontFamily,
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        cursorStyle: s.cursorStyle as 'block' | 'underline' | 'bar',
        cursorBlink: s.cursorBlink,
        scrollback: s.scrollback,
      } : undefined

      const handle = await backend.startAgent({
        provider,
        sessionConfig: {
          providerId: provider.id,
          modelId: modelId ?? 'sonnet',
          sessionId,
          agentId,
          agentName,
          cwd: projectCwdRef.current ?? undefined,
          systemPrompt: appendSystemPrompt,
          initialPrompt: pendingPrompt || undefined,
          cols: hasTerminal ? 120 : undefined,
          rows: hasTerminal ? 30 : undefined,
          env,
          providerOptions: {
            permissionMode: configCacheRef.current?.permissionMode ?? 'bypass',
          },
          resume: !!resumeSessionId,
        },
        terminalContainer: hasTerminal ? container : undefined,
        terminalOptions,
        workspace: workspaceOpts,
      })

      const session = handle.session
      const ptyId = session.ptyId ?? 0

      if (hasTerminal && handle.terminal) {
        const localTerminal = handle.terminal as LocalTerminal
        const terminal = localTerminal.getXterm() ?? undefined
        const fitAddon = localTerminal.getFitAddon() ?? undefined
        const searchAddon = localTerminal.getSearchAddon() ?? undefined

        agentTerminalsRef.current.set(agentId, {
          terminal, fitAddon, searchAddon, ptyId, session, agentHandle: handle,
        })
        setTimeout(() => { fitAddon?.fit(); terminal?.focus() }, 10)

        const cwd = projectCwdRef.current ?? ''
        if (cwd) {
          const projectHash = claudeProjectFolder(cwd)
          const jsonlPath = `${osModule.homedir()}/.claude/projects/${projectHash}/${sessionId}.jsonl`
          startJsonlWatch(agentId, jsonlPath)
        }
      } else {
        agentTerminalsRef.current.set(agentId, { ptyId: 0, session, agentHandle: handle })

        session.onEvent((event) => {
          if (event.type === 'status' && event.text) {
            statusCallbackRef.current(agentId, event.text)
          } else if (event.type === 'turn_end') {
            statusCallbackRef.current(agentId, null)
          }
        })
      }
    } finally {
      pendingTerminalInitRef.current.delete(agentId)
    }
  }, [startJsonlWatch])

  // ── cleanupTerminal ───────────────────────────────────
  const cleanupTerminal = useCallback((agentId: string) => {
    const agent = agentTerminalsRef.current.get(agentId)
    if (!agent) return
    if (agent.agentHandle) {
      agent.agentHandle.dispose()
    } else {
      if (agent.session) {
        agent.session.kill()
      } else if (agent.ptyId) {
        platform().pty.kill(agent.ptyId)
      }
      if (agent.terminal) agent.terminal.dispose()
    }
    agentTerminalsRef.current.delete(agentId)
    stopJsonlWatch(agentId)
  }, [stopJsonlWatch])

  // ── sendPtyInput ──────────────────────────────────────
  const sendPtyInput = useCallback((agentId: string, message: string): boolean => {
    const agent = agentTerminalsRef.current.get(agentId)
    if (!agent) return false
    if (agent.session) {
      agent.session.sendInput(message + '\r')
    } else {
      platform().pty.input(agent.ptyId, message + '\r')
    }
    return true
  }, [])

  return {
    agentTerminalsRef,
    agentJsonlRef,
    initTerminal,
    cleanupTerminal,
    sendPtyInput,
    stopJsonlWatch,
    pendingTerminalInitRef,
  }
}
