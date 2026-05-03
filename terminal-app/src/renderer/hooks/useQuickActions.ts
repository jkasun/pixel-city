import { useState, useEffect, useCallback, useRef } from 'react'
import { platform } from '../platform/index.js'
import { generateAgentId } from '@pixel-city/shared/utils/agentId'
import type { DebugEventKind } from '../DebugPanel.js'

export interface QuickAction {
  id: string
  title: string
  description: string
  type: 'ai' | 'terminal'
  command?: string
}

interface QuickActionsDeps {
  projectCwd: string | null
  currentBuildingIdRef: React.RefObject<string | null>
  handleAddAgent: (agentId: string, palette: number, name: string, model: string, buildingId: string | null, initialMessage?: string, permanentId?: string) => void
  debugCallbackRef: React.RefObject<(agentId: string | number, kind: DebugEventKind, label: string) => void>
}

export function useQuickActions({ projectCwd, currentBuildingIdRef, handleAddAgent, debugCallbackRef }: QuickActionsDeps) {
  const [quickActions, setQuickActions] = useState<QuickAction[]>([])
  const lastLocalSaveRef = useRef(0)

  const loadFromDisk = useCallback(() => {
    if (!projectCwd) return
    platform().config.load(projectCwd).then((result: any) => {
      if (result.success && result.config) {
        const buildingKey = currentBuildingIdRef.current || 'default'
        const raw = result.config.quickActions?.[buildingKey] ?? []
        const actions = raw.map((a: any) => ({ ...a, type: a.type || 'ai' }))
        setQuickActions(actions)
      }
    }).catch(() => {})
  }, [projectCwd])

  // Load quick actions from config on mount / building change
  const currentBuildingId = currentBuildingIdRef.current
  useEffect(() => {
    loadFromDisk()
  }, [projectCwd, currentBuildingId])

  // Watch .pixelcity dir for external writes (e.g. MCP server)
  useEffect(() => {
    if (!projectCwd) return
    const watchDir = `${projectCwd}/.pixelcity`
    const unwatch = platform().fs.watch?.(watchDir, (_, filename) => {
      if (filename !== 'config.json') return
      // Ignore if we wrote it ourselves within the last second
      if (Date.now() - lastLocalSaveRef.current < 1000) return
      loadFromDisk()
    })
    return () => unwatch?.()
  }, [projectCwd, loadFromDisk])

  const saveQuickActions = useCallback((actions: QuickAction[]) => {
    if (!projectCwd) return
    lastLocalSaveRef.current = Date.now()
    platform().config.load(projectCwd).then((result: any) => {
      const config = result.success && result.config ? result.config : { cityInstructions: '', officeInstructions: {} }
      if (!config.quickActions) config.quickActions = {}
      const buildingKey = currentBuildingIdRef.current || 'default'
      config.quickActions[buildingKey] = actions
      platform().config.save(projectCwd, config)
    }).catch(() => {})
  }, [projectCwd])

  const addQuickAction = useCallback((title: string, description: string, type: 'ai' | 'terminal' = 'ai', command?: string) => {
    const action: QuickAction = { id: crypto.randomUUID(), title, description, type, command }
    setQuickActions(prev => {
      const next = [...prev, action]
      saveQuickActions(next)
      return next
    })
  }, [saveQuickActions])

  const removeQuickAction = useCallback((id: string) => {
    setQuickActions(prev => {
      const next = prev.filter(a => a.id !== id)
      saveQuickActions(next)
      return next
    })
  }, [saveQuickActions])

  const updateQuickAction = useCallback((id: string, title: string, description: string, type: 'ai' | 'terminal' = 'ai', command?: string) => {
    setQuickActions(prev => {
      const next = prev.map(a => a.id === id ? { ...a, title, description, type, command } : a)
      saveQuickActions(next)
      return next
    })
  }, [saveQuickActions])

  const runQuickAction = useCallback((action: QuickAction) => {
    if (action.type === 'terminal') {
      window.dispatchEvent(new CustomEvent('pixelcity:run-terminal-action', { detail: action }))
      return
    }
    const agentId = generateAgentId()
    const palette = Math.floor(Math.random() * 8)
    handleAddAgent(agentId, palette, action.title, 'sonnet', null, action.description)
    debugCallbackRef.current(agentId, 'agent', `quick action — ${action.title}`)
  }, [handleAddAgent, debugCallbackRef])

  return { quickActions, addQuickAction, removeQuickAction, updateQuickAction, runQuickAction }
}
