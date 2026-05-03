import { useCallback, useRef } from 'react'
import type { DebugEventKind } from '../DebugPanel.js'
import type { AgentTrack } from '../permissionTimer.js'
import { PERMISSION_EXEMPT_TOOLS, getTrack, cancelPermTimer } from '../permissionTimer.js'
import { formatToolStatusJsonl } from '../toolStatus.js'
import type { AgentJsonlSession, AgentTerminalData } from '../appTypes.js'
import { isAgentMcpControlled, autoIdleMcpAgent } from '../mcpBridge.js'
import { officeStateRef } from '../office/officeStateRefs.js'
import { isBackgroundTool, bgToolLabel } from '../llm/backgroundTools.js'
import type { LocalTerminal } from '../backend/local/LocalTerminal.js'

const fs = window.require('fs') as typeof import('fs')
const path = window.require('path') as typeof import('path')

/** Tool names that spawn sub-agents in Claude Code */
const SUBAGENT_TOOL_NAMES = new Set(['Agent', 'Task'])

/** How often to poll the subagents directory for new files (ms) */
const SUBAGENT_DIR_POLL_MS = 1500
/** How often to poll individual subagent JSONL files for completion (ms) */
const SUBAGENT_FILE_POLL_MS = 2000
/** Safety-net timeout: if JSONL stops growing and no end_turn is found, despawn after this (ms) */
const SUBAGENT_IDLE_SAFETY_NET_MS = 120_000
/** After seeing end_turn, wait this long for any trailing writes before despawning (ms) */
const SUBAGENT_END_TURN_GRACE_MS = 4000

interface SubagentWatcher {
  parentAgentId: string
  toolUseId: string
  subCharId: string
  /** Interval polling the subagent's JSONL for completion */
  pollInterval: ReturnType<typeof setInterval> | null
  /** The subagent JSONL file path once discovered */
  jsonlPath: string | null
  /** Last known file size — when it stops growing, agent is done */
  lastSize: number
  /** Timestamp of last size change */
  lastSizeChange: number
  /** Byte offset for incremental reading of subagent JSONL */
  fileOffset: number
  /** Accumulated partial line from last read */
  lineBuffer: string
  /** Whether we've seen stop_reason: "end_turn" in the JSONL */
  sawEndTurn: boolean
}

interface JsonlWatchDeps {
  agentTrackRef: React.RefObject<Map<string, AgentTrack>>
  agentTerminalsRef: React.RefObject<Map<string, AgentTerminalData>>
  statusCallbackRef: React.RefObject<(id: string, status: string | null) => void>
  debugCallbackRef: React.RefObject<(agentId: string, kind: DebugEventKind, label: string) => void>
  startPermTimerRef: React.RefObject<(agentId: string, track: AgentTrack) => void>
}

export function useJsonlWatch(deps: JsonlWatchDeps) {
  const { agentTrackRef, agentTerminalsRef, statusCallbackRef, debugCallbackRef, startPermTimerRef } = deps
  const agentJsonlRef = useRef<Map<string, AgentJsonlSession>>(new Map())
  /** Active subagent watchers keyed by toolUseId */
  const subagentWatchers = useRef<Map<string, SubagentWatcher>>(new Map())
  /** Directory watcher for subagents/ folder, keyed by parent agentId */
  const subagentDirPollers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map())
  /** Known subagent files per parent session (to detect new ones) */
  const knownSubagentFiles = useRef<Map<string, Set<string>>>(new Map())
  /** Maps parentAgentId → list of pending toolUseIds waiting for subagent JSONL files */
  const pendingSubagents = useRef<Map<string, string[]>>(new Map())

  /** Resolve the subagents directory from a parent session's JSONL path */
  const getSubagentsDir = useCallback((parentJsonlPath: string): string => {
    // /path/to/{sessionId}.jsonl → /path/to/{sessionId}/subagents/
    const dir = parentJsonlPath.replace(/\.jsonl$/, '')
    return path.join(dir, 'subagents')
  }, [])

  /** Stop watching a specific subagent */
  const stopSubagentWatcher = useCallback((toolUseId: string) => {
    const w = subagentWatchers.current.get(toolUseId)
    if (!w) return
    if (w.pollInterval) clearInterval(w.pollInterval)
    subagentWatchers.current.delete(toolUseId)
  }, [])

  /** Remove a subagent character with despawn animation */
  const despawnSubagent = useCallback((parentAgentId: string, toolUseId: string) => {
    if (officeStateRef.current) {
      officeStateRef.current.removeSubagent(parentAgentId, toolUseId)
      console.log(`[SubAgent] DESPAWNED subagent for toolId="${toolUseId}"`)
    }
    stopSubagentWatcher(toolUseId)
  }, [stopSubagentWatcher])

  /** Start polling a discovered subagent JSONL file for completion (content-based despawn) */
  const watchSubagentFile = useCallback((watcher: SubagentWatcher, filePath: string) => {
    watcher.jsonlPath = filePath
    watcher.fileOffset = 0
    watcher.lineBuffer = ''
    try {
      const stat = fs.statSync(filePath)
      watcher.lastSize = stat.size
      watcher.lastSizeChange = Date.now()
    } catch {
      watcher.lastSize = 0
      watcher.lastSizeChange = Date.now()
    }

    console.log(`[SubAgent] watching file: ${path.basename(filePath)} for toolId="${watcher.toolUseId}"`)

    watcher.pollInterval = setInterval(() => {
      try {
        const stat = fs.statSync(filePath)
        if (stat.size !== watcher.lastSize) {
          watcher.lastSize = stat.size
          watcher.lastSizeChange = Date.now()
        }

        // Read new content and scan for end_turn completion signal
        if (stat.size > watcher.fileOffset) {
          const length = stat.size - watcher.fileOffset
          const buf = Buffer.alloc(length)
          const fd = fs.openSync(filePath, 'r')
          fs.readSync(fd, buf, 0, length, watcher.fileOffset)
          fs.closeSync(fd)
          watcher.fileOffset += length

          const text = watcher.lineBuffer + buf.toString('utf8')
          const lines = text.split('\n')
          watcher.lineBuffer = lines.pop() ?? ''

          for (const ln of lines) {
            if (!ln.trim()) continue
            try {
              const record = JSON.parse(ln)
              if (record.type === 'assistant' && record.message?.stop_reason === 'end_turn') {
                watcher.sawEndTurn = true
                watcher.lastSizeChange = Date.now() // reset idle timer for grace period
                console.log(`[SubAgent] end_turn found: ${path.basename(filePath)}`)
              }
            } catch { /* ignore malformed lines */ }
          }
        }

        // When file is idle and we haven't seen end_turn, check if lineBuffer has it
        // (handles case where end_turn is the last line without a trailing newline)
        if (!watcher.sawEndTurn && watcher.lineBuffer.trim() && stat.size <= watcher.fileOffset) {
          try {
            const record = JSON.parse(watcher.lineBuffer)
            if (record.type === 'assistant' && record.message?.stop_reason === 'end_turn') {
              watcher.sawEndTurn = true
              watcher.lastSizeChange = Date.now()
              watcher.lineBuffer = ''
              console.log(`[SubAgent] end_turn found in lineBuffer: ${path.basename(filePath)}`)
            }
          } catch { /* incomplete line, keep waiting */ }
        }

        // Check idle timeout — fast if end_turn seen, slow safety-net otherwise
        if (stat.size === watcher.lastSize) {
          const idleMs = Date.now() - watcher.lastSizeChange
          if (watcher.sawEndTurn && idleMs >= SUBAGENT_END_TURN_GRACE_MS) {
            console.log(`[SubAgent] end_turn + ${idleMs}ms idle, despawning: ${path.basename(filePath)}`)
            despawnSubagent(watcher.parentAgentId, watcher.toolUseId)
          } else if (!watcher.sawEndTurn && idleMs >= SUBAGENT_IDLE_SAFETY_NET_MS) {
            console.log(`[SubAgent] safety-net timeout (${idleMs}ms idle), despawning: ${path.basename(filePath)}`)
            despawnSubagent(watcher.parentAgentId, watcher.toolUseId)
          }
        }
      } catch {
        // File deleted or inaccessible — subagent is done
        console.log(`[SubAgent] file gone, despawning: ${path.basename(filePath)}`)
        despawnSubagent(watcher.parentAgentId, watcher.toolUseId)
      }
    }, SUBAGENT_FILE_POLL_MS)
  }, [despawnSubagent])

  /** Poll the subagents/ directory for new JSONL files and match them to pending subagents */
  const pollSubagentsDir = useCallback((agentId: string, subagentsDir: string) => {
    try {
      const files = fs.readdirSync(subagentsDir).filter((f: string) => f.endsWith('.jsonl') && !f.includes('compact'))
      const known = knownSubagentFiles.current.get(agentId) ?? new Set()
      const pending = pendingSubagents.current.get(agentId) ?? []

      for (const file of files) {
        if (known.has(file)) continue

        // New subagent JSONL file discovered — match to oldest pending toolUseId
        if (pending.length > 0) {
          known.add(file)
          const toolUseId = pending.shift()!
          const watcher = subagentWatchers.current.get(toolUseId)
          if (watcher && !watcher.jsonlPath) {
            const fullPath = path.join(subagentsDir, file)
            watchSubagentFile(watcher, fullPath)
            console.log(`[SubAgent] matched file "${file}" to toolId="${toolUseId}"`)
          }
        }
        // Don't add to known if no pending — file may need matching later
      }

      knownSubagentFiles.current.set(agentId, known)
      pendingSubagents.current.set(agentId, pending)
    } catch {
      // Directory doesn't exist yet — that's fine
    }
  }, [watchSubagentFile])

  /** Start directory polling for a parent agent's subagents */
  const startSubagentDirPoll = useCallback((agentId: string, parentJsonlPath: string) => {
    const subagentsDir = getSubagentsDir(parentJsonlPath)

    if (subagentDirPollers.current.has(agentId)) {
      // Already polling — just do an immediate poll to match any newly pending subagents
      pollSubagentsDir(agentId, subagentsDir)
      return
    }

    // Don't snapshot existing files — we want to match them to pending subagents.
    // The pending queue ensures only explicitly spawned subagents get matched.
    if (!knownSubagentFiles.current.has(agentId)) {
      knownSubagentFiles.current.set(agentId, new Set())
    }

    const poller = setInterval(() => pollSubagentsDir(agentId, subagentsDir), SUBAGENT_DIR_POLL_MS)
    subagentDirPollers.current.set(agentId, poller)
    // Do an immediate poll
    pollSubagentsDir(agentId, subagentsDir)
    console.log(`[SubAgent] started dir polling: ${subagentsDir}`)
  }, [getSubagentsDir, pollSubagentsDir])

  /** Stop directory polling for a parent agent */
  const stopSubagentDirPoll = useCallback((agentId: string) => {
    const poller = subagentDirPollers.current.get(agentId)
    if (poller) {
      clearInterval(poller)
      subagentDirPollers.current.delete(agentId)
    }
    knownSubagentFiles.current.delete(agentId)
    pendingSubagents.current.delete(agentId)
  }, [])

  const processJsonlLine = useCallback((agentId: string, line: string) => {
    try {
      const record = JSON.parse(line)

      // ── Sub-agent spawn detection (runs for ALL agents including MCP-controlled) ──
      if (record.type === 'assistant' && Array.isArray(record.message?.content)) {
        for (const block of record.message.content as Array<{ type: string; id?: string; name?: string; input?: Record<string, unknown> }>) {
          if (block.type === 'tool_use' && block.id && block.name && SUBAGENT_TOOL_NAMES.has(block.name) && officeStateRef.current) {
            // Don't re-spawn if already tracked
            if (subagentWatchers.current.has(block.id)) continue

            const subId = officeStateRef.current.addSubagent(agentId, block.id)
            officeStateRef.current.setAgentActive(subId, true)
            const desc = (block.input as Record<string, unknown>)?.description as string | undefined
            if (desc) officeStateRef.current.setAgentStatusText(subId, desc)

            // Create a watcher — the subagent JSONL file will be matched via dir polling
            const watcher: SubagentWatcher = {
              parentAgentId: agentId,
              toolUseId: block.id,
              subCharId: subId,
              pollInterval: null,
              jsonlPath: null,
              lastSize: 0,
              lastSizeChange: Date.now(),
              fileOffset: 0,
              lineBuffer: '',
              sawEndTurn: false,
            }
            subagentWatchers.current.set(block.id, watcher)

            // Add to pending queue for dir-poll matching
            const pending = pendingSubagents.current.get(agentId) ?? []
            pending.push(block.id)
            pendingSubagents.current.set(agentId, pending)

            // Start dir polling if not already
            const session = agentJsonlRef.current.get(agentId)
            if (session) {
              startSubagentDirPoll(agentId, session.jsonlPath)
            }

            console.log(`[SubAgent] SPAWNED subId=${subId} for parent=${agentId} toolId="${block.id}" desc="${desc ?? block.name}"`)
            debugCallbackRef.current(agentId, 'system', `sub-agent spawned: ${block.id} (${desc ?? block.name})`)
          }
        }
      }
      // NOTE: We intentionally do NOT remove subagents on tool_result.
      // Claude writes tool_use and tool_result together retroactively,
      // so they arrive in the same batch causing instant spawn+despawn.
      // Removal is handled by watching the subagent's own JSONL file for inactivity.

      // Auto-idle MCP-controlled agents when their turn ends
      if (isAgentMcpControlled(agentId)) {
        if (record.type === 'system' && record.subtype === 'turn_duration') {
          autoIdleMcpAgent(agentId)
          debugCallbackRef.current(agentId, 'system', `turn_duration ${record.durationMs ?? ''}ms (auto-idle)`)
        }
        return
      }

      if (record.type === 'assistant' && Array.isArray(record.message?.content)) {
        const blocks = record.message.content as Array<{ type: string; id?: string; name?: string; input?: Record<string, unknown> }>
        let firstToolUse: { id: string; name: string; input: Record<string, unknown> } | null = null
        let hasText = false
        let hasThinking = false

        for (const block of blocks) {
          if (block.type === 'tool_use' && block.id && block.name) {
            const track = getTrack(agentTrackRef.current, agentId)
            track.activeToolIds.add(block.id)
            track.activeToolNames.set(block.id, block.name)
            track.hadToolsInTurn = true
            if (!firstToolUse) firstToolUse = { id: block.id, name: block.name, input: block.input ?? {} }

            // ── Background tool suppression ──
            if (isBackgroundTool(block.name)) {
              const agent = agentTerminalsRef.current.get(agentId)
              if (agent) {
                if (!agent.bgToolIds) agent.bgToolIds = new Set()
                agent.bgToolIds.add(block.id)
                // Suppress PTY output on LocalTerminal (new path)
                if (agent.agentHandle?.terminal) {
                  (agent.agentHandle.terminal as LocalTerminal).suppressed = true
                }
                // Write compact indicator to terminal
                const label = bgToolLabel(block.name)
                const line = `\r\n\x1b[38;2;122;120;116m  \u25c6 ${label}\x1b[0m`
                if (agent.agentHandle?.terminal) {
                  ;(agent.agentHandle.terminal as any).getXterm?.()?.write?.(line)
                } else {
                  agent.terminal?.write(line)
                }
              }
            }
          } else if (block.type === 'text') {
            hasText = true
          } else if (block.type === 'thinking') {
            hasThinking = true
          }
        }

        if (firstToolUse) {
          const track = getTrack(agentTrackRef.current, agentId)
          let hasNonExempt = false
          for (const [, name] of track.activeToolNames) {
            if (!PERMISSION_EXEMPT_TOOLS.has(name)) { hasNonExempt = true; break }
          }
          if (hasNonExempt) startPermTimerRef.current(agentId, track)

          const statusText = formatToolStatusJsonl(firstToolUse.name, firstToolUse.input)
          statusCallbackRef.current(agentId, statusText)
          debugCallbackRef.current(agentId, 'tool', `${firstToolUse.name} → ${statusText}`)
        } else if (hasText) {
          statusCallbackRef.current(agentId, null)
          debugCallbackRef.current(agentId, 'text', 'final response, turn done')
        } else if (hasThinking) {
          statusCallbackRef.current(agentId, 'Thinking…')
          debugCallbackRef.current(agentId, 'thinking', 'extended thinking')
        }

      } else if (record.type === 'user') {
        const content = record.message?.content
        if (Array.isArray(content)) {
          const track = getTrack(agentTrackRef.current, agentId)
          for (const block of content as Array<{ type: string; tool_use_id?: string }>) {
            if (block.type === 'tool_result' && block.tool_use_id) {
              // ── Clear background tool suppression ──
              const agent = agentTerminalsRef.current.get(agentId)
              if (agent?.bgToolIds?.has(block.tool_use_id)) {
                agent.bgToolIds.delete(block.tool_use_id)
                if (agent.bgToolIds.size === 0) {
                  if (agent.agentHandle?.terminal) {
                    (agent.agentHandle.terminal as LocalTerminal).suppressed = false
                  }
                }
              }
              track.activeToolIds.delete(block.tool_use_id)
              track.activeToolNames.delete(block.tool_use_id)
            }
          }
          let hasNonExempt = false
          for (const [, name] of track.activeToolNames) {
            if (!PERMISSION_EXEMPT_TOOLS.has(name)) { hasNonExempt = true; break }
          }
          if (!hasNonExempt) cancelPermTimer(track)
          if (track.activeToolIds.size === 0) track.hadToolsInTurn = false
        } else if (typeof content === 'string' && content.trim()) {
          const track = agentTrackRef.current.get(agentId)
          if (track) { cancelPermTimer(track); track.activeToolIds.clear(); track.activeToolNames.clear(); track.hadToolsInTurn = false }
        }

      } else if (record.type === 'system' && record.subtype === 'turn_duration') {
        const track = agentTrackRef.current.get(agentId)
        if (track) { cancelPermTimer(track); track.activeToolIds.clear(); track.activeToolNames.clear(); track.hadToolsInTurn = false }
        // Clear any lingering background tool suppression
        const agent = agentTerminalsRef.current.get(agentId)
        if (agent?.bgToolIds?.size) {
          agent.bgToolIds.clear()
          if (agent.agentHandle?.terminal) {
            (agent.agentHandle.terminal as LocalTerminal).suppressed = false
          }
        }
        statusCallbackRef.current(agentId, null)
        debugCallbackRef.current(agentId, 'system', `turn_duration ${record.durationMs ?? ''}ms`)

      } else if (record.type === 'system') {
        debugCallbackRef.current(agentId, 'system', record.subtype ?? record.type)

      } else if (record.type === 'progress') {
        const dataType = record.data?.type as string | undefined
        if (dataType === 'bash_progress' || dataType === 'mcp_progress') {
          const track = agentTrackRef.current.get(agentId)
          if (track) {
            let hasNonExempt = false
            for (const [, name] of track.activeToolNames) {
              if (!PERMISSION_EXEMPT_TOOLS.has(name)) { hasNonExempt = true; break }
            }
            if (hasNonExempt) startPermTimerRef.current(agentId, track)
          }
        } else if (dataType === 'query_update' && record.data?.query) {
          const q: string = record.data.query
          const label = `Searching: ${q.length > 40 ? q.slice(0, 40) + '…' : q}`
          statusCallbackRef.current(agentId, label)
          debugCallbackRef.current(agentId, 'tool', `query_update → ${label}`)
        }
      }
    } catch { /* ignore malformed lines */ }
  }, [startSubagentDirPoll])

  const readNewLines = useCallback((agentId: string) => {
    const session = agentJsonlRef.current.get(agentId)
    if (!session) return
    try {
      const stat = fs.statSync(session.jsonlPath)
      if (stat.size <= session.fileOffset) return
      const length = stat.size - session.fileOffset
      const buf = Buffer.alloc(length)
      const fd = fs.openSync(session.jsonlPath, 'r')
      fs.readSync(fd, buf, 0, length, session.fileOffset)
      fs.closeSync(fd)
      session.fileOffset += length
      const text = session.lineBuffer + buf.toString('utf8')
      const lines = text.split('\n')
      session.lineBuffer = lines.pop() ?? ''
      for (const ln of lines) {
        if (ln.trim()) processJsonlLine(agentId, ln)
      }
    } catch { /* file not yet created or read error */ }
  }, [processJsonlLine])

  const stopJsonlWatch = useCallback((agentId: string) => {
    const session = agentJsonlRef.current.get(agentId)
    if (!session) return
    if (session.existencePoller) clearInterval(session.existencePoller)
    if (session.pollInterval) clearInterval(session.pollInterval)
    if (session.watcher) { try { session.watcher.close() } catch { /* ignore */ } }
    agentJsonlRef.current.delete(agentId)
    // Remove any sub-agents spawned by this agent
    if (officeStateRef.current) {
      officeStateRef.current.removeAllSubagents(agentId)
    }
    // Clean up all subagent watchers for this parent
    for (const [toolId, w] of subagentWatchers.current) {
      if (w.parentAgentId === agentId) {
        stopSubagentWatcher(toolId)
      }
    }
    stopSubagentDirPoll(agentId)
  }, [stopSubagentWatcher, stopSubagentDirPoll])

  const startJsonlWatch = useCallback((agentId: string, jsonlPath: string) => {
    const session: AgentJsonlSession = {
      jsonlPath,
      fileOffset: 0,
      lineBuffer: '',
      watcher: null,
      existencePoller: null,
      pollInterval: null,
    }
    agentJsonlRef.current.set(agentId, session)

    const beginWatching = () => {
      if (!agentJsonlRef.current.has(agentId)) return
      readNewLines(agentId)
      try {
        session.watcher = fs.watch(jsonlPath, () => readNewLines(agentId))
      } catch { /* ignore watch errors */ }
      session.pollInterval = setInterval(() => readNewLines(agentId), 2000)
    }

    try {
      fs.statSync(jsonlPath)
      beginWatching()
    } catch {
      session.existencePoller = setInterval(() => {
        if (!agentJsonlRef.current.has(agentId)) return
        try {
          fs.statSync(jsonlPath)
          clearInterval(session.existencePoller!)
          session.existencePoller = null
          beginWatching()
        } catch { /* still doesn't exist */ }
      }, 1000)
    }
  }, [readNewLines])

  return { agentJsonlRef, startJsonlWatch, stopJsonlWatch }
}
