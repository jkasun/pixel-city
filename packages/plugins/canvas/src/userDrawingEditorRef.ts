// userDrawingEditorRef — L2 Bridge
// Module-level holder for the Excalidraw imperative API.
// L4 (DrawTab) sets it when Excalidraw mounts, L2 (canvasCommands) reads it for screenshots.
// Pure TS — no React imports.

import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'

let editorRef: ExcalidrawImperativeAPI | null = null

export function setDrawingEditor(editor: ExcalidrawImperativeAPI | null): void {
  editorRef = editor
}

export function getDrawingEditor(): ExcalidrawImperativeAPI | null {
  return editorRef
}
