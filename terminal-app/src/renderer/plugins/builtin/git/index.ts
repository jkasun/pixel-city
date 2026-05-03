// ── Git Plugin Module ───────────────────────────────────────────────

import { GitPlugin } from './GitPlugin.js'
import { gitManifest } from '@pixel-city/plugin-git'
import type { PluginModule } from '../../types.js'

export const gitPlugin: PluginModule = {
  manifest: gitManifest,
  Component: GitPlugin,
}
