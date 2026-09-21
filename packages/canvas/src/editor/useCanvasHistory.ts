import { ref, computed } from 'vue'
import type { Ref } from 'vue'

const MAX_HISTORY = 50
const BURST_DEBOUNCE_MS = 600

export interface UseCanvasHistoryOptions<T> {
  /** Returns a deep-cloned snapshot of the current value — called every time a
   * new undo/redo step needs to capture "what the value looked like right now". */
  snapshot: () => T
  /** Replaces the live value wholesale with a previously captured snapshot
   * (an undo/redo step being applied). */
  setValue: (value: T) => void
  /** Called before every discrete mutation and before undo/redo — lets the
   * caller flush any of its own pending debounced writes into the live value
   * first, so nothing pending is silently dropped or captured mid-edit by a
   * snapshot taken here. */
  flushPending: () => void
}

/**
 * Snapshot-based undo/redo history, extracted from useCanvas.ts so the history
 * bookkeeping (stacks, burst-debouncing, undo/redo) isn't fused into the same file
 * as canvas tree mutations and prop-commit debouncing. Generic over the snapshot
 * type `T` so it has no knowledge of `CanvasContent` or canvas-specific concerns
 * like clearing block selection on undo — that stays the caller's responsibility
 * (useCanvas.ts wraps `undo()`/`redo()` to also clear `selectedId`).
 *
 * Each undo step is a full snapshot taken *before* the mutation it represents.
 * Discrete mutations (add/remove/move/duplicate/moveToSlot) push one snapshot
 * immediately via `recordDiscrete()`. Continuous mutations (e.g. a prop edited on
 * every keystroke) are grouped into a single undo step per burst of edits to the
 * same target, committed after `BURST_DEBOUNCE_MS` of inactivity on that target
 * via `recordDebounced(key)`.
 */
export function useCanvasHistory<T>(options: UseCanvasHistoryOptions<T>) {
  const { snapshot, setValue, flushPending } = options

  // Cast needed because plain `ref<T[]>([])` infers `Ref<UnwrapRef<T[]>>`, which
  // TypeScript can't prove is assignable back to `T[]` for an arbitrary generic
  // `T` (UnwrapRef is a no-op for the plain-object content types this is actually
  // used with, but the type system can't know that without help). Full reactivity
  // on these arrays — not just on reassigning `.value` — is required: `canUndo`/
  // `canRedo` are computeds reading `.value.length`, and useCanvas's own consumers
  // read `.value.length` directly, both of which need push()/shift() mutations to
  // notify, which a shallowRef would not do.
  const undoStack = ref<T[]>([]) as Ref<T[]>
  const redoStack = ref<T[]>([]) as Ref<T[]>

  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)

  function pushUndo(snap: T) {
    undoStack.value.push(snap)
    if (undoStack.value.length > MAX_HISTORY) undoStack.value.shift()
    redoStack.value = []
  }

  let burstTimer: ReturnType<typeof setTimeout> | null = null
  let burstKey: string | null = null
  let burstPreSnapshot: T | null = null

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
    flushPending()
    flushPendingBurst()
    pushUndo(snapshot())
  }

  function recordDebounced(key: string) {
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

  /** Returns true when an undo actually happened (there was something to undo) —
   * callers use this to decide whether to run their own post-undo side effects. */
  function undo(): boolean {
    flushPending()
    flushPendingBurst()
    const prev = undoStack.value.pop()
    if (!prev) return false
    redoStack.value.push(snapshot())
    setValue(prev)
    return true
  }

  /** Returns true when a redo actually happened — see `undo()`. */
  function redo(): boolean {
    flushPending()
    flushPendingBurst()
    const next = redoStack.value.pop()
    if (!next) return false
    undoStack.value.push(snapshot())
    setValue(next)
    return true
  }

  /** Clears both stacks — used when a wholly different document is loaded in
   * place of the current one (e.g. useCanvas's `reset()`), so undo can never
   * cross back into content that's no longer live. */
  function clear() {
    undoStack.value = []
    redoStack.value = []
  }

  return {
    undoStack,
    redoStack,
    canUndo,
    canRedo,
    pushUndo,
    flushPendingBurst,
    recordDiscrete,
    recordDebounced,
    undo,
    redo,
    clear,
  }
}
