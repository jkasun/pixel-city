// ── @pixel-city/ui ──────────────────────────────────────────────────
// Shared UI components for agent sessions and terminals.
// Both terminal-app (desktop) and web-app consume these, each providing
// their own ISessionAdapter implementation.

export { SessionProvider, useSession } from './SessionContext.js'
export { TerminalView, type TerminalViewProps } from './TerminalView.js'
export { SpawnDialog, type SpawnDialogProps } from './SpawnDialog.js'
export { DmSidebar } from './DmSidebar.js'
export type { DmSidebarProps, InactiveFloorGroup } from './DmSidebar.js'
export { ModelChip, type ModelChipProps } from './ModelChip.js'
export { TerminalArea, type TerminalAreaProps } from './TerminalArea.js'
export { StatusBar, type StatusBarProps } from './StatusBar.js'

// Layout
export { WorkspaceLayout, type WorkspaceLayoutProps, type WorkspaceLayoutRef } from './WorkspaceLayout.js'
export { ResizeHandle, type ResizeHandleProps } from './ResizeHandle.js'

// Utility components
export { StatusDisplay } from './StatusDisplay.js'
export { CharacterAvatar, type CharacterAvatarProps } from './CharacterAvatar.js'
export { AgentIcon } from './AgentIcon.js'

// Icons
export * from './icons/index.js'
