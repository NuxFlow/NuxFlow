import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useCanvas } from '../../../../packages/canvas/src/editor/useCanvas'
import type { CanvasBlockData } from '../../../../packages/canvas/src/types'

// canvas-container and canvas-columns are real registered blocks with slots
// (container: 'default'; columns: 'col1'..'col4') — used throughout to exercise
// nesting without needing to fabricate a fake definition.

describe('useCanvas — root-level mutations (flat regression safety net)', () => {
  it('addBlock appends to root by default', () => {
    const c = useCanvas()
    c.addBlock('canvas-text')
    c.addBlock('canvas-image')
    expect(c.canvas.value.blocks.map(b => b.type)).toEqual(['canvas-text', 'canvas-image'])
    expect(c.selectedId.value).toBe(c.canvas.value.blocks[1]!.id)
  })

  it('removeBlock removes by id and clears selection if it was selected', () => {
    const c = useCanvas()
    c.addBlock('canvas-text')
    const id = c.canvas.value.blocks[0]!.id
    c.selectBlock(id)
    c.removeBlock(id)
    expect(c.canvas.value.blocks.length).toBe(0)
    expect(c.selectedId.value).toBeNull()
  })

  it('updateBlockProp merges into existing props', () => {
    const c = useCanvas()
    c.addBlock('canvas-text')
    const id = c.canvas.value.blocks[0]!.id
    c.updateBlockProp(id, 'text', 'hello')
    expect(c.canvas.value.blocks[0]!.props.text).toBe('hello')
  })

  it('duplicateBlock inserts a clone immediately after the original with a new id', () => {
    const c = useCanvas()
    c.addBlock('canvas-text')
    const id = c.canvas.value.blocks[0]!.id
    c.updateBlockProp(id, 'text', 'hi')
    c.duplicateBlock(id)
    expect(c.canvas.value.blocks.length).toBe(2)
    expect(c.canvas.value.blocks[1]!.id).not.toBe(id)
    expect(c.canvas.value.blocks[1]!.props.text).toBe('hi')
    expect(c.selectedId.value).toBe(c.canvas.value.blocks[1]!.id)
  })

  it('moveBlock up/down reorders within root and no-ops at boundaries', () => {
    const c = useCanvas()
    c.addBlock('canvas-text')
    c.addBlock('canvas-image')
    const [a, b] = c.canvas.value.blocks.map(x => x.id)
    c.moveBlock(b!, 'up')
    expect(c.canvas.value.blocks.map(x => x.id)).toEqual([b, a])
    c.moveBlock(b!, 'up') // already first — no-op
    expect(c.canvas.value.blocks.map(x => x.id)).toEqual([b, a])
  })

  it('reorderBlock reorders within the root list', () => {
    const c = useCanvas()
    c.addBlock('canvas-text')
    c.addBlock('canvas-image')
    c.addBlock('canvas-video')
    const ids = c.canvas.value.blocks.map(x => x.id)
    c.reorderBlock(null, null, 0, 2)
    expect(c.canvas.value.blocks.map(x => x.id)).toEqual([ids[1], ids[0], ids[2]])
  })
})

describe('useCanvas — nested blocks (slots)', () => {
  it('addBlock inserts into a named slot of a container block', () => {
    const c = useCanvas()
    c.addBlock('canvas-container')
    const containerId = c.canvas.value.blocks[0]!.id
    c.addBlock('canvas-text', { parentId: containerId, slot: 'default' })

    const container = c.canvas.value.blocks[0]!
    expect(container.children?.default?.length).toBe(1)
    expect(container.children!.default![0]!.type).toBe('canvas-text')
  })

  it('removeBlock finds and removes a block nested inside a slot', () => {
    const c = useCanvas()
    c.addBlock('canvas-container')
    const containerId = c.canvas.value.blocks[0]!.id
    c.addBlock('canvas-text', { parentId: containerId, slot: 'default' })
    const childId = c.canvas.value.blocks[0]!.children!.default![0]!.id

    c.removeBlock(childId)
    expect(c.canvas.value.blocks[0]!.children!.default!.length).toBe(0)
  })

  it('duplicateBlock nested inside a slot clones within that same slot', () => {
    const c = useCanvas()
    c.addBlock('canvas-container')
    const containerId = c.canvas.value.blocks[0]!.id
    c.addBlock('canvas-text', { parentId: containerId, slot: 'default' })
    const childId = c.canvas.value.blocks[0]!.children!.default![0]!.id

    c.duplicateBlock(childId)
    const slot = c.canvas.value.blocks[0]!.children!.default!
    expect(slot.length).toBe(2)
    expect(slot[1]!.id).not.toBe(childId)
  })

  it('moveBlock up/down operates within the slot the block lives in', () => {
    const c = useCanvas()
    c.addBlock('canvas-container')
    const containerId = c.canvas.value.blocks[0]!.id
    c.addBlock('canvas-text', { parentId: containerId, slot: 'default' })
    c.addBlock('canvas-image', { parentId: containerId, slot: 'default' })
    const slot = () => c.canvas.value.blocks[0]!.children!.default!
    const [a, b] = slot().map(x => x.id)

    c.moveBlock(b!, 'up')
    expect(slot().map(x => x.id)).toEqual([b, a])
  })

  it('cloneWithNewIds regenerates ids for every descendant, not just the root', () => {
    const c = useCanvas()
    c.addBlock('canvas-container')
    const outerId = c.canvas.value.blocks[0]!.id
    c.addBlock('canvas-container', { parentId: outerId, slot: 'default' })
    const innerId = c.canvas.value.blocks[0]!.children!.default![0]!.id
    c.addBlock('canvas-text', { parentId: innerId, slot: 'default' })
    const leafId = c.canvas.value.blocks[0]!.children!.default![0]!.children!.default![0]!.id
    c.updateBlockProp(leafId, 'text', 'original')

    c.duplicateBlock(outerId)
    const clone = c.canvas.value.blocks[1]!
    const cloneInner = clone.children!.default![0]!
    const cloneLeaf = cloneInner.children!.default![0]!

    expect(clone.id).not.toBe(outerId)
    expect(cloneInner.id).not.toBe(innerId)
    expect(cloneLeaf.id).not.toBe(leafId)
    expect(cloneLeaf.props.text).toBe('original')

    // Mutating the clone's nested leaf must not affect the original's.
    c.updateBlockProp(cloneLeaf.id, 'text', 'changed')
    expect(c.canvas.value.blocks[0]!.children!.default![0]!.children!.default![0]!.props.text).toBe('original')
  })
})

describe('useCanvas — cross-slot moves and cycle prevention', () => {
  it('moveBlockToSlot moves a root block into a container slot', () => {
    const c = useCanvas()
    c.addBlock('canvas-text')
    c.addBlock('canvas-container')
    const [textId, containerId] = c.canvas.value.blocks.map(b => b.id)

    c.moveBlockToSlot(textId!, containerId!, 'default', 0)

    expect(c.canvas.value.blocks.length).toBe(1)
    expect(c.canvas.value.blocks[0]!.id).toBe(containerId)
    expect(c.canvas.value.blocks[0]!.children!.default![0]!.id).toBe(textId)
  })

  it('moveBlockToSlot moves a block from one slot to another', () => {
    const c = useCanvas()
    c.addBlock('canvas-columns')
    const columnsId = c.canvas.value.blocks[0]!.id
    c.addBlock('canvas-text', { parentId: columnsId, slot: 'col1' })
    const textId = c.canvas.value.blocks[0]!.children!.col1![0]!.id

    c.moveBlockToSlot(textId, columnsId, 'col2', 0)

    expect(c.canvas.value.blocks[0]!.children!.col1!.length).toBe(0)
    expect(c.canvas.value.blocks[0]!.children!.col2!.length).toBe(1)
    expect(c.canvas.value.blocks[0]!.children!.col2![0]!.id).toBe(textId)
  })

  it('moveBlockToSlot moves a nested block back out to root', () => {
    const c = useCanvas()
    c.addBlock('canvas-container')
    const containerId = c.canvas.value.blocks[0]!.id
    c.addBlock('canvas-text', { parentId: containerId, slot: 'default' })
    const textId = c.canvas.value.blocks[0]!.children!.default![0]!.id

    c.moveBlockToSlot(textId, null, null, 0)

    // Inserted at root index 0, pushing the (now-empty) container to index 1.
    expect(c.canvas.value.blocks[0]!.id).toBe(textId)
    expect(c.canvas.value.blocks[1]!.id).toBe(containerId)
    expect(c.canvas.value.blocks[1]!.children!.default!.length).toBe(0)
  })

  it('rejects moving a block into itself', () => {
    const c = useCanvas()
    c.addBlock('canvas-container')
    const id = c.canvas.value.blocks[0]!.id

    c.moveBlockToSlot(id, id, 'default', 0)

    // No-op: still one root block, no self-referential child was created.
    expect(c.canvas.value.blocks.length).toBe(1)
    expect(c.canvas.value.blocks[0]!.children?.default ?? []).toEqual([])
  })

  it('rejects moving a container into its own descendant (cycle guard)', () => {
    const c = useCanvas()
    c.addBlock('canvas-container')
    const outerId = c.canvas.value.blocks[0]!.id
    c.addBlock('canvas-container', { parentId: outerId, slot: 'default' })
    const innerId = c.canvas.value.blocks[0]!.children!.default![0]!.id

    // Attempt: move outer container into inner container's slot — would be circular.
    c.moveBlockToSlot(outerId, innerId, 'default', 0)

    // Structure must be completely unchanged.
    expect(c.canvas.value.blocks.length).toBe(1)
    expect(c.canvas.value.blocks[0]!.id).toBe(outerId)
    expect(c.canvas.value.blocks[0]!.children!.default![0]!.id).toBe(innerId)
  })
})

describe('useCanvas — selection safety on removal', () => {
  it('clears selection when the selected block itself is removed', () => {
    const c = useCanvas()
    c.addBlock('canvas-text')
    const id = c.canvas.value.blocks[0]!.id
    c.selectBlock(id)
    c.removeBlock(id)
    expect(c.selectedId.value).toBeNull()
  })

  it('clears selection when the selected block is a descendant of the removed subtree', () => {
    const c = useCanvas()
    c.addBlock('canvas-container')
    const containerId = c.canvas.value.blocks[0]!.id
    c.addBlock('canvas-text', { parentId: containerId, slot: 'default' })
    const childId = c.canvas.value.blocks[0]!.children!.default![0]!.id

    c.selectBlock(childId)
    c.removeBlock(containerId)

    expect(c.canvas.value.blocks.length).toBe(0)
    expect(c.selectedId.value).toBeNull()
  })

  it('leaves selection untouched when an unrelated block is removed', () => {
    const c = useCanvas()
    c.addBlock('canvas-text')
    c.addBlock('canvas-image')
    const [keepId, removeId] = c.canvas.value.blocks.map(b => b.id)
    c.selectBlock(keepId!)
    c.removeBlock(removeId!)
    expect(c.selectedId.value).toBe(keepId)
  })
})

describe('useCanvas — undo/redo', () => {
  it('canUndo/canRedo reflect stack state', () => {
    const c = useCanvas()
    expect(c.canUndo.value).toBe(false)
    expect(c.canRedo.value).toBe(false)
    c.addBlock('canvas-text')
    expect(c.canUndo.value).toBe(true)
    expect(c.canRedo.value).toBe(false)
  })

  it('undo reverts a discrete mutation (add) and redo replays it', () => {
    const c = useCanvas()
    c.addBlock('canvas-text')
    expect(c.canvas.value.blocks.length).toBe(1)

    c.undo()
    expect(c.canvas.value.blocks.length).toBe(0)
    expect(c.canRedo.value).toBe(true)

    c.redo()
    expect(c.canvas.value.blocks.length).toBe(1)
    expect(c.canvas.value.blocks[0]!.type).toBe('canvas-text')
  })

  it('undo of remove restores the removed block', () => {
    const c = useCanvas()
    c.addBlock('canvas-text')
    const id = c.canvas.value.blocks[0]!.id
    c.updateBlockProp(id, 'text', 'keep me')
    vi.runAllTimers() // flush the debounced prop edit into its own undo step

    c.removeBlock(id)
    expect(c.canvas.value.blocks.length).toBe(0)

    c.undo()
    expect(c.canvas.value.blocks.length).toBe(1)
    expect(c.canvas.value.blocks[0]!.props.text).toBe('keep me')
  })

  it('a new discrete mutation clears the redo stack', () => {
    const c = useCanvas()
    c.addBlock('canvas-text')
    c.undo()
    expect(c.canRedo.value).toBe(true)

    c.addBlock('canvas-image')
    expect(c.canRedo.value).toBe(false)
  })

  it('undo/redo clear selection rather than pointing at a stale block', () => {
    const c = useCanvas()
    c.addBlock('canvas-text')
    const id = c.canvas.value.blocks[0]!.id
    c.selectBlock(id)
    c.undo()
    expect(c.selectedId.value).toBeNull()
  })

  it('groups a burst of prop edits to the same target into a single undo step', () => {
    const c = useCanvas()
    c.addBlock('canvas-text')
    const id = c.canvas.value.blocks[0]!.id
    const stackSizeAfterAdd = c.undoStack.value.length

    c.updateBlockProp(id, 'text', 'h')
    c.updateBlockProp(id, 'text', 'he')
    c.updateBlockProp(id, 'text', 'hel')
    c.updateBlockProp(id, 'text', 'hell')
    c.updateBlockProp(id, 'text', 'hello')
    // Nothing committed yet — still debouncing.
    expect(c.undoStack.value.length).toBe(stackSizeAfterAdd)

    vi.runAllTimers()
    // Exactly one new step for the whole burst.
    expect(c.undoStack.value.length).toBe(stackSizeAfterAdd + 1)

    c.undo()
    expect(c.canvas.value.blocks[0]!.props.text).toBeUndefined()
  })

  it('does not merge bursts targeting different keys on the same block', () => {
    const c = useCanvas()
    c.addBlock('canvas-text')
    const id = c.canvas.value.blocks[0]!.id
    const stackSizeAfterAdd = c.undoStack.value.length

    c.updateBlockProp(id, 'text', 'hello')
    c.updateBlockProp(id, 'align', 'center') // different key — flushes the 'text' burst immediately
    vi.runAllTimers()

    // Two distinct steps: one for 'text', one for 'align'.
    expect(c.undoStack.value.length).toBe(stackSizeAfterAdd + 2)
  })

  it('undo() flushes a pending burst synchronously instead of losing it to a stale timer', () => {
    const c = useCanvas()
    c.addBlock('canvas-text')
    const id = c.canvas.value.blocks[0]!.id
    c.updateBlockProp(id, 'text', 'typed but not yet debounce-flushed')

    // No timers run — undo() itself must flush the burst as its own step, then
    // undo THAT step (reverting the text edit), leaving the add-block step intact.
    c.undo()
    expect(c.canvas.value.blocks.length).toBe(1)
    expect(c.canvas.value.blocks[0]!.props.text).toBeUndefined()
  })

  it('reset() clears history so undo cannot cross into previously loaded content', () => {
    const c = useCanvas()
    c.addBlock('canvas-text')
    expect(c.canUndo.value).toBe(true)

    c.reset({ type: 'canvas', blocks: [] })
    expect(c.canUndo.value).toBe(false)
    expect(c.canRedo.value).toBe(false)
  })
})

describe('useCanvas — misc', () => {
  it('toJSON returns a deep-cloned snapshot independent of live state', () => {
    const c = useCanvas()
    c.addBlock('canvas-text')
    const snap = c.toJSON()
    c.updateBlockProp(c.canvas.value.blocks[0]!.id, 'text', 'mutated after snapshot')
    expect((snap.blocks[0] as CanvasBlockData).props.text).toBeUndefined()
  })
})

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
})
