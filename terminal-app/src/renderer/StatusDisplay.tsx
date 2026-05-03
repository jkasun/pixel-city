import React, { useState, useEffect, useMemo } from 'react'

const SZ = 10

function Ico({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width={SZ} height={SZ}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, opacity: 0.7 }}
    >
      {children}
    </svg>
  )
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

const ICONS = {
  search: (
    <Ico>
      <circle cx="6.5" cy="6.5" r="4" />
      <line x1="9.5" y1="9.5" x2="13.5" y2="13.5" />
    </Ico>
  ),
  file: (
    <Ico>
      <path d="M4 2h5.5L12 4.5V14H4V2z" />
      <polyline points="9,2 9,5 12,5" />
    </Ico>
  ),
  edit: (
    <Ico>
      <path d="M11.5 2.5l2 2L5 13H2.5v-2.5L11.5 2.5z" />
    </Ico>
  ),
  terminal: (
    <Ico>
      <polyline points="3,5 7.5,8 3,11" />
      <line x1="9" y1="11" x2="13" y2="11" />
    </Ico>
  ),
  globe: (
    <Ico>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 2.5C6.5 4.5 6.5 11.5 8 13.5C9.5 11.5 9.5 4.5 8 2.5z" />
      <line x1="2.5" y1="8" x2="13.5" y2="8" />
    </Ico>
  ),
  plan: (
    <Ico>
      <path d="M8 2a4 4 0 0 1 2 7.5V11H6V9.5A4 4 0 0 1 8 2z" />
      <line x1="6.5" y1="13" x2="9.5" y2="13" />
      <line x1="6" y1="11" x2="10" y2="11" />
    </Ico>
  ),
  branch: (
    <Ico>
      <circle cx="5" cy="4" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="11" cy="4" r="1.5" fill="currentColor" stroke="none" />
      <path d="M5 5.5v3a2.5 2.5 0 0 0 2.5 2.5H11V8.5" />
      <line x1="11" y1="5.5" x2="11" y2="3" />
    </Ico>
  ),
  chat: (
    <Ico>
      <path d="M2 3h12v8H9l-3 3V11H2z" />
    </Ico>
  ),
  folder: (
    <Ico>
      <path d="M2 5h4l1.5 2H14v6H2V5z" />
    </Ico>
  ),
  trash: (
    <Ico>
      <polyline points="2,4 14,4" />
      <path d="M5 4V2h6v2" />
      <path d="M4.5 4l1 10h5l1-10" />
    </Ico>
  ),
  copy: (
    <Ico>
      <rect x="6" y="5" width="7" height="9" rx="1" />
      <path d="M3 11.5V3h7" />
    </Ico>
  ),
  tool: (
    <Ico>
      <rect x="3" y="3" width="10" height="10" rx="2" />
      <line x1="8" y1="6" x2="8" y2="10" />
      <line x1="6" y1="8" x2="10" y2="8" />
    </Ico>
  ),
  approval: (
    <Ico>
      <path d="M8 2L14 13H2z" />
      <line x1="8" y1="7" x2="8" y2="10" />
      <circle cx="8" cy="12" r="0.5" fill="currentColor" stroke="none" />
    </Ico>
  ),
} satisfies Record<string, React.ReactElement>

type IconKey = keyof typeof ICONS

function getIconKey(text: string): IconKey {
  if (RE_SEARCH.test(text))   return 'search'
  if (RE_FILE.test(text))     return 'file'
  if (RE_EDIT.test(text))     return 'edit'
  if (RE_GLOBE.test(text))    return 'globe'
  if (RE_PLAN.test(text))     return 'plan'
  if (RE_BRANCH.test(text))   return 'branch'
  if (RE_CHAT.test(text))     return 'chat'
  if (RE_FOLDER.test(text))   return 'folder'
  if (RE_TRASH.test(text))    return 'trash'
  if (RE_COPY.test(text))     return 'copy'
  if (RE_TERMINAL.test(text)) return 'terminal'
  if (RE_APPROVAL.test(text)) return 'approval'
  return 'tool'
}

// "Searching: pattern" → "Searching pattern"
function stripColon(text: string): string {
  return text.replace(/^([^:]+):\s*(.+)$/, '$1 $2')
}

interface StatusDisplayProps {
  text: string
  style?: React.CSSProperties
  /** Timestamp (ms) when this status started — enables elapsed timer */
  startedAt?: number
}

const PTY_SPINNER_RE = /^[A-Z][a-z]+…\s*\(/

// Pre-compiled regexes for getIconKey (avoid recompilation per call)
const RE_SEARCH   = /^(Searching|Finding)/i
const RE_FILE     = /^(Listing|Reading)/i
const RE_EDIT     = /^(Writing|Editing|Updating)/i
const RE_GLOBE    = /^(Fetching|Downloading)/i
const RE_PLAN     = /^(Planning|Thinking)/i
const RE_BRANCH   = /^Subtask/i
const RE_CHAT     = /^Waiting/i
const RE_FOLDER   = /^Creating/i
const RE_TRASH    = /^Removing/i
const RE_COPY     = /^(Copying|Moving)/i
const RE_TERMINAL = /^(Running|npm|npx|pnpm|yarn|bun|git|docker)/i
const RE_APPROVAL = /^Needs\s+approval/i

// Extracted constant styles to avoid per-render object allocation
const BASE_STYLE: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 3, fontVariantNumeric: 'tabular-nums' }
const MARKER_STYLE: React.CSSProperties = { flexShrink: 0, opacity: 0.7 }
const META_STYLE: React.CSSProperties = { opacity: 0.5, fontSize: '0.9em' }

export function StatusDisplay({ text, style, startedAt }: StatusDisplayProps) {
  const [now, setNow] = useState(() => Date.now())

  const isPtySpinner = PTY_SPINNER_RE.test(text)
  const isActive = startedAt != null && !isPtySpinner

  // Tick every second while active (drives elapsed time)
  useEffect(() => {
    if (!isActive) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [isActive])

  const elapsed = isActive ? now - startedAt! : 0

  // Merge base style with custom style only when custom style is provided
  const mergedStyle = useMemo(
    () => style ? { ...BASE_STYLE, ...style } : BASE_STYLE,
    [style]
  )

  // PTY spinner — already formatted by Claude, just show with ✢
  if (isPtySpinner) {
    return (
      <span style={mergedStyle}>
        <span style={MARKER_STYLE}>✢</span>
        <span>{text}</span>
      </span>
    )
  }

  let meta = ''
  if (isActive && elapsed >= 1000) {
    meta = ` (${formatElapsed(elapsed)})`
  }

  const displayText = stripColon(text)

  return (
    <span style={mergedStyle}>
      {isActive
        ? <span style={MARKER_STYLE}>✢</span>
        : ICONS[getIconKey(text)]
      }
      <span>{displayText}</span>
      {meta && (
        <span style={META_STYLE}>{meta}</span>
      )}
    </span>
  )
}
