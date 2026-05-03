// Board Plugin Module -- terminal-app specific
// Uses shared manifest from @pixel-city/plugin-board but provides
// its own Component/AgentTab that depend on terminal-app contexts.

import { BoardPlugin } from './BoardPlugin.js'
import { BoardAgentTab } from './BoardAgentTab.js'
import { boardManifest } from '@pixel-city/plugin-board'
import type { PluginModule } from '../../types.js'

export const boardPlugin: PluginModule = {
  manifest: boardManifest,

  // Main view -- full kanban board
  Component: BoardPlugin,

  // Agent tab -- agent's assigned tasks
  agentTab: {
    id: 'taskboard',
    label: 'Task Board',
    order: 30,
    Component: BoardAgentTab,
  },
}
