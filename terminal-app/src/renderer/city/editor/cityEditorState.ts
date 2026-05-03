import { CityEditTool, CityTileType } from '@pixel-city/shared/city/editor/cityLayoutTypes'
import type { CityTileType as CityTileTypeVal, CityLayout } from '@pixel-city/shared/city/editor/cityLayoutTypes'
import { UNDO_STACK_MAX_SIZE } from '@pixel-city/shared/constants'

export class CityEditorState {
  isEditMode = false
  activeTool: CityEditTool = CityEditTool.SELECT
  selectedTileType: CityTileTypeVal = CityTileType.GRASS_1
  selectedBuildingDefId: string | null = null

  // Ghost preview position
  ghostCol = -1
  ghostRow = -1
  ghostValid = false

  // Selection
  selectedBuildingUid: string | null = null

  // Mouse drag state (terrain paint)
  isDragging = false

  // Undo / Redo stacks
  undoStack: CityLayout[] = []
  redoStack: CityLayout[] = []

  // Drag-to-move state
  dragUid: string | null = null
  dragStartCol = 0
  dragStartRow = 0
  dragOffsetCol = 0
  dragOffsetRow = 0
  isDragMoving = false

  pushUndo(layout: CityLayout): void {
    this.undoStack.push(layout)
    if (this.undoStack.length > UNDO_STACK_MAX_SIZE) {
      this.undoStack.shift()
    }
  }

  popUndo(): CityLayout | null {
    return this.undoStack.pop() || null
  }

  pushRedo(layout: CityLayout): void {
    this.redoStack.push(layout)
    if (this.redoStack.length > UNDO_STACK_MAX_SIZE) {
      this.redoStack.shift()
    }
  }

  popRedo(): CityLayout | null {
    return this.redoStack.pop() || null
  }

  clearRedo(): void {
    this.redoStack = []
  }

  clearSelection(): void {
    this.selectedBuildingUid = null
  }

  clearGhost(): void {
    this.ghostCol = -1
    this.ghostRow = -1
    this.ghostValid = false
  }

  startDrag(uid: string, startCol: number, startRow: number, offsetCol: number, offsetRow: number): void {
    this.dragUid = uid
    this.dragStartCol = startCol
    this.dragStartRow = startRow
    this.dragOffsetCol = offsetCol
    this.dragOffsetRow = offsetRow
    this.isDragMoving = false
  }

  clearDrag(): void {
    this.dragUid = null
    this.isDragMoving = false
  }

  reset(): void {
    this.activeTool = CityEditTool.SELECT
    this.selectedBuildingUid = null
    this.selectedBuildingDefId = null
    this.ghostCol = -1
    this.ghostRow = -1
    this.ghostValid = false
    this.isDragging = false
    this.undoStack = []
    this.redoStack = []
    this.dragUid = null
    this.isDragMoving = false
  }
}
