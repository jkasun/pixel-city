/**
 * Agent-to-agent messaging system tests.
 *
 * Tests the MessageStore interface contract using the InMemoryMessageStore.
 * Any backend implementation should pass these same tests.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryMessageStore } from '../inMemoryMessageStore'
import type { MessageStore, AgentMessage } from '../types'

// Agent IDs for test scenarios
const TEAMLEAD = 'agent_teamlead'
const SUB_AGENT_A = 'agent_sub_a'
const SUB_AGENT_B = 'agent_sub_b'

function makeMessage(overrides: Partial<Omit<AgentMessage, 'id' | 'timestamp' | 'read'>> = {}) {
  return {
    from: SUB_AGENT_A,
    to: TEAMLEAD,
    type: 'info' as const,
    subject: 'Test message',
    body: 'Hello from sub-agent',
    ...overrides,
  }
}

describe('MessageStore (InMemory)', () => {
  let store: MessageStore

  beforeEach(() => {
    store = new InMemoryMessageStore()
  })

  // ── send ──────────────────────────────────────────────

  describe('send', () => {
    it('creates a message with generated id and timestamp', async () => {
      const msg = await store.send(makeMessage())

      expect(msg.id).toMatch(/^msg-\d+-[a-z0-9]+$/)
      expect(msg.timestamp).toBeGreaterThan(0)
      expect(msg.read).toBe(false)
      expect(msg.from).toBe(SUB_AGENT_A)
      expect(msg.to).toBe(TEAMLEAD)
      expect(msg.subject).toBe('Test message')
      expect(msg.body).toBe('Hello from sub-agent')
    })

    it('stores message in the recipient inbox, not the sender', async () => {
      await store.send(makeMessage({ from: SUB_AGENT_A, to: TEAMLEAD }))

      const teamleadInbox = await store.query({ agentId: TEAMLEAD, unreadOnly: false })
      const subAgentInbox = await store.query({ agentId: SUB_AGENT_A, unreadOnly: false })

      expect(teamleadInbox).toHaveLength(1)
      expect(subAgentInbox).toHaveLength(0)
    })

    it('supports all message types', async () => {
      for (const type of ['result', 'status', 'request', 'info'] as const) {
        const msg = await store.send(makeMessage({ type }))
        expect(msg.type).toBe(type)
      }
    })

    it('preserves optional fromName and replyTo', async () => {
      const msg = await store.send(makeMessage({
        fromName: 'Alice',
        replyTo: 'msg-previous-abc123',
      }))

      expect(msg.fromName).toBe('Alice')
      expect(msg.replyTo).toBe('msg-previous-abc123')
    })
  })

  // ── query ─────────────────────────────────────────────

  describe('query', () => {
    it('returns empty array for agent with no messages', async () => {
      const msgs = await store.query({ agentId: TEAMLEAD })
      expect(msgs).toEqual([])
    })

    it('returns unread messages by default', async () => {
      const sent = await store.send(makeMessage())
      await store.markRead(TEAMLEAD, sent.id)
      await store.send(makeMessage({ subject: 'Second' }))

      const unread = await store.query({ agentId: TEAMLEAD, unreadOnly: true })
      expect(unread).toHaveLength(1)
      expect(unread[0].subject).toBe('Second')
    })

    it('returns all messages when unreadOnly is false', async () => {
      const sent = await store.send(makeMessage())
      await store.markRead(TEAMLEAD, sent.id)
      await store.send(makeMessage({ subject: 'Second' }))

      const all = await store.query({ agentId: TEAMLEAD, unreadOnly: false })
      expect(all).toHaveLength(2)
    })

    it('filters by sender', async () => {
      await store.send(makeMessage({ from: SUB_AGENT_A }))
      await store.send(makeMessage({ from: SUB_AGENT_B }))

      const fromA = await store.query({ agentId: TEAMLEAD, from: SUB_AGENT_A, unreadOnly: false })
      const fromB = await store.query({ agentId: TEAMLEAD, from: SUB_AGENT_B, unreadOnly: false })

      expect(fromA).toHaveLength(1)
      expect(fromA[0].from).toBe(SUB_AGENT_A)
      expect(fromB).toHaveLength(1)
      expect(fromB[0].from).toBe(SUB_AGENT_B)
    })

    it('sorts newest first', async () => {
      await store.send(makeMessage({ subject: 'First' }))
      // Ensure different timestamps
      await new Promise(r => setTimeout(r, 5))
      await store.send(makeMessage({ subject: 'Second' }))

      const msgs = await store.query({ agentId: TEAMLEAD, unreadOnly: false })
      expect(msgs[0].subject).toBe('Second')
      expect(msgs[1].subject).toBe('First')
    })

    it('supports pagination with limit and offset', async () => {
      for (let i = 0; i < 5; i++) {
        await store.send(makeMessage({ subject: `Msg ${i}` }))
        await new Promise(r => setTimeout(r, 2))
      }

      const page1 = await store.query({ agentId: TEAMLEAD, unreadOnly: false, limit: 2, offset: 0 })
      const page2 = await store.query({ agentId: TEAMLEAD, unreadOnly: false, limit: 2, offset: 2 })
      const page3 = await store.query({ agentId: TEAMLEAD, unreadOnly: false, limit: 2, offset: 4 })

      expect(page1).toHaveLength(2)
      expect(page2).toHaveLength(2)
      expect(page3).toHaveLength(1)

      // No duplicates across pages
      const allIds = [...page1, ...page2, ...page3].map(m => m.id)
      expect(new Set(allIds).size).toBe(5)
    })
  })

  // ── markRead ──────────────────────────────────────────

  describe('markRead', () => {
    it('marks a message as read and returns it', async () => {
      const sent = await store.send(makeMessage())
      expect(sent.read).toBe(false)

      const read = await store.markRead(TEAMLEAD, sent.id)
      expect(read).not.toBeNull()
      expect(read!.read).toBe(true)
      expect(read!.id).toBe(sent.id)
    })

    it('returns null for non-existent message', async () => {
      const result = await store.markRead(TEAMLEAD, 'msg-nonexistent-000000')
      expect(result).toBeNull()
    })

    it('returns null when checking wrong agent inbox', async () => {
      const sent = await store.send(makeMessage({ to: TEAMLEAD }))
      // Try to read from SUB_AGENT_A's inbox — message is in TEAMLEAD's inbox
      const result = await store.markRead(SUB_AGENT_A, sent.id)
      expect(result).toBeNull()
    })

    it('persists read state across queries', async () => {
      const sent = await store.send(makeMessage())
      await store.markRead(TEAMLEAD, sent.id)

      const unread = await store.query({ agentId: TEAMLEAD, unreadOnly: true })
      expect(unread).toHaveLength(0)

      const all = await store.query({ agentId: TEAMLEAD, unreadOnly: false })
      expect(all).toHaveLength(1)
      expect(all[0].read).toBe(true)
    })
  })

  // ── get ───────────────────────────────────────────────

  describe('get', () => {
    it('retrieves a specific message by id', async () => {
      const sent = await store.send(makeMessage())
      const fetched = await store.get(TEAMLEAD, sent.id)

      expect(fetched).not.toBeNull()
      expect(fetched!.id).toBe(sent.id)
      expect(fetched!.subject).toBe('Test message')
    })

    it('returns null for non-existent message', async () => {
      const result = await store.get(TEAMLEAD, 'msg-fake-999999')
      expect(result).toBeNull()
    })

    it('returns null when checking wrong agent inbox', async () => {
      const sent = await store.send(makeMessage({ to: TEAMLEAD }))
      const result = await store.get(SUB_AGENT_A, sent.id)
      expect(result).toBeNull()
    })
  })

  // ── clearInbox ────────────────────────────────────────

  describe('clearInbox', () => {
    it('removes all messages for an agent', async () => {
      await store.send(makeMessage({ to: TEAMLEAD }))
      await store.send(makeMessage({ to: TEAMLEAD }))
      await store.send(makeMessage({ to: TEAMLEAD }))

      await store.clearInbox(TEAMLEAD)

      const msgs = await store.query({ agentId: TEAMLEAD, unreadOnly: false })
      expect(msgs).toHaveLength(0)
    })

    it('does not affect other agent inboxes', async () => {
      await store.send(makeMessage({ to: TEAMLEAD }))
      await store.send(makeMessage({ from: TEAMLEAD, to: SUB_AGENT_A, subject: 'For A' }))

      await store.clearInbox(TEAMLEAD)

      const teamleadMsgs = await store.query({ agentId: TEAMLEAD, unreadOnly: false })
      const subAgentMsgs = await store.query({ agentId: SUB_AGENT_A, unreadOnly: false })

      expect(teamleadMsgs).toHaveLength(0)
      expect(subAgentMsgs).toHaveLength(1)
    })

    it('is safe to call on empty inbox', async () => {
      await expect(store.clearInbox('agent_nonexistent')).resolves.toBeUndefined()
    })
  })
})

// ── Integration scenario ────────────────────────────────

describe('Scenario: Teamlead ↔ Sub-agent workflow', () => {
  let store: MessageStore

  beforeEach(() => {
    store = new InMemoryMessageStore()
  })

  it('sub-agent reports result, teamlead reads it', async () => {
    // 1. Sub-agent sends a result to the teamlead
    const sent = await store.send({
      from: SUB_AGENT_A,
      fromName: 'Alice',
      to: TEAMLEAD,
      type: 'result',
      subject: 'PC-12 complete',
      body: 'Fixed the auth bug. PR #42 ready for review.',
    })

    // 2. Teamlead checks for unread messages
    const unread = await store.query({ agentId: TEAMLEAD, unreadOnly: true })
    expect(unread).toHaveLength(1)
    expect(unread[0].fromName).toBe('Alice')
    expect(unread[0].type).toBe('result')
    expect(unread[0].subject).toBe('PC-12 complete')

    // 3. Teamlead reads the message
    const read = await store.markRead(TEAMLEAD, sent.id)
    expect(read!.read).toBe(true)

    // 4. No more unread messages
    const unreadAfter = await store.query({ agentId: TEAMLEAD, unreadOnly: true })
    expect(unreadAfter).toHaveLength(0)
  })

  it('teamlead coordinates multiple sub-agents', async () => {
    // Two sub-agents report at different times
    await store.send({
      from: SUB_AGENT_A,
      fromName: 'Alice',
      to: TEAMLEAD,
      type: 'result',
      subject: 'Frontend done',
      body: 'Implemented the login page.',
    })

    await store.send({
      from: SUB_AGENT_B,
      fromName: 'Bob',
      to: TEAMLEAD,
      type: 'result',
      subject: 'API done',
      body: 'Auth endpoints deployed.',
    })

    // Teamlead checks all unread
    const all = await store.query({ agentId: TEAMLEAD, unreadOnly: true })
    expect(all).toHaveLength(2)

    // Teamlead filters by specific sub-agent
    const fromAlice = await store.query({ agentId: TEAMLEAD, from: SUB_AGENT_A, unreadOnly: true })
    expect(fromAlice).toHaveLength(1)
    expect(fromAlice[0].fromName).toBe('Alice')

    const fromBob = await store.query({ agentId: TEAMLEAD, from: SUB_AGENT_B, unreadOnly: true })
    expect(fromBob).toHaveLength(1)
    expect(fromBob[0].fromName).toBe('Bob')
  })

  it('reply chain between agents', async () => {
    // Teamlead asks sub-agent for help
    const request = await store.send({
      from: TEAMLEAD,
      to: SUB_AGENT_A,
      type: 'request',
      subject: 'Need help with PC-15',
      body: 'Can you look at the failing test in auth.test.ts?',
    })

    // Sub-agent replies
    const reply = await store.send({
      from: SUB_AGENT_A,
      to: TEAMLEAD,
      type: 'result',
      subject: 'Re: Need help with PC-15',
      body: 'Found the issue — missing mock for Redis client.',
      replyTo: request.id,
    })

    // Verify the thread links
    expect(reply.replyTo).toBe(request.id)

    // Teamlead can read the reply
    const fetched = await store.get(TEAMLEAD, reply.id)
    expect(fetched!.replyTo).toBe(request.id)
    expect(fetched!.body).toContain('missing mock for Redis client')
  })

  it('agent removal cleans up inbox', async () => {
    // Sub-agent has messages in inbox
    await store.send({ from: TEAMLEAD, to: SUB_AGENT_A, type: 'request', subject: 'Task', body: 'Do this' })
    await store.send({ from: TEAMLEAD, to: SUB_AGENT_A, type: 'info', subject: 'FYI', body: 'Note this' })

    // Sub-agent is removed — clean up
    await store.clearInbox(SUB_AGENT_A)

    const msgs = await store.query({ agentId: SUB_AGENT_A, unreadOnly: false })
    expect(msgs).toHaveLength(0)
  })
})

// ── MCP command handler tests ───────────────────────────

describe('messageCommands (bridge handlers)', () => {
  // These test the command handler layer that sits between MCP tools and the store.
  // We mock window.require('electron').ipcRenderer.invoke to route to an InMemoryMessageStore.

  let executeMessageAction: typeof import('../../mcpBridge/messageCommands').executeMessageAction
  let backingStore: InMemoryMessageStore

  beforeEach(async () => {
    backingStore = new InMemoryMessageStore()

    // Mock window.require('electron') to provide ipcRenderer.invoke
    ;(globalThis as any).window = {
      ...(globalThis as any).window,
      require: (mod: string) => {
        if (mod === 'electron') {
          return {
            ipcRenderer: {
              invoke: async (channel: string, params: any) => {
                switch (channel) {
                  case 'messages-send': return backingStore.send(params)
                  case 'messages-query': return backingStore.query(params)
                  case 'messages-mark-read': return backingStore.markRead(params.agentId, params.messageId)
                  case 'messages-get': return backingStore.get(params.agentId, params.messageId)
                  case 'messages-clear': { await backingStore.clearInbox(params.agentId); return { success: true } }
                  default: throw new Error(`Unknown IPC channel: ${channel}`)
                }
              },
            },
          }
        }
        throw new Error(`Unexpected require: ${mod}`)
      },
    }

    // Dynamic import to get fresh module
    const mod = await import('../../mcpBridge/messageCommands')
    executeMessageAction = mod.executeMessageAction
  })

  it('send_message returns success with messageId', async () => {
    const result = await executeMessageAction('send_message', {
      from: SUB_AGENT_A,
      fromName: 'Alice',
      to: TEAMLEAD,
      subject: 'Done',
      body: 'Task finished.',
      type: 'result',
    }) as any

    expect(result.success).toBe(true)
    expect(result.messageId).toMatch(/^msg-/)
    expect(result.timestamp).toBeGreaterThan(0)
  })

  it('send_message rejects missing fields', async () => {
    await expect(executeMessageAction('send_message', {
      from: SUB_AGENT_A,
      to: TEAMLEAD,
      // missing subject and body
    })).rejects.toThrow('Missing subject')
  })

  it('check_messages returns unread messages', async () => {
    await executeMessageAction('send_message', {
      from: SUB_AGENT_A, to: TEAMLEAD,
      subject: 'Hello', body: 'Hi there', type: 'info',
    })

    const result = await executeMessageAction('check_messages', {
      agentId: TEAMLEAD,
      unreadOnly: true,
    }) as any

    expect(result.count).toBe(1)
    expect(result.messages[0].subject).toBe('Hello')
  })

  it('read_message marks as read and returns content', async () => {
    const sendResult = await executeMessageAction('send_message', {
      from: SUB_AGENT_A, to: TEAMLEAD,
      subject: 'Report', body: 'Details here.', type: 'result',
    }) as any

    const readResult = await executeMessageAction('read_message', {
      agentId: TEAMLEAD,
      messageId: sendResult.messageId,
    }) as any

    expect(readResult.message.read).toBe(true)
    expect(readResult.message.body).toBe('Details here.')
  })

  it('read_message rejects non-existent messageId', async () => {
    await expect(executeMessageAction('read_message', {
      agentId: TEAMLEAD,
      messageId: 'msg-fake-000000',
    })).rejects.toThrow('not found')
  })

  it('list_messages returns all with pagination', async () => {
    for (let i = 0; i < 5; i++) {
      await executeMessageAction('send_message', {
        from: SUB_AGENT_A, to: TEAMLEAD,
        subject: `Msg ${i}`, body: `Body ${i}`, type: 'info',
      })
    }

    const result = await executeMessageAction('list_messages', {
      agentId: TEAMLEAD, limit: 3, offset: 0,
    }) as any

    expect(result.count).toBe(3)
    expect(result.messages).toHaveLength(3)
  })

  it('unknown action throws', async () => {
    await expect(
      executeMessageAction('bad_action', {})
    ).rejects.toThrow('Unknown message action')
  })
})
