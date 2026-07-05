import type { InjectionKey, Ref } from 'vue'

/**
 * Mutation + selection API provided once at CanvasContentEditor.vue and
 * inject()ed by CanvasBlock.vue at every recursion depth. Avoids prop/emit
 * drilling through an arbitrarily deep block tree — every CanvasBlock instance,
 * however nested, talks to the same flat useCanvas() state directly.
 */
export interface CanvasApi {
  selectedId: Ref<string | null>
  selectBlock(id: string | null): void
  addBlock(typeId: string, target?: { parentId: string | null; slot: string | null; index?: number }): void
  removeBlock(id: string): void
  updateBlockProp(id: string, key: string, value: unknown): void
  duplicateBlock(id: string): void
  moveBlock(id: string, direction: 'up' | 'down'): void
  moveBlockToSlot(id: string, targetParentId: string | null, targetSlot: string | null, targetIndex: number): void
  /** Snapshots current state as one undo step — called at the start of a drag
   * gesture so the whole gesture (however many arrays it touches) undoes as one step. */
  recordDiscrete(): void
  /** Sortable `:move` veto — rejects dropping a block into itself or its own
   * descendant, which would otherwise create a circular reference. */
  checkMove(evt: { draggedContext?: { element?: { id?: string } }; to?: HTMLElement }): boolean
  /** Opens the block picker; target omitted = insert at end of root. */
  openPicker(target?: { parentId: string | null; slot: string | null; index?: number }): void
}

export const canvasApiKey: InjectionKey<CanvasApi> = Symbol('nuxflow:canvasApi')
