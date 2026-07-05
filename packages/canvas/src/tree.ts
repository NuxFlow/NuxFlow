import type { CanvasBlockData } from './types'

/**
 * Pure, framework-agnostic helpers for walking the CanvasBlockData tree. Shared by
 * useCanvas.ts (editor mutations) and the public-side renderer (read-only slot lookup) —
 * kept dependency-free from Vue reactivity so both sides get identical tree semantics.
 */

/** Non-mutating read of a block's children in a given slot. Slot arrays are created
 * lazily elsewhere (on insert) — reading a slot that has never been written to just
 * returns an empty array rather than materializing one. */
export function getSlotChildren(block: CanvasBlockData, slotId: string): CanvasBlockData[] {
  return block.children?.[slotId] ?? []
}

/** Recursively finds the specific array that directly contains the block with the
 * given id (the root list, or some descendant's slot list), along with its index in
 * that array. Returns null if no block with that id exists anywhere in the tree. */
export function findParentList(
  list: CanvasBlockData[],
  id: string,
): { list: CanvasBlockData[]; index: number } | null {
  const idx = list.findIndex(b => b.id === id)
  if (idx !== -1) return { list, index: idx }
  for (const block of list) {
    if (!block.children) continue
    for (const slotList of Object.values(block.children)) {
      const found = findParentList(slotList, id)
      if (found) return found
    }
  }
  return null
}

export function findBlockById(list: CanvasBlockData[], id: string): CanvasBlockData | null {
  const found = findParentList(list, id)
  return found ? (found.list[found.index] ?? null) : null
}

/** True if `candidateId` is `rootId` itself, or lives anywhere in the subtree rooted
 * at `rootId`. Used as a cycle guard (rejecting "move a block into its own descendant")
 * and to detect "the current selection is inside the subtree being removed." */
export function isDescendant(list: CanvasBlockData[], rootId: string, candidateId: string): boolean {
  const root = findBlockById(list, rootId)
  if (!root) return false
  return containsId(root, candidateId)
}

function containsId(block: CanvasBlockData, id: string): boolean {
  if (block.id === id) return true
  if (!block.children) return false
  for (const slotList of Object.values(block.children)) {
    if (slotList.some(child => containsId(child, id))) return true
  }
  return false
}

/** Deep-clones a block AND regenerates a fresh id for every node in its subtree, not
 * just the root — required for duplicate-with-children to avoid id collisions (which
 * would corrupt findParentList, Vue :key uniqueness, and selection). */
export function cloneWithNewIds(block: CanvasBlockData, uuid: () => string = () => crypto.randomUUID()): CanvasBlockData {
  const clone: CanvasBlockData = {
    id: uuid(),
    type: block.type,
    props: JSON.parse(JSON.stringify(block.props)) as Record<string, unknown>,
  }
  if (block.children) {
    clone.children = {}
    for (const [slot, slotList] of Object.entries(block.children)) {
      clone.children[slot] = slotList.map(child => cloneWithNewIds(child, uuid))
    }
  }
  return clone
}
