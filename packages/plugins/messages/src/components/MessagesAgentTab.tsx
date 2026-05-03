// Messages Plugin -- Agent Tab (injection point 3)
// Agent-scoped inbox in the AgentPanel tab bar. Shows messages for
// the currently selected agent only.

import React from 'react'
import { MessagesView } from './MessagesView.js'
import type { AgentTabProps } from '@pixel-city/core'

export function MessagesAgentTab({ host, agentId }: AgentTabProps) {
  return (
    <MessagesView
      selectedAgentId={agentId}
      agentIds={host.agentIds}
      agentNames={host.agentNames as Map<string, string>}
      agentPalettes={host.agentPalettes as Map<string, number>}
    />
  )
}
