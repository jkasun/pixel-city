/** Shared drag state for cross-component file drag & drop. */
let _draggedFilePath: string | null = null
const _listeners: Array<(dragging: boolean, path: string | null) => void> = []

export function setDraggedFilePath(path: string | null) {
  const prevPath = _draggedFilePath
  _draggedFilePath = path
  // When drag ends (path → null), pass the previous path so listeners can act on it
  _listeners.forEach(fn => fn(path !== null, path ?? prevPath))
}

export function getDraggedFilePath(): string | null {
  return _draggedFilePath
}

export function onFileDragChange(fn: (dragging: boolean, path: string | null) => void) {
  _listeners.push(fn)
  return () => {
    const i = _listeners.indexOf(fn)
    if (i >= 0) _listeners.splice(i, 1)
  }
}
