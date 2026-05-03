// ── Built-in Plugin Registration ─────────────────────────────────────
// Registers all built-in plugins with the registry. Called once at startup.

import { pluginRegistry } from '../registry.js'
import { boardPlugin } from './board/index.js'
import { filesPlugin } from './files/index.js'
import { browserPlugin } from './browser/index.js'
import { canvasPlugin } from './canvas/index.js'
import { gitPlugin } from './git/index.js'
import { messagesPlugin } from './messages/index.js'

/** Register all built-in plugins. Ordered by manifest.order when rendered. */
export function registerBuiltinPlugins(): void {
  pluginRegistry.register(boardPlugin)        // order: 20
  pluginRegistry.register(filesPlugin)        // order: 30
  pluginRegistry.register(browserPlugin)      // order: 40
  pluginRegistry.register(canvasPlugin)       // order: 45
  pluginRegistry.register(gitPlugin)          // order: 50
  pluginRegistry.register(messagesPlugin)     // order: 70

  // Future: pluginRegistry.register(officePlugin)
}
