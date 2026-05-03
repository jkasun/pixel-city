// Messages Plugin -- Main View (injection point 1)
// Full messages view in PluginPanel showing all messages across agents.

import React from 'react'
import { MessagesView } from './MessagesView.js'
import type { PluginProps } from '@pixel-city/core'

export function MessagesPlugin({ host }: PluginProps) {
  return (
    <MessagesView
      selectedAgentId={host.activeAgentId}
      agentIds={host.agentIds}
      agentNames={host.agentNames as Map<string, string>}
      agentPalettes={host.agentPalettes as Map<string, number>}
    />
  )
}
