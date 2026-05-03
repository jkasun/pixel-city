/** Shared drag state for cross-component file drag & drop (bridges react-dnd and native drops). */
let _draggedFilePath: string | null = null
const _listeners: Array<(dragging: boolean) => void> = []

export function setDraggedFilePath(path: string | null) {
  _draggedFilePath = path
  _listeners.forEach(fn => fn(path !== null))
}

export function getDraggedFilePath(): string | null {
  return _draggedFilePath
}

export function onFileDragChange(fn: (dragging: boolean) => void) {
  _listeners.push(fn)
  return () => {
    const i = _listeners.indexOf(fn)
    if (i >= 0) _listeners.splice(i, 1)
  }
}
