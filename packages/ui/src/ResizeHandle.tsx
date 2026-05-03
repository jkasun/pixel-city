/**
 * ResizeHandle — draggable divider between panels.
 *
 * A simple 4px bar that highlights on hover and reports drag deltas.
 * Used by the web-app between PluginPanel and AgentPanel.
 * Desktop uses Split.js gutters instead, so this is optional.
 */

import React, { useCallback, useRef } from 'react'

export interface ResizeHandleProps {
  /** Called once when drag starts */
  onResizeStart?: () => void
  /** Called continuously during drag with the x-delta from drag start */
  onResize: (deltaX: number) => void
  /** Direction: 'col' for horizontal split, 'row' for vertical */
  direction?: 'col' | 'row'
  /** Override the handle width/height in px (default: 4) */
  size?: number
}

export function ResizeHandle({ onResizeStart, onResize, direction = 'col', size = 4 }: ResizeHandleProps) {
  const dragging = useRef(false)
  const handleRef = useRef<HTMLDivElement>(null)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    onResizeStart?.()
    const startPos = direction === 'col' ? e.clientX : e.clientY
    const el = handleRef.current

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      const delta = (direction === 'col' ? ev.clientX : ev.clientY) - startPos
      onResize(delta)
    }

    const onMouseUp = () => {
      dragging.current = false
      if (el) el.style.background = 'transparent'
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [onResizeStart, onResize, direction])

  const isCol = direction === 'col'

  return (
    <div
      ref={handleRef}
      data-testid="resize-handle"
      onMouseDown={handleMouseDown}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent)' }}
      onMouseLeave={e => { if (!dragging.current) e.currentTarget.style.background = 'transparent' }}
      style={{
        width: isCol ? size : undefined,
        height: isCol ? undefined : size,
        cursor: isCol ? 'col-resize' : 'row-resize',
        flexShrink: 0,
        background: 'transparent',
        transition: 'background 0.12s',
      }}
    />
  )
}
