// ── Platform Bridge ─────────────────────────────────────────────────
// Single access point for platform-specific operations.
//
// Usage:
//   import { platform } from './platform'
//   const folder = await platform.dialog.openFolder()
//   const config = await platform.config.load(projectDir)
//
// The bridge is initialized once at app startup. Desktop uses
// electronBridge; web-app will register its own implementation.

import type { PlatformBridge } from './types.js'

let _bridge: PlatformBridge | null = null

/** Get the active platform bridge. Throws if not initialized. */
export function platform(): PlatformBridge {
  if (!_bridge) throw new Error('PlatformBridge not initialized — call initPlatform() first')
  return _bridge
}

/** Initialize the platform bridge. Call once at app startup. */
export function initPlatform(bridge: PlatformBridge): void {
  _bridge = bridge
}

/** Check if a platform bridge has been initialized. */
export function hasPlatform(): boolean {
  return _bridge !== null
}

// Re-export types
export type { PlatformBridge } from './types.js'
export type {
  ConfigBridge,
  DialogBridge,
  SettingsBridge,
  AuthBridge,
  NotificationBridge,
  AppBridge,
  BuildingBridge,
  WorkspaceBridge,
  UsageBridge,
  PtyBridge,
  TerminalSettings,
  EditorSettings,
  FileFilter,
  FileSystemBridge,
  FsEntry,
  FsListResult,
} from './types.js'

// Re-export Electron implementation (desktop only)
export { electronBridge } from './electron.js'
