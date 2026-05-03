// Messages Plugin Module
// Agent-to-agent direct messaging. Provides:
//   1. Main view in PluginPanel (all messages)
//   2. MCP tools (send_message, check_messages, read_message, list_messages)
//   3. Agent tab in AgentPanel (agent's inbox)

import { MessagesPlugin } from './components/MessagesPlugin.js'
import { MessagesAgentTab } from './components/MessagesAgentTab.js'
import { messagesTools } from './tools.js'
import { MessageBubbleIcon } from './icons.js'
import type { PluginModule } from '@pixel-city/core'

export const messagesPlugin: PluginModule = {
  manifest: {
    id: 'messages',
    name: 'Messages',
    icon: MessageBubbleIcon,
    order: 70,
    description: 'Agent-to-agent direct messaging',
    builtIn: true,
  },

  // Main view -- all messages across agents
  Component: MessagesPlugin,

  // Agent tab -- selected agent's inbox
  agentTab: {
    id: 'inbox',
    label: 'Inbox',
    order: 40,
    Component: MessagesAgentTab,
  },

  // MCP tools
  tools: messagesTools,
}

// Re-export messaging internals for consumers that need DI
export { getMessageStore, setMessageStore } from './messaging/index.js'
export type { AgentMessage, MessageQuery, MessageStore } from './messaging/types.js'
export { InMemoryMessageStore } from './messaging/inMemoryMessageStore.js'
export { MessagesView } from './components/MessagesView.js'
