// ── Files Plugin Module ─────────────────────────────────────────────

import { FilesPlugin } from './FilesPlugin.js'
import { filesManifest } from '@pixel-city/plugin-files'
import type { PluginModule } from '../../types.js'

export const filesPlugin: PluginModule = {
  manifest: filesManifest,
  Component: FilesPlugin,
}
