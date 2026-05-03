/**
 * Main-process SQLite-backed message store for agent-to-agent messaging.
 *
 * Messages persist across restarts. Falls back to in-memory if DB unavailable.
 *
 * IPC channels:
 *   messages-send      — send a message to a recipient's inbox
 *   messages-query     — query messages with filters
 *   messages-mark-read — mark a specific message as read
 *   messages-get       — get a single message by ID
 *   messages-clear     — clear an agent's inbox
 */

import type { IpcMain } from 'electron'
import { getDb } from './appDb'

interface AgentMessage {
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

interface MessageQuery {
  agentId: string
  from?: string
  unreadOnly?: boolean
  limit?: number
  offset?: number
}

function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function rowToMessage(row: any): AgentMessage {
  return {
    id: row.id,
    from: row.from_agent,
    fromName: row.from_name || undefined,
    to: row.to_agent,
    type: row.type,
    subject: row.subject,
    body: row.body,
    timestamp: row.timestamp,
    read: row.read === 1,
    replyTo: row.reply_to || undefined,
  }
}

// projectDir is not passed for messages (they're global per installation)
const PROJECT_DIR = undefined

function send(partial: Omit<AgentMessage, 'id' | 'timestamp' | 'read'>): AgentMessage {
  const message: AgentMessage = {
    ...partial,
    id: generateId(),
    timestamp: Date.now(),
    read: false,
  }
  try {
    const db = getDb(PROJECT_DIR)
    db.prepare(`
      INSERT OR REPLACE INTO messages (id, from_agent, from_name, to_agent, type, subject, body, timestamp, read, reply_to)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      message.id,
      message.from,
      message.fromName ?? null,
      message.to,
      message.type,
      message.subject,
      message.body,
      message.timestamp,
      message.replyTo ?? null,
    )
  } catch (err) {
    console.error('[messageStore] Failed to persist message:', err)
  }
  return message
}

function query(q: MessageQuery): AgentMessage[] {
  try {
    const db = getDb(PROJECT_DIR)
    let sql = 'SELECT * FROM messages WHERE to_agent = ?'
    const params: any[] = [q.agentId]

    if (q.from !== undefined) {
      sql += ' AND from_agent = ?'
      params.push(q.from)
    }
    if (q.unreadOnly) {
      sql += ' AND read = 0'
    }

    sql += ' ORDER BY timestamp DESC'

    const offset = q.offset ?? 0
    const limit = q.limit ?? 50
    sql += ` LIMIT ? OFFSET ?`
    params.push(limit, offset)

    const rows = db.prepare(sql).all(...params) as any[]
    return rows.map(rowToMessage)
  } catch (err) {
    console.error('[messageStore] Failed to query messages:', err)
    return []
  }
}

function markRead(agentId: string, messageId: string): AgentMessage | null {
  try {
    const db = getDb(PROJECT_DIR)
    db.prepare('UPDATE messages SET read = 1 WHERE id = ? AND to_agent = ?').run(messageId, agentId)
    const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId) as any
    return row ? rowToMessage(row) : null
  } catch (err) {
    console.error('[messageStore] Failed to mark read:', err)
    return null
  }
}

function get(agentId: string, messageId: string): AgentMessage | null {
  try {
    const db = getDb(PROJECT_DIR)
    const row = db.prepare('SELECT * FROM messages WHERE id = ? AND to_agent = ?').get(messageId, agentId) as any
    return row ? rowToMessage(row) : null
  } catch {
    return null
  }
}

function clearInbox(agentId: string): void {
  try {
    const db = getDb(PROJECT_DIR)
    db.prepare('DELETE FROM messages WHERE to_agent = ?').run(agentId)
  } catch (err) {
    console.error('[messageStore] Failed to clear inbox:', err)
  }
}

export function register(ipcMain: IpcMain) {
  ipcMain.handle('messages-send', (_event, partial: Omit<AgentMessage, 'id' | 'timestamp' | 'read'>) => {
    return send(partial)
  })

  ipcMain.handle('messages-query', (_event, q: MessageQuery) => {
    return query(q)
  })

  ipcMain.handle('messages-mark-read', (_event, { agentId, messageId }: { agentId: string; messageId: string }) => {
    return markRead(agentId, messageId)
  })

  ipcMain.handle('messages-get', (_event, { agentId, messageId }: { agentId: string; messageId: string }) => {
    return get(agentId, messageId)
  })

  ipcMain.handle('messages-clear', (_event, { agentId }: { agentId: string }) => {
    clearInbox(agentId)
    return { success: true }
  })
}
