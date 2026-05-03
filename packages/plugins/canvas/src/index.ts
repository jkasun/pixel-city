// Canvas Plugin Module
// Agent HTML canvas rendering in the PluginPanel sidebar.
// Provides per-agent tabs and sandboxed iframe rendering.

import { CanvasPlugin } from './components/CanvasPlugin.js'
import { CanvasIcon } from './icons.js'
import type { PluginModule } from '@pixel-city/core'

export const canvasPlugin: PluginModule = {
  manifest: {
    id: 'canvas',
    name: 'Canvas',
    icon: CanvasIcon,
    order: 45,
    description: 'Agent HTML canvas rendering',
    builtIn: true,
  },

  Component: CanvasPlugin,
}

// Re-export stores for consumers
export { getCanvasStore, setCanvasStore } from './store.js'
export type { CanvasContent, CanvasStore, CanvasVersion } from './store.js'
export { useCanvasStore } from './useCanvasStore.js'
export { useCanvasVersions } from './useCanvasVersions.js'

// Pure patcher (importable from any process)
export { applyPatch } from './patcher.js'
export type { CanvasEdit, PatchResult, PatchError } from './patcher.js'

// User drawing store
export { getUserDrawingStore, setUserDrawingStore } from './userDrawingStore.js'
export type { UserDrawingSnapshot, UserDrawingStore } from './userDrawingStore.js'
export { useUserDrawingStore } from './useUserDrawingStore.js'

// Drawing editor ref (L2 bridge)
export { getDrawingEditor, setDrawingEditor } from './userDrawingEditorRef.js'
