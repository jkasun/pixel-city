// ── Browser Plugin — Main View (injection point 1) ───────────────────

import React from 'react'
import { BrowserView } from '../../../browser/BrowserView.js'
import type { PluginProps } from '../../types.js'

export function BrowserPlugin({ host }: PluginProps) {
  return (
    <BrowserView
      key={host.projectCwd ?? 'no-project'}
      agentNames={host.agentNames as Map<string, string>}
      agentPalettes={host.agentPalettes as Map<string, number>}
      projectCwd={host.projectCwd}
      activeAgentId={host.activeAgentId}
    />
  )
}
