// ── Browser Plugin Module ───────────────────────────────────────────

import { BrowserPlugin } from './BrowserPlugin.js'
import { GlobeIcon } from '../../../icons/index.js'
import type { PluginModule } from '../../types.js'

export const browserPlugin: PluginModule = {
  manifest: {
    id: 'browser',
    name: 'Browser',
    icon: GlobeIcon,
    order: 40,
    description: 'Built-in web browser',
    builtIn: true,
  },
  Component: BrowserPlugin,
}
