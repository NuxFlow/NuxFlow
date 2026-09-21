import { ref, computed, inject, onBeforeUnmount } from 'vue'
import type { CanvasContent, CanvasBlockData, CanvasBlockDefinition, CanvasBlockRegistry } from '../types'
import { emptyCanvas } from '../types'
import { resolveDefinition } from '../blocks/definitions'
import { findParentList, findBlockById, isDescendant, cloneWithNewIds } from '../tree'
import { useCanvasHistory } from './useCanvasHistory'

// Deliberate exception to the server-side "always use ulid(), never crypto.randomUUID()"
// convention: these are ephemeral client-side tree-node ids scoped to one canvas
// document (Vue :key values, tree lookups), never a D1 primary key, and this package
// ships to the browser bundle where the server-only `ulid` util isn't available anyway.
function uuid(): string {
  return crypto.randomUUID()
}

const PROP_COMMIT_DEBOUNCE_MS = 120

export function useCanvas(initial?: CanvasContent) {
  const registry = inject<CanvasBlockRegistry | null>('nuxflow:blockRegistry', null)

  const canvas = ref<CanvasContent>(
    initial ? JSON.parse(JSON.stringify(initial)) : emptyCanvas(),
  )

  const selectedId = ref<string | null>(null)

  const selectedBlock = computed(() =>
    selectedId.value ? findBlockById(canvas.value.blocks, selectedId.value) : null,
  )

  const selectedDefinition = computed((): CanvasBlockDefinition | null => {
    if (!selectedBlock.value) return null
    const def = resolveDefinition(selectedBlock.value.type, registry ?? undefined)
    if (def) return def
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
  // The stack/burst-debounce bookkeeping itself lives in useCanvasHistory.ts —
  // this just wires it to canvas-specific concerns (cloning CanvasContent,
  // replacing it wholesale, and clearing block selection on an actual undo/redo)
  // that the generic history composable has no business knowing about.

  function cloneContent(): CanvasContent {
    return JSON.parse(JSON.stringify(canvas.value))
  }

  function snapshot(): CanvasContent {
    return cloneContent()
  }

  const history = useCanvasHistory<CanvasContent>({
    snapshot,
    setValue: (value) => { canvas.value = value },
    flushPending: () => flushPendingProps(),
  })

  const { undoStack, redoStack, canUndo, canRedo, flushPendingBurst, recordDiscrete } = history

  function recordDebounced(blockId: string, propKey: string) {
    history.recordDebounced(`${blockId}:${propKey}`)
  }

  function undo() {
    if (history.undo()) selectedId.value = null
  }

  function redo() {
    if (history.redo()) selectedId.value = null
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
    const def = resolveDefinition(typeId, registry ?? undefined)
    const block: CanvasBlockData = {
      id: uuid(),
      type: typeId,
      props: def ? { ...def.defaultProps } : {},
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

  // Committing every keystroke straight to `canvas` fires the deep watcher in
  // CanvasContentEditor (full-tree JSON clone) and the parent form's own deep
  // watcher on every character typed. Coalesce rapid-fire updates to the same
  // target into one commit, ~120ms after the last one, before they reach the
  // reactive tree at all — cutting those full-tree traversals down to roughly
  // once per debounce window instead of once per keystroke.
  //
  // `id`/`key`/`value` are captured by value in `pendingPropCommit`, never
  // re-read from `selectedBlock` or any other live/reactive source when the
  // timer fires — this is what makes it safe to defer: even if the user
  // switches to a different block or field before the timer fires, the
  // deferred commit still lands on the exact block/prop it was meant for.
  let propCommitTimer: ReturnType<typeof setTimeout> | null = null
  let pendingPropCommit: { id: string; key: string; value: unknown } | null = null

  function applyPropCommit(id: string, key: string, value: unknown) {
    const found = findParentList(canvas.value.blocks, id)
    if (!found) return
    const block = found.list[found.index]!
    block.props = { ...block.props, [key]: value }
  }

  /** Commits any in-flight debounced prop write immediately — must run before
   * anything reads or replaces `canvas` wholesale (save, undo/redo, reset,
   * discrete mutations, unmount), or the pending edit would be silently lost. */
  function flushPendingProps() {
    if (propCommitTimer !== null) {
      clearTimeout(propCommitTimer)
      propCommitTimer = null
    }
    if (pendingPropCommit) {
      const { id, key, value } = pendingPropCommit
      pendingPropCommit = null
      applyPropCommit(id, key, value)
    }
  }

  function updateBlockProp(id: string, key: string, value: unknown) {
    recordDebounced(id, key)

    // Switching to a different target mid-burst — flush the previous one now
    // so it's never dropped or merged into the wrong block/prop.
    if (pendingPropCommit && (pendingPropCommit.id !== id || pendingPropCommit.key !== key)) {
      flushPendingProps()
    }
    pendingPropCommit = { id, key, value }
    if (propCommitTimer !== null) clearTimeout(propCommitTimer)
    propCommitTimer = setTimeout(() => {
      propCommitTimer = null
      flushPendingProps()
    }, PROP_COMMIT_DEBOUNCE_MS)
  }

  onBeforeUnmount(() => flushPendingProps())

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
    flushPendingProps()
    flushPendingBurst()
    canvas.value = JSON.parse(JSON.stringify(content))
    selectedId.value = null
    history.clear()
  }

  // ── Serialise ─────────────────────────────────────────────────────────────

  function toJSON(): CanvasContent {
    flushPendingProps()
    return cloneContent()
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
    duplicateBlock,
    selectBlock,
    reset,
    toJSON,
    flushPendingProps,
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
