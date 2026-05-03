import { useEffect, useRef } from 'react'
import type { IpcRendererEvent } from '../electron.d'
import type { DebugEventKind } from '../DebugPanel.js'
import type { AgentTerminalData, ShellTerminalData } from '../appTypes.js'
import { isAgentMcpControlled } from '../mcpBridge.js'

const { ipcRenderer } = window.require('electron')

interface PtyListenerDeps {
  agentTerminalsRef: React.RefObject<Map<string, AgentTerminalData>>
  shellTerminalsRef: React.RefObject<Map<number, ShellTerminalData>>
  statusCallbackRef: React.RefObject<(id: string, status: string | null) => void>
  debugCallbackRef: React.RefObject<(agentId: string, kind: DebugEventKind, label: string) => void>
  onShellProcessChange: (shellId: number, processName: string) => void
}

export function usePtyListeners(deps: PtyListenerDeps) {
  const { agentTerminalsRef, shellTerminalsRef, statusCallbackRef, debugCallbackRef, onShellProcessChange } = deps
  const onShellProcessChangeRef = useRef(onShellProcessChange)
  onShellProcessChangeRef.current = onShellProcessChange
  useEffect(() => {
    const ANSI_RE = /\x1b\[[0-9;]*[mGKHFABCDJsuhlr]|\x1b\][^\x07]*\x07/g
    const SPINNER_RE = /·\s+([A-Za-z][^\r\n]*(?:…|\.\.\.)(?:\s*\([^\r\n)]*\))?)/

    const handlePtyOutput = (_: IpcRendererEvent, { id, data, process: processName }: { id: number; data: string; process?: string }) => {
      for (const [shellId, shell] of shellTerminalsRef.current.entries()) {
        if (shell.ptyId === id) {
          shell.terminal.write(data)
          if (processName) onShellProcessChangeRef.current(shellId, processName)
          return
        }
      }
      for (const [agentId, agent] of agentTerminalsRef.current.entries()) {
        if (agent.ptyId === id) {
          // Only write to terminal here if the agent does NOT have an AgentHandle
          // (i.e. legacy path). When agentHandle exists, LocalTerminal already has
          // its own pty-output listener that writes to xterm — writing here too
          // would cause double output.
          // Skip writing when background tools are active (PTY suppressed).
          if (!agent.agentHandle && !(agent.bgToolIds?.size)) {
            agent.terminal?.write(data)
          }
          agent.lastOutputAt = Date.now()
          // Skip status updates when agent is under MCP control
          if (isAgentMcpControlled(agentId)) break
          const stripped = data.replace(ANSI_RE, '')

          for (const seg of stripped.split('\r')) {
            const m = SPINNER_RE.exec(seg)
            if (m) {
              statusCallbackRef.current(agentId, m[1].trim())
              debugCallbackRef.current(agentId, 'pty', `spinner: ${m[1].trim()}`)
            }
          }

          // Permission prompt detection removed – agents use --dangerously-skip-permissions
          break
        }
      }
    }

    const handlePtyExit = (_: IpcRendererEvent, { id, exitCode }: { id: number; exitCode: number }) => {
      for (const [shellId, shell] of shellTerminalsRef.current.entries()) {
        if (shell.ptyId === id) {
          shell.terminal.write(`\r\n\x1b[38;2;122;120;116m[process exited with code ${exitCode}]\x1b[0m\r\n`)
          return
        }
      }
      for (const [agentId, agent] of agentTerminalsRef.current.entries()) {
        if (agent.ptyId === id) {
          console.log(`[PixelCity] pty-exit agentId=${agentId} exitCode=${exitCode}`)
          debugCallbackRef.current(agentId, 'pty', `exit code ${exitCode}`)
          agent.exited = true // mark so sendPtyInput knows the process is dead
          if (exitCode !== 0) {
            agent.terminal?.write(`\r\n\x1b[38;2;122;120;116m[process exited with code ${exitCode}]\x1b[0m\r\n`)
          }
          // Keep agent in the list but mark as idle (don't remove on exit)
          statusCallbackRef.current(agentId, null)
          break
        }
      }
    }

    ipcRenderer.on('pty-output', handlePtyOutput)
    ipcRenderer.on('pty-exit', handlePtyExit)

    return () => {
      ipcRenderer.removeListener('pty-output', handlePtyOutput)
      ipcRenderer.removeListener('pty-exit', handlePtyExit)
    }
  }, [])

}
