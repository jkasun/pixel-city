// ── Session Chooser ─────────────────────────────────────────────────
// Provider-neutral chooser shown in the message pane when the user
// clicks an agent that has no active session. Offers
// "+ Start a new chat" plus any past sessions in this project that
// belong to this agent.
//
// Each provider supplies its own `listSessions` / `readIndex` /
// `formatModelLabel` via SessionChooserBinding.

import { useMemo } from 'react'

interface SessionSummary {
  sessionId: string
  mtimeMs: number
  turnCount: number
  preview: string
  startedAt?: string
}

interface SessionMeta {
  agentId: string
  agentName: string
  modelId: string
  label?: string
  spawnedAt: string
}

export interface SessionChooserBinding {
  /** Provider id — exposed for keying / debugging. */
  providerId: string
  /** Read past sessions for this provider in the given cwd. */
  listSessions: (cwd: string) => SessionSummary[]
  /** Read the project-local index of {sessionId → meta}. */
  readIndex: (cwd: string) => Record<string, SessionMeta>
  /** Format a model id into a short label (e.g. 'Opus' / 'Sonnet' / 'GPT-5.5'). Optional. */
  formatModelLabel?: (modelId: string) => string
}

interface SessionChooserProps {
  agentName: string
  /** Project working directory — required to read past sessions */
  cwd: string | null
  binding: SessionChooserBinding
  onNewChat: () => void
  onResume: (sessionId: string) => void
}

interface ChooserEntry extends SessionSummary {
  agentName?: string
  modelId?: string
  isOwnedByAgent: boolean
}

function formatRelative(mtimeMs: number): string {
  const diff = Date.now() - mtimeMs
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  const week = Math.floor(day / 7)
  if (week < 4) return `${week}w ago`
  return new Date(mtimeMs).toLocaleDateString()
}

function defaultFormatModel(modelId: string): string {
  if (modelId.includes('opus')) return 'Opus'
  if (modelId.includes('sonnet')) return 'Sonnet'
  if (modelId.includes('haiku')) return 'Haiku'
  if (modelId.startsWith('gpt-')) return modelId.replace(/^gpt-/i, 'GPT-')
  return modelId
}

export function SessionChooser({
  agentName,
  cwd,
  binding,
  onNewChat,
  onResume,
}: SessionChooserProps) {
  const entries: ChooserEntry[] = useMemo(() => {
    if (!cwd) return []
    const summaries = binding.listSessions(cwd)
    const index = binding.readIndex(cwd)
    const merged: ChooserEntry[] = summaries.map((s) => {
      const meta = index[s.sessionId]
      return {
        ...s,
        agentName: meta?.agentName,
        modelId: meta?.modelId,
        // agentId is regenerated per spawn — match on the stable agentName.
        isOwnedByAgent: !!meta?.agentName && meta.agentName === agentName,
      }
    })
    return merged.filter((e) => e.isOwnedByAgent)
  }, [cwd, agentName, binding])

  const formatModel = binding.formatModelLabel ?? defaultFormatModel

  return (
    <div
      className="flex flex-col h-full w-full overflow-hidden"
      style={{ background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}
    >
      {/* Header */}
      <div className="flex items-center gap-[7px] h-[28px] px-3 bg-bg-card border-b border-border flex-shrink-0">
        <span className="text-[0.78rem] font-medium text-text-bright whitespace-nowrap">
          {agentName}
        </span>
        <span className="text-[0.68rem] text-text-muted">
          {entries.length === 0 ? 'No past sessions' : `${entries.length} past`}
        </span>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5">
        {/* Always-on "Start a new chat" card */}
        <button
          type="button"
          onClick={onNewChat}
          className="text-left rounded border border-dashed transition-colors px-2.5 py-1.5 cursor-pointer hover:border-accent focus:outline-none focus:ring-1 focus:ring-accent flex items-center gap-2"
          style={{ borderColor: 'var(--accent, #5ac8e8)' }}
        >
          <span className="text-[0.85rem] font-medium" style={{ color: 'var(--accent, #5ac8e8)' }}>+</span>
          <span className="text-[0.78rem] font-medium text-text-bright">Start a new chat</span>
          <span className="text-[0.66rem] text-text-muted ml-auto">empty context</span>
        </button>

        {entries.length === 0 ? (
          <EmptyState agentName={agentName} />
        ) : (
          entries.map((entry) => (
            <SessionCard
              key={entry.sessionId}
              entry={entry}
              formatModel={formatModel}
              onResume={() => onResume(entry.sessionId)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function SessionCard({
  entry,
  formatModel,
  onResume,
}: {
  entry: ChooserEntry
  formatModel: (modelId: string) => string
  onResume: () => void
}) {
  return (
    <button
      type="button"
      onClick={onResume}
      className="text-left rounded border border-border bg-bg-card transition-colors px-2.5 py-1.5 cursor-pointer hover:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
    >
      <div className="text-[0.78rem] text-text-bright truncate leading-tight">
        {entry.preview}
      </div>
      <div className="flex items-center gap-1.5 text-[0.66rem] text-text-muted mt-0.5">
        <span>{formatRelative(entry.mtimeMs)}</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span>{entry.turnCount} turn{entry.turnCount === 1 ? '' : 's'}</span>
        {entry.modelId ? (
          <>
            <span style={{ opacity: 0.4 }}>·</span>
            <span>{formatModel(entry.modelId)}</span>
          </>
        ) : null}
      </div>
    </button>
  )
}

function EmptyState({ agentName }: { agentName: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-6 px-3 text-text-muted">
      <div className="text-[1.1rem] opacity-40 mb-1">⌛</div>
      <div className="text-[0.75rem] text-text-bright">
        No previous chats with {agentName}
      </div>
      <div className="text-[0.68rem] mt-0.5 max-w-[24rem]">
        Past sessions in this project will appear here.
      </div>
    </div>
  )
}
