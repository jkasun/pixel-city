/**
 * Shared office canvas interaction handlers.
 *
 * Encodes the canonical behaviour for normal-mode (non-editor) interactions:
 *   • Left-click  → select / deselect agent, seat reassignment
 *   • Middle-click → pan (drag)
 *   • Right-click  → walk selected agent to tile
 *   • Scroll       → pan the office
 *   • Ctrl/⌘ + Scroll → zoom
 *
 * Both terminal-app and web-app delegate to these so behaviour stays in sync.
 */

import type { OfficeState } from '../engine/officeState.js'
import { scalePanDelta, screenToWorld, screenToTile } from './canvasUtils.js'
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_SCROLL_THRESHOLD,
} from '../../constants.js'

// ── Types ────────────────────────────────────────────────────────

export interface InteractionRefs {
  canvas: HTMLCanvasElement
  offset: { x: number; y: number }
  pan: { x: number; y: number }
  zoom: number
}

export interface PanState {
  isPanning: boolean
  mouseX: number
  mouseY: number
  panX: number
  panY: number
}

// ── Wheel (scroll = pan, Ctrl/⌘+scroll = zoom) ──────────────────

export function handleOfficeWheel(
  deltaX: number,
  deltaY: number,
  ctrlOrMeta: boolean,
  refs: InteractionRefs,
  officeState: OfficeState,
  zoomAccumulator: { current: number },
  clampPan: (x: number, y: number) => { x: number; y: number },
  onZoomChange: (newZoom: number) => void,
): void {
  if (ctrlOrMeta) {
    // Zoom
    zoomAccumulator.current += deltaY
    if (Math.abs(zoomAccumulator.current) >= ZOOM_SCROLL_THRESHOLD) {
      const delta = zoomAccumulator.current < 0 ? 1 : -1
      zoomAccumulator.current = 0
      const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, refs.zoom + delta))
      if (newZoom !== refs.zoom) {
        onZoomChange(newZoom)
      }
    }
  } else {
    // Pan
    officeState.cameraFollowId = null
    const newPan = clampPan(
      refs.pan.x - scalePanDelta(deltaX),
      refs.pan.y - scalePanDelta(deltaY),
    )
    refs.pan.x = newPan.x
    refs.pan.y = newPan.y
  }
}

// ── Click (select agent / seat interaction / deselect) ───────────

export interface ClickCallbacks {
  onAgentClick?: (agentId: string) => void
}

/**
 * Normal-mode click handler.
 * Returns true if the click was handled (consumed).
 */
export function handleOfficeClick(
  clientX: number,
  clientY: number,
  refs: InteractionRefs,
  officeState: OfficeState,
  callbacks: ClickCallbacks,
): boolean {
  const { canvas, offset, zoom } = refs
  const layout = officeState.getLayout()

  // Hit-test characters via world coords
  const pos = screenToWorld(clientX, clientY, canvas, offset, zoom)
  if (!pos) return false

  const hitId = officeState.getCharacterAt(pos.worldX, pos.worldY)
  if (hitId !== null) {
    officeState.dismissBubble(hitId)
    if (officeState.selectedAgentId === hitId) {
      // Toggle off
      officeState.selectedAgentId = null
      officeState.cameraFollowId = null
    } else {
      officeState.selectedAgentId = hitId
      officeState.cameraFollowId = hitId
    }
    callbacks.onAgentClick?.(hitId)
    return true
  }

  // Seat click while an agent is selected
  if (officeState.selectedAgentId !== null) {
    const selectedCh = officeState.characters.get(officeState.selectedAgentId)
    if (selectedCh && !selectedCh.isSubagent) {
      const tile = screenToTile(clientX, clientY, canvas, offset, zoom, layout.cols, layout.rows, true)
      if (tile) {
        const seatId = officeState.getSeatAtTile(tile.col, tile.row)
        if (seatId) {
          const seat = officeState.seats.get(seatId)
          if (seat && selectedCh) {
            if (selectedCh.seatId === seatId) {
              officeState.sendToSeat(officeState.selectedAgentId)
              officeState.selectedAgentId = null
              officeState.cameraFollowId = null
              return true
            } else if (!seat.assigned) {
              officeState.reassignSeat(officeState.selectedAgentId, seatId)
              officeState.selectedAgentId = null
              officeState.cameraFollowId = null
              return true
            }
          }
        }
      }
    }
    // Clicked empty space — deselect
    officeState.selectedAgentId = null
    officeState.cameraFollowId = null
  }

  return false
}

// ── Context menu (right-click walk) ──────────────────────────────

export function handleOfficeContextMenu(
  clientX: number,
  clientY: number,
  refs: InteractionRefs,
  officeState: OfficeState,
): void {
  if (officeState.selectedAgentId !== null) {
    const layout = officeState.getLayout()
    const tile = screenToTile(clientX, clientY, refs.canvas, refs.offset, refs.zoom, layout.cols, layout.rows, true)
    if (tile) {
      officeState.walkToTile(officeState.selectedAgentId, tile.col, tile.row)
    }
  }
}

// ── Hover (normal mode) ──────────────────────────────────────────

export function handleOfficeHover(
  clientX: number,
  clientY: number,
  refs: InteractionRefs,
  officeState: OfficeState,
): void {
  const { canvas, offset, zoom } = refs
  const layout = officeState.getLayout()
  const tile = screenToTile(clientX, clientY, canvas, offset, zoom, layout.cols, layout.rows, true)
  if (tile) {
    officeState.hoveredTile = tile
    // Check if hovering over a character
    const pos = screenToWorld(clientX, clientY, canvas, offset, zoom)
    if (pos) {
      officeState.hoveredAgentId = officeState.getCharacterAt(pos.worldX, pos.worldY)
    }
  } else {
    officeState.hoveredTile = null
    officeState.hoveredAgentId = null
  }

  // Cursor
  if (officeState.hoveredAgentId) {
    canvas.style.cursor = 'pointer'
  } else if (officeState.selectedAgentId !== null && tile) {
    const seatId = officeState.getSeatAtTile(tile.col, tile.row)
    if (seatId) {
      const seat = officeState.seats.get(seatId)
      if (seat) {
        const selectedCh = officeState.characters.get(officeState.selectedAgentId)
        if (!seat.assigned || (selectedCh && selectedCh.seatId === seatId)) {
          canvas.style.cursor = 'pointer'
          return
        }
      }
    }
    canvas.style.cursor = 'default'
  } else {
    canvas.style.cursor = 'default'
  }
}

// ── Mouse down (middle-click pan start) ──────────────────────────

/**
 * Returns true if a pan was started (middle-click).
 * The caller should store the returned PanState if true.
 */
export function handleOfficeMouseDown(
  button: number,
  clientX: number,
  clientY: number,
  refs: InteractionRefs,
  officeState: OfficeState,
): PanState | null {
  if (button === 1) {
    // Middle-click: start panning
    officeState.cameraFollowId = null
    refs.canvas.style.cursor = 'grabbing'
    return {
      isPanning: true,
      mouseX: clientX,
      mouseY: clientY,
      panX: refs.pan.x,
      panY: refs.pan.y,
    }
  }
  return null
}

// ── Mouse leave ──────────────────────────────────────────────────

export function handleOfficeMouseLeave(officeState: OfficeState): void {
  officeState.hoveredAgentId = null
  officeState.hoveredTile = null
}
