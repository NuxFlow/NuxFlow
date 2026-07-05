<script setup lang="ts">
import { ref, watch, computed, provide, onMounted, onBeforeUnmount } from 'vue'
import draggable from 'vuedraggable'
import type { CanvasContent, CanvasBlockData } from '../types'
import { isCanvasContent, emptyCanvas } from '../types'
import { isDescendant } from '../tree'
import { useCanvas } from './useCanvas'
import { canvasApiKey, type CanvasApi } from './canvasApi'
import CanvasBlock from './CanvasBlock.vue'
import BlockPicker from './BlockPicker.vue'
import SettingsPanel from './SettingsPanel.vue'
import InsertDivider from './InsertDivider.vue'
import AiGenerateModal from './AiGenerateModal.vue'

const props = defineProps<{ modelValue: unknown }>()
const emit = defineEmits<{ 'update:modelValue': [value: CanvasContent] }>()

const initial = isCanvasContent(props.modelValue) ? props.modelValue : emptyCanvas()

const {
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
  undo,
  redo,
  canUndo,
  canRedo,
  recordDiscrete,
} = useCanvas(initial)

watch(canvas, () => emit('update:modelValue', toJSON()), { deep: true })

watch(() => props.modelValue, (val) => {
  if (isCanvasContent(val) && JSON.stringify(val) !== JSON.stringify(canvas.value))
    reset(val)
})

// AI generation

const showAiModal = ref(false)

function onAiGenerate(content: CanvasContent) {
  reset(content)
  showAiModal.value = false
}

// ── Block picker ───────────────────────────────────────────────────────────

const showPicker = ref(false)
const insertTarget = ref<{ parentId: string | null; slot: string | null; index?: number } | undefined>(undefined)

function openPicker(target?: { parentId: string | null; slot: string | null; index?: number }) {
  insertTarget.value = target
  showPicker.value = true
}

function onPick(typeId: string) {
  addBlock(typeId, insertTarget.value)
  showPicker.value = false
  insertTarget.value = undefined
}

// ── Cycle guard shared by every draggable instance (root + nested slots) ────

function checkMove(evt: { draggedContext?: { element?: { id?: string } }; to?: HTMLElement }): boolean {
  const draggedId = evt.draggedContext?.element?.id
  const toOwnerId = evt.to?.dataset?.slotOwner
  if (!draggedId || !toOwnerId) return true // dropping at root is always cycle-safe
  if (toOwnerId === draggedId) return false
  return !isDescendant(canvas.value.blocks, draggedId, toOwnerId)
}

function onRootDragStart() {
  recordDiscrete()
}

// ── Provide the mutation API for CanvasBlock.vue at every recursion depth ───

const api: CanvasApi = {
  selectedId,
  selectBlock,
  addBlock,
  removeBlock,
  updateBlockProp,
  duplicateBlock,
  moveBlock,
  moveBlockToSlot: (id, targetParentId, targetSlot, targetIndex) => {
    // Only reached programmatically (not via drag, which mutates arrays
    // directly through vuedraggable's v-model) — kept for API completeness.
    void id; void targetParentId; void targetSlot; void targetIndex
  },
  recordDiscrete,
  checkMove,
  openPicker,
}
provide(canvasApiKey, api)

// ── Undo/redo keyboard shortcuts ─────────────────────────────────────────────
// Skipped while a text input/textarea/contenteditable has focus, so canvas-level
// undo never fights a field's own native undo while the user is typing in it.

function isTextEditingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
}

function onKeydown(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey)) return
  if (isTextEditingTarget(e.target)) return
  const key = e.key.toLowerCase()
  if (key === 'z' && e.shiftKey) {
    e.preventDefault()
    redo()
  } else if (key === 'z') {
    e.preventDefault()
    undo()
  } else if (key === 'y') {
    e.preventDefault()
    redo()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

// ── Helpers ──────────────────────────────────────────────────────────────────

const blockCount = computed(() => canvas.value.blocks.length)

function onRootUpdate(list: CanvasBlockData[]) {
  canvas.value.blocks = list
}
</script>

<template>
  <div class="flex flex-col h-full min-h-[500px]">
    <!-- Persistent toolbar -->
    <div class="sticky top-0 z-10 flex items-center justify-between px-4 py-2 bg-white/90 dark:bg-gray-900/90 backdrop-blur border-b border-gray-200 dark:border-gray-800">
      <div class="flex items-center gap-3">
        <span class="text-xs text-gray-400">
          {{ blockCount }} block{{ blockCount !== 1 ? 's' : '' }}
        </span>
        <div class="flex items-center gap-0.5">
          <button
            type="button"
            title="Undo (Ctrl+Z)"
            :disabled="!canUndo"
            class="p-1.5 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400 transition-colors"
            @click="undo()"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 15L4 10l5-5M4 10h11a4 4 0 010 8h-1" />
            </svg>
          </button>
          <button
            type="button"
            title="Redo (Ctrl+Shift+Z)"
            :disabled="!canRedo"
            class="p-1.5 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400 transition-colors"
            @click="redo()"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 15l5-5-5-5M20 10H9a4 4 0 000 8h1" />
            </svg>
          </button>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-xs font-medium hover:border-primary-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
          title="Generate page with AI"
          @click="showAiModal = true"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          </svg>
          AI Generate
        </button>
        <button
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 text-white text-xs font-medium hover:bg-primary-700 transition-colors"
          @click="openPicker()"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4" />
          </svg>
          Add block
        </button>
      </div>
    </div>

    <!-- Editor body -->
    <div class="relative flex flex-1 overflow-hidden">
      <!-- Canvas area -->
      <div
        class="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950"
        @click.self="selectBlock(null)"
      >
        <!-- Empty state -->
        <div
          v-if="!canvas.blocks.length"
          class="flex flex-col items-center justify-center h-full min-h-[360px] gap-3"
        >
          <div class="w-14 h-14 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
            <svg class="w-7 h-7 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
            </svg>
          </div>
          <p class="text-sm text-gray-400">No blocks yet</p>
          <button
            class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 transition-colors"
            @click="openPicker()"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            Add your first block
          </button>
        </div>

        <!-- Block list -->
        <div v-else class="py-4" @click.self="selectBlock(null)">
          <InsertDivider @click="openPicker({ parentId: null, slot: null, index: 0 })" />

          <draggable
            :model-value="canvas.blocks"
            item-key="id"
            group="canvas-blocks"
            handle=".canvas-drag-handle"
            @update:model-value="onRootUpdate"
            :move="checkMove"
            @start="onRootDragStart"
          >
            <template #item="{ element, index }">
              <div>
                <CanvasBlock
                  :block="element"
                  :selected="selectedId === element.id"
                  editing
                  :is-first="index === 0"
                  :is-last="index === blockCount - 1"
                />
                <InsertDivider @click="openPicker({ parentId: null, slot: null, index: index + 1 })" />
              </div>
            </template>
          </draggable>
        </div>
      </div>

      <!-- Backdrop overlay on mobile/tablet viewports -->
      <div
        v-if="selectedBlock && selectedDefinition"
        class="lg:hidden absolute inset-0 z-20 bg-black/30 dark:bg-black/50 backdrop-blur-sm transition-opacity"
        @click="selectBlock(null)"
      />

      <!-- Settings panel -->
      <SettingsPanel
        v-if="selectedBlock && selectedDefinition"
        :block="selectedBlock"
        :definition="selectedDefinition"
        @update:prop="(key, val) => updateBlockProp(selectedBlock!.id, key, val)"
        @close="selectBlock(null)"
        @remove="removeBlock(selectedBlock!.id)"
        @duplicate="duplicateBlock(selectedBlock!.id)"
        @move-up="moveBlock(selectedBlock!.id, 'up')"
        @move-down="moveBlock(selectedBlock!.id, 'down')"
      />
    </div>

    <!-- Block picker modal -->
    <BlockPicker
      v-if="showPicker"
      @pick="onPick"
      @close="showPicker = false"
    />

    <!-- AI generate modal -->
    <AiGenerateModal
      v-if="showAiModal"
      :has-blocks="blockCount > 0"
      @generate="onAiGenerate"
      @close="showAiModal = false"
    />
  </div>
</template>
