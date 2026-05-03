/**
 * Agent-to-agent messaging system — types and abstract interface.
 *
 * The MessageStore interface is the contract. Implementations can be
 * swapped without changing the MCP bridge or tool definitions:
 *   - InMemoryMessageStore (for tests / offline)
 *   - PubSubMessageStore (terminal-app: IPC-backed with WS pubsub event relay)
 */

export interface AgentMessage {
  id: string
  from: string
  fromName?: string
  to: string
  type: 'result' | 'status' | 'request' | 'info'
  subject: string
  body: string
  timestamp: number
  read: boolean
  replyTo?: string
}

export interface MessageQuery {
  agentId: string
  from?: string
  unreadOnly?: boolean
  limit?: number
  offset?: number
}

export interface MessageStore {
  /** Send a message to a recipient's inbox */
  send(message: Omit<AgentMessage, 'id' | 'timestamp' | 'read'>): Promise<AgentMessage>

  /** Get messages for an agent, with optional filters */
  query(query: MessageQuery): Promise<AgentMessage[]>

  /** Mark a specific message as read */
  markRead(agentId: string, messageId: string): Promise<AgentMessage | null>

  /** Get a single message by ID */
  get(agentId: string, messageId: string): Promise<AgentMessage | null>

  /** Delete all messages for an agent (cleanup on agent removal) */
  clearInbox(agentId: string): Promise<void>
}
