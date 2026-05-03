// VersionHistorySidebar — L4 Component
// Collapsible right sidebar showing canvas version history per agent.

import { useCanvasVersions } from '../useCanvasVersions.js'
import { getCanvasStore } from '../store.js'

interface VersionHistorySidebarProps {
  agentId: string | null
  isOpen: boolean
  onToggle: () => void
}

function ClockIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 4.5V8l2.5 1.5" />
    </svg>
  )
}

function RestoreIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 4.5h4.5V0" />
      <path d="M1 4.5C2.2 2 4.5 0.5 7 0.5A5.5 5.5 0 1 1 1.5 6" />
    </svg>
  )
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function VersionHistorySidebar({ agentId, isOpen, onToggle }: VersionHistorySidebarProps) {
  const versions = useCanvasVersions(agentId)

  // Collapsed state — thin strip with icon + count
  if (!isOpen) {
    return (
      <div
        className="flex flex-col items-center py-2 gap-1 border-l border-border bg-bg-card cursor-pointer select-none shrink-0 text-text-dim hover:bg-bg-hover hover:text-text transition-colors"
        style={{ width: 32 }}
        onClick={onToggle}
        title="Show version history"
      >
        <ClockIcon size={18} />
        {versions.length > 0 && (
          <span className="text-[10px] text-text-dim">{versions.length}</span>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col border-l border-border bg-bg-card shrink-0 overflow-hidden" style={{ width: 200 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border shrink-0">
        <span className="text-[11px] font-semibold text-text-dim flex items-center gap-1">
          <ClockIcon size={14} />
          History ({versions.length})
        </span>
        <button
          className="bg-none border-none text-text-dim cursor-pointer p-0.5 rounded hover:text-text hover:bg-bg-hover text-[11px]"
          onClick={onToggle}
          title="Collapse"
        >
          &raquo;
        </button>
      </div>

      {/* Version list */}
      <div className="flex-1 overflow-y-auto">
        {versions.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-dim/60 text-[11px] px-2 text-center">
            No versions yet. Versions are captured each time the canvas is updated.
          </div>
        ) : (
          <div className="flex flex-col">
            {[...versions].reverse().map((version, idx) => (
              <button
                key={version.id}
                className="flex items-start gap-1.5 px-2 py-1.5 border-0 border-b border-border bg-transparent text-left cursor-pointer hover:bg-bg-hover transition-colors group"
                onClick={() => {
                  if (agentId) {
                    getCanvasStore().restoreVersion(agentId, version.id)
                  }
                }}
                title={`Restore version ${version.id}`}
              >
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="text-[11px] text-text truncate">
                    {idx === 0 ? 'Latest' : `v${version.id}`}
                    {version.title && (
                      <span className="text-text-dim ml-1">— {version.title}</span>
                    )}
                  </span>
                  <span className="text-[9px] text-white">
                    {formatRelativeTime(version.timestamp)}
                  </span>
                </div>
                <span className="opacity-0 group-hover:opacity-100 text-text-dim mt-0.5 transition-opacity">
                  <RestoreIcon />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
