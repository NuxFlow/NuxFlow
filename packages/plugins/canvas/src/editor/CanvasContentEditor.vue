<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import type { CanvasContent } from '../types'
import { isCanvasContent, emptyCanvas } from '../types'
import { useCanvas } from './useCanvas'
import CanvasBlock from './CanvasBlock.vue'
import BlockPicker from './BlockPicker.vue'
import SettingsPanel from './SettingsPanel.vue'
import InsertDivider from './InsertDivider.vue'

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
  reorderBlock,
  duplicateBlock,
  selectBlock,
  reset,
  toJSON,
} = useCanvas(initial)

watch(canvas, () => emit('update:modelValue', toJSON()), { deep: true })

watch(() => props.modelValue, (val) => {
  if (isCanvasContent(val) && JSON.stringify(val) !== JSON.stringify(canvas.value))
    reset(val)
})

// ── Block picker ───────────────────────────────────────────────���──────────────

const showPicker = ref(false)
const insertAtIndex = ref<number | undefined>(undefined)

function openPicker(atIndex?: number) {
  insertAtIndex.value = atIndex
  showPicker.value = true
}

function onPick(typeId: string) {
  addBlock(typeId, insertAtIndex.value)
  showPicker.value = false
  insertAtIndex.value = undefined
}

// ── Drag-and-drop reorder ───────────────────────────��─────────────────────────

const draggingIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)

function onDragStart(e: DragEvent, index: number) {
  draggingIndex.value = index
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
  }
}

function onDragOver(e: DragEvent, index: number) {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  if (draggingIndex.value !== null && draggingIndex.value !== index)
    dragOverIndex.value = index
}

function onDrop(e: DragEvent, toIndex: number) {
  e.preventDefault()
  if (draggingIndex.value !== null && draggingIndex.value !== toIndex)
    reorderBlock(draggingIndex.value, toIndex)
  draggingIndex.value = null
  dragOverIndex.value = null
}

function onDragEnd() {
  draggingIndex.value = null
  dragOverIndex.value = null
}

// ── Helpers ──────────────────────────────���────────────────────────────────���───

const blockCount = computed(() => canvas.value.blocks.length)
</script>

<template>
  <div class="flex flex-col h-full min-h-[500px]">
    <!-- Persistent toolbar -->
    <div class="sticky top-0 z-10 flex items-center justify-between px-4 py-2 bg-white/90 dark:bg-gray-900/90 backdrop-blur border-b border-gray-200 dark:border-gray-800">
      <span class="text-xs text-gray-400">
        {{ blockCount }} block{{ blockCount !== 1 ? 's' : '' }}
      </span>
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

    <!-- Editor body -->
    <div class="flex flex-1 overflow-hidden">
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
            @click="openPicker(0)"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            Add your first block
          </button>
        </div>

        <!-- Block list -->
        <div v-else class="py-4" @click.self="selectBlock(null)">
          <InsertDivider @click="openPicker(0)" />

          <template v-for="(block, idx) in canvas.blocks" :key="block.id">
            <div
              class="relative group/row transition-opacity"
              :class="{
                'opacity-30': draggingIndex === idx,
                'ring-2 ring-primary-400 ring-inset': dragOverIndex === idx && draggingIndex !== idx,
              }"
              draggable="true"
              @dragstart="onDragStart($event, idx)"
              @dragover="onDragOver($event, idx)"
              @drop="onDrop($event, idx)"
              @dragend="onDragEnd"
            >
              <!-- Drag handle -->
              <div
                class="absolute left-1 inset-y-0 flex items-center justify-center w-5 opacity-0 group-hover/row:opacity-100 cursor-grab active:cursor-grabbing z-10 transition-opacity"
                title="Drag to reorder"
              >
                <svg class="w-3.5 h-3.5 text-gray-400" fill="currentColor" viewBox="0 0 16 16">
                  <circle cx="5" cy="3" r="1.2" /><circle cx="11" cy="3" r="1.2" />
                  <circle cx="5" cy="8" r="1.2" /><circle cx="11" cy="8" r="1.2" />
                  <circle cx="5" cy="13" r="1.2" /><circle cx="11" cy="13" r="1.2" />
                </svg>
              </div>

              <CanvasBlock
                :block="block"
                :selected="selectedId === block.id"
                :editing="true"
                @select="selectBlock(block.id)"
                @duplicate="duplicateBlock(block.id)"
                @remove="removeBlock(block.id)"
              />
            </div>

            <InsertDivider @click="openPicker(idx + 1)" />
          </template>
        </div>
      </div>

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
  </div>
</template>
