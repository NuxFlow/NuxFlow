import { ref, computed, inject } from 'vue'
import type { CanvasContent, CanvasBlockData, CanvasBlockDefinition } from '../types'
import { emptyCanvas } from '../types'
import { getBlockDefinition } from '../blocks/definitions'
import { findParentList, findBlockById, isDescendant, cloneWithNewIds } from '../tree'

interface BlockRegistryLike {
  meta(id: string): { name: string; icon?: string; description?: string } | undefined
  resolve(id: string): object | undefined
  getDefinition(id: string): unknown
  all(): Array<{ id: string; name: string; icon?: string }>
  dynamicBlocks(): Array<{ id: string; name: string; icon?: string }>
}

function uuid(): string {
  return crypto.randomUUID()
}

const MAX_HISTORY = 50
const BURST_DEBOUNCE_MS = 600

export function useCanvas(initial?: CanvasContent) {
  const registry = inject<BlockRegistryLike | null>('nuxflow:blockRegistry', null)

  const canvas = ref<CanvasContent>(
    initial ? JSON.parse(JSON.stringify(initial)) : emptyCanvas(),
  )

  const selectedId = ref<string | null>(null)

  const selectedBlock = computed(() =>
    selectedId.value ? findBlockById(canvas.value.blocks, selectedId.value) : null,
  )

  const selectedDefinition = computed((): CanvasBlockDefinition | null => {
    if (!selectedBlock.value) return null
    const def = getBlockDefinition(selectedBlock.value.type)
    if (def) return def
    // Dynamic plugin block — check if the plugin registered a full definition
    // (with fields) so the settings panel renders proper field editors.
    const regDef = registry?.getDefinition(selectedBlock.value.type)
    if (regDef) return regDef as CanvasBlockDefinition
    // Fall back to a minimal shell using registry metadata (name + icon only)
    // so the settings panel at least renders with move/delete controls.
    const regMeta = registry?.meta(selectedBlock.value.type)
    if (regMeta) {
      return {
        id: selectedBlock.value.type,
        name: regMeta.name,
        description: regMeta.description,
        icon: regMeta.icon ?? 'i-lucide-box',
        category: 'advanced',
        component: '',
        fields: [],
        defaultProps: {},
      }
    }
    return null
  })

  // ── History (undo/redo) ──────────────────────────────────────────────────
  //
  // Snapshot-based: each undo step is a full deep-cloned CanvasContent taken
  // *before* the mutation it represents. Discrete mutations (add/remove/move/
  // duplicate/moveToSlot) push one snapshot immediately. Continuous mutations
  // (updateBlockProp, fired every keystroke) are grouped into a single undo
  // step per burst of edits to the same `${blockId}:${propKey}` target,
  // committed after BURST_DEBOUNCE_MS of inactivity on that target.

  const undoStack = ref<CanvasContent[]>([])
  const redoStack = ref<CanvasContent[]>([])

  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)

  function snapshot(): CanvasContent {
    return JSON.parse(JSON.stringify(canvas.value))
  }

  function pushUndo(snap: CanvasContent) {
    undoStack.value.push(snap)
    if (undoStack.value.length > MAX_HISTORY) undoStack.value.shift()
    redoStack.value = []
  }

  let burstTimer: ReturnType<typeof setTimeout> | null = null
  let burstKey: string | null = null
  let burstPreSnapshot: CanvasContent | null = null

  /** Commits any in-flight debounced burst as its own undo step right now,
   * synchronously — must run before any discrete mutation or undo/redo so
   * stack ordering can never be corrupted by a stale timer firing late. */
  function flushPendingBurst() {
    if (burstTimer !== null) {
      clearTimeout(burstTimer)
      burstTimer = null
    }
    if (burstPreSnapshot) {
      pushUndo(burstPreSnapshot)
      burstPreSnapshot = null
    }
    burstKey = null
  }

  function recordDiscrete() {
    flushPendingBurst()
    pushUndo(snapshot())
  }

  function recordDebounced(blockId: string, propKey: string) {
    const key = `${blockId}:${propKey}`
    if (burstKey !== key) {
      // Editing a different target — close out any prior burst as its own
      // step before starting a new one, so unrelated edits never merge.
      flushPendingBurst()
      burstKey = key
      burstPreSnapshot = snapshot()
    } else if (burstTimer !== null) {
      clearTimeout(burstTimer)
    }
    burstTimer = setTimeout(() => {
      if (burstPreSnapshot) pushUndo(burstPreSnapshot)
      burstPreSnapshot = null
      burstKey = null
      burstTimer = null
    }, BURST_DEBOUNCE_MS)
  }

  function undo() {
    flushPendingBurst()
    const prev = undoStack.value.pop()
    if (!prev) return
    redoStack.value.push(snapshot())
    canvas.value = prev
    selectedId.value = null
  }

  function redo() {
    flushPendingBurst()
    const next = redoStack.value.pop()
    if (!next) return
    undoStack.value.push(snapshot())
    canvas.value = next
    selectedId.value = null
  }

  // ── Tree helpers ──────────────────────────────────────────────────────────

  function getListFor(parentId: string | null, slot: string | null): CanvasBlockData[] | null {
    if (parentId === null) return canvas.value.blocks
    const parent = findBlockById(canvas.value.blocks, parentId)
    if (!parent || !slot) return null
    if (!parent.children) parent.children = {}
    if (!parent.children[slot]) parent.children[slot] = []
    return parent.children[slot]
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  function addBlock(typeId: string, target?: { parentId: string | null; slot: string | null; index?: number }) {
    const def = getBlockDefinition(typeId)
    // For dynamic plugin blocks: use the registered definition's defaultProps if
    // available so the block renders with sensible initial values.
    const regDef = !def ? registry?.getDefinition(typeId) as CanvasBlockDefinition | undefined : undefined
    const block: CanvasBlockData = {
      id: uuid(),
      type: typeId,
      props: def ? { ...def.defaultProps } : regDef ? { ...regDef.defaultProps } : {},
    }

    const targetList = target ? getListFor(target.parentId, target.slot) : canvas.value.blocks
    if (!targetList) return

    recordDiscrete()
    const idx = target?.index ?? targetList.length
    targetList.splice(idx, 0, block)
    selectedId.value = block.id
  }

  function removeBlock(id: string) {
    const found = findParentList(canvas.value.blocks, id)
    if (!found) return

    recordDiscrete()

    // If the current selection is the removed block itself or lives anywhere
    // inside the subtree being removed, clear it — otherwise the settings
    // panel would keep pointing at a block that no longer exists.
    if (selectedId.value && (selectedId.value === id || isDescendant(canvas.value.blocks, id, selectedId.value))) {
      selectedId.value = null
    }

    found.list.splice(found.index, 1)
  }

  function updateBlockProp(id: string, key: string, value: unknown) {
    const found = findParentList(canvas.value.blocks, id)
    if (!found) return
    recordDebounced(id, key)
    const block = found.list[found.index]!
    block.props = { ...block.props, [key]: value }
  }

  function moveBlock(id: string, direction: 'up' | 'down') {
    const found = findParentList(canvas.value.blocks, id)
    if (!found) return
    const { list, index } = found
    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= list.length) return

    recordDiscrete()
    const block = list.splice(index, 1)[0]
    if (!block) return
    list.splice(target, 0, block)
  }

  /** Reorders within a single list (root, or one block's slot) — same-list drag. */
  function reorderBlock(parentId: string | null, slot: string | null, fromIndex: number, toIndex: number) {
    const list = getListFor(parentId, slot)
    if (!list) return
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return
    if (fromIndex >= list.length || toIndex >= list.length) return

    recordDiscrete()
    const block = list.splice(fromIndex, 1)[0]
    if (!block) return
    // After removing fromIndex, positions after it shift left by 1
    const adjusted = toIndex > fromIndex ? toIndex - 1 : toIndex
    list.splice(adjusted, 0, block)
  }

  /** Moves a block into a different list — cross-list drag (root <-> slot, or
   * slot <-> slot). Rejected as a no-op if the target is the block itself or
   * lives inside the block's own subtree, which would otherwise create a
   * circular reference. */
  function moveBlockToSlot(id: string, targetParentId: string | null, targetSlot: string | null, targetIndex: number) {
    if (targetParentId !== null) {
      if (targetParentId === id || isDescendant(canvas.value.blocks, id, targetParentId)) return
    }

    const found = findParentList(canvas.value.blocks, id)
    if (!found) return
    const targetList = getListFor(targetParentId, targetSlot)
    if (!targetList) return

    recordDiscrete()
    const block = found.list.splice(found.index, 1)[0]
    if (!block) return
    const idx = Math.min(Math.max(targetIndex, 0), targetList.length)
    targetList.splice(idx, 0, block)
  }

  function duplicateBlock(id: string) {
    const found = findParentList(canvas.value.blocks, id)
    if (!found) return
    const orig = found.list[found.index]
    if (!orig) return

    recordDiscrete()
    const clone = cloneWithNewIds(orig, uuid)
    found.list.splice(found.index + 1, 0, clone)
    selectedId.value = clone.id
  }

  function selectBlock(id: string | null) {
    selectedId.value = id
  }

  function reset(content: CanvasContent) {
    flushPendingBurst()
    canvas.value = JSON.parse(JSON.stringify(content))
    selectedId.value = null
    undoStack.value = []
    redoStack.value = []
  }

  // ── Serialise ─────────────────────────────────────────────────────────────

  function toJSON(): CanvasContent {
    return JSON.parse(JSON.stringify(canvas.value))
  }

  return {
    canvas,
    selectedId,
    selectedBlock,
    selectedDefinition,
    addBlock,
    removeBlock,
    updateBlockProp,
    moveBlock,
    reorderBlock,
    moveBlockToSlot,
    duplicateBlock,
    selectBlock,
    reset,
    toJSON,
    undo,
    redo,
    canUndo,
    canRedo,
    undoStack,
    redoStack,
    flushPendingBurst,
    recordDiscrete,
  }
}
