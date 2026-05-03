// ── Create Dynamic Plugin Module ────────────────────────────────────
// Converts a DynamicPluginRecord (from RTDB) into a PluginModule
// that the plugin registry understands.

import React from 'react'
import { DynamicPluginView } from './DynamicPluginView.js'
import type { PluginModule, PluginProps } from '../types.js'
import type { DynamicPluginRecord } from './types.js'

/** Create an emoji icon component that satisfies PluginManifest.icon */
function createEmojiIcon(emoji: string): React.ComponentType<{ size?: number }> {
  return function EmojiIcon({ size = 16 }: { size?: number }) {
    return React.createElement('span', {
      style: {
        fontSize: size * 0.75,
        lineHeight: `${size}px`,
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      },
    }, emoji)
  }
}

/** Convert a DynamicPluginRecord into a PluginModule for the registry. */
export function createDynamicPluginModule(record: DynamicPluginRecord, buildingId: string): PluginModule {
  const IconComponent = createEmojiIcon(record.icon || '🔌')

  function DynamicComponent(props: PluginProps) {
    return React.createElement(DynamicPluginView, {
      ...props,
      record,
      buildingId,
    })
  }

  return {
    manifest: {
      id: record.id,
      name: record.name,
      icon: IconComponent,
      order: record.order,
      description: record.description,
      builtIn: false,
    },
    Component: DynamicComponent,
  }
}
