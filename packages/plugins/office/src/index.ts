/**
 * Office Plugin Package
 *
 * Exports office manifest, store DI, types, and shared OfficeView component.
 * The consuming apps provide their own OfficeStore implementations and
 * wrap the shared OfficeView with platform-specific features (editor, etc.)
 */

import { OfficeBuildingIcon } from './icons.js'
import type { PluginManifest } from '@pixel-city/core'

export const officeManifest: PluginManifest = {
  id: 'office',
  name: 'Office',
  icon: OfficeBuildingIcon,
  order: 10,
  description: 'Virtual office with pixel-art characters',
  builtIn: true,
}

// Office store DI
export { getOfficeStore, setOfficeStore } from './office/index.js'

// Types
export type { OfficeStore, OfficeAgent, FloorEntry } from './office/types.js'

// Components
export { OfficeView } from './components/index.js'
export type { OfficeViewProps } from './components/index.js'
export { FullOfficeView, normalizeLayout } from './components/index.js'
export type { FullOfficeViewProps, FullOfficeViewHandle } from './components/index.js'
export { MiniMap, AgentLabels, ZoomControls, OfficeInstructionsDialog, OfficeSettingsDialog, DEFAULT_PLUGIN_SETTINGS } from './components/index.js'
export type { OfficeSettingsDialogProps, OfficePluginSettings } from './components/index.js'

// Editor components
export { OfficeCanvas, EditorToolbar, FloorGeneratorPanel, CharacterPicker, AGENT_MODELS } from './components/index.js'
export type { OfficeCanvasProps } from './components/index.js'
export type { EditorToolbarProps } from './components/index.js'
export type { FloorGeneratorPanelProps } from './components/index.js'

// Tutorial
export { useOfficeTutorial } from './tutorial/useOfficeTutorial.js'
export type { TutorialStep } from './tutorial/useOfficeTutorial.js'
export { TutorialOverlay } from './tutorial/TutorialOverlay.js'
export type { TutorialOverlayProps } from './tutorial/TutorialOverlay.js'

// Icons
export { OfficeBuildingIcon } from './icons.js'
