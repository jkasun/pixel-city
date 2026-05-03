// ── Git Plugin — Main View (injection point 1) ──────────────────────

import React, { useCallback } from 'react'
import { setGitAdapter } from '@pixel-city/plugin-git'
import { GitView } from '@pixel-city/plugin-git/components'
import type { PluginProps } from '../../types.js'
import { useWorldContext } from '../../../contexts/WorldContext.js'
import { useOfficeContext } from '../../../contexts/OfficeContext.js'
import { loadSessionState, saveSessionState, computeProjectHash } from '../../../settings.js'
import { generateAgentId } from '@pixel-city/shared/utils/agentId'
import { platform } from '../../../platform/index.js'
import { setDraggedFilePath } from '../../../files/dragState.js'
import { electronGitAdapter } from '../../../git/electronGitAdapter.js'

// Initialize git adapter (once, module-level)
setGitAdapter(electronGitAdapter)

export function GitPlugin({ host }: PluginProps) {
  const { editorSettings } = useWorldContext()
  const { handleAddAgent } = useOfficeContext()

  const onCommit = useCallback((prompt: string) => {
    const agentId = generateAgentId()
    const palette = Date.now() % 8
    handleAddAgent(agentId, palette, 'Git Commit', 'sonnet', null, prompt)
  }, [handleAddAgent])

  const onLoadInstructions = useCallback(async (cwd: string): Promise<string> => {
    const result: any = await platform().config.load(cwd)
    if (result.success && result.config?.gitInstructions) {
      return result.config.gitInstructions
    }
    return ''
  }, [])

  const onSaveInstructions = useCallback(async (cwd: string, text: string) => {
    const result: any = await platform().config.load(cwd)
    const existing = result.success && result.config ? result.config : { cityInstructions: '', officeInstructions: {} }
    existing.gitInstructions = text
    platform().config.save(cwd, existing)
  }, [])

  const onLoadSessionRepo = useCallback((projectCwd: string): string | null => {
    const hash = computeProjectHash(projectCwd)
    return loadSessionState().activeGitRepo?.[hash] ?? null
  }, [])

  const onSaveSessionRepo = useCallback((projectCwd: string, repo: string) => {
    const hash = computeProjectHash(projectCwd)
    const prev = loadSessionState()
    saveSessionState({ activeGitRepo: { ...prev.activeGitRepo, [hash]: repo } })
  }, [])

  const onDragFile = useCallback((absPath: string | null) => {
    setDraggedFilePath(absPath)
  }, [])

  if (!host.projectCwd) return null

  return (
    <GitView
      projectCwd={host.projectCwd}
      editorSettings={editorSettings}
      onCommit={onCommit}
      onLoadInstructions={onLoadInstructions}
      onSaveInstructions={onSaveInstructions}
      onLoadSessionRepo={onLoadSessionRepo}
      onSaveSessionRepo={onSaveSessionRepo}
      onDragFile={onDragFile}
    />
  )
}
