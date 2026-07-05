<script setup lang="ts">
import { defineAsyncComponent, computed, inject } from 'vue'
import draggable from 'vuedraggable'
import type { CanvasBlockData } from '../types'
import { getBlockDefinition } from '../blocks/definitions'
import { getSlotChildren } from '../tree'
import { canvasApiKey } from './canvasApi'

interface BlockRegistryLike { resolve(id: string): object | undefined }

import CanvasBlockHero from '../blocks/CanvasBlockHero.vue'
import CanvasBlockText from '../blocks/CanvasBlockText.vue'
import CanvasBlockImage from '../blocks/CanvasBlockImage.vue'
import CanvasBlockColumns from '../blocks/CanvasBlockColumns.vue'
import CanvasBlockContainer from '../blocks/CanvasBlockContainer.vue'
import CanvasBlockCta from '../blocks/CanvasBlockCta.vue'
import CanvasBlockSpacer from '../blocks/CanvasBlockSpacer.vue'
import CanvasBlockVideo from '../blocks/CanvasBlockVideo.vue'
import CanvasBlockTestimonial from '../blocks/CanvasBlockTestimonial.vue'
import CanvasBlockFeatures from '../blocks/CanvasBlockFeatures.vue'
import CanvasBlockButton from '../blocks/CanvasBlockButton.vue'
import CanvasBlockAccordion from '../blocks/CanvasBlockAccordion.vue'
import CanvasBlockPricing from '../blocks/CanvasBlockPricing.vue'
import CanvasBlockCalendar from '../blocks/CanvasBlockCalendar.vue'

const COMPONENTS: Record<string, ReturnType<typeof defineAsyncComponent> | object> = {
  CanvasBlockHero,
  CanvasBlockText,
  CanvasBlockImage,
  CanvasBlockColumns,
  CanvasBlockContainer,
  CanvasBlockCta,
  CanvasBlockSpacer,
  CanvasBlockVideo,
  CanvasBlockTestimonial,
  CanvasBlockFeatures,
  CanvasBlockButton,
  CanvasBlockAccordion,
  CanvasBlockPricing,
  CanvasBlockCalendar,
}

const props = defineProps<{
  block: CanvasBlockData
  selected?: boolean
  editing?: boolean
  isFirst?: boolean
  isLast?: boolean
}>()

const registry = inject<BlockRegistryLike | null>('nuxflow:blockRegistry', null)
const api = inject(canvasApiKey, null)

const definition = computed(() => getBlockDefinition(props.block.type))
const component = computed(() => {
  const def = definition.value
  if (!def) return registry?.resolve(props.block.type) ?? null
  return COMPONENTS[def.component] ?? registry?.resolve(props.block.type) ?? null
})

// ── Nested slots ─────────────────────────────────────────────────────────────

const activeSlots = computed(() => {
  const slots = definition.value?.slots
  if (!slots) return []
  return slots.filter(s => !s.condition || s.condition(props.block.props))
})

function childrenFor(slotId: string): CanvasBlockData[] {
  return getSlotChildren(props.block, slotId)
}

/** vuedraggable's v-model setter for a slot list — materializes block.children
 * lazily, only once this slot actually receives its first real mutation. */
function setSlotChildren(slotId: string, list: CanvasBlockData[]) {
  if (!props.block.children) props.block.children = {}
  props.block.children[slotId] = list
}

function onDragStart() {
  api?.recordDiscrete()
}

function openAddPicker(slotId: string) {
  api?.openPicker({ parentId: props.block.id, slot: slotId })
}
</script>

<template>
  <div
    class="relative group/block transition-all"
    :class="[
      editing ? 'cursor-pointer' : '',
      selected ? 'ring-2 ring-primary-500 ring-inset' : '',
    ]"
    @click.stop="editing && api?.selectBlock(block.id)"
  >
    <!-- Floating action bar — appears on hover or when selected in editor mode -->
    <div
      v-if="editing"
      class="absolute top-2 right-2 items-center gap-0.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-md px-1 py-0.5 z-20"
      :class="[selected ? 'flex' : 'hidden group-hover/block:flex']"
    >
      <!-- Drag handle -->
      <span
        class="canvas-drag-handle p-1 rounded text-gray-300 hover:text-gray-500 dark:hover:text-gray-300 cursor-grab active:cursor-grabbing transition-colors"
        title="Drag to move"
        @click.stop
      >
        <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16 16">
          <circle cx="5" cy="3" r="1.2" /><circle cx="11" cy="3" r="1.2" />
          <circle cx="5" cy="8" r="1.2" /><circle cx="11" cy="8" r="1.2" />
          <circle cx="5" cy="13" r="1.2" /><circle cx="11" cy="13" r="1.2" />
        </svg>
      </span>

      <!-- Block label -->
      <span class="text-xs font-medium text-gray-500 dark:text-gray-400 px-1.5">
        {{ definition?.name ?? block.type }}
      </span>

      <div class="w-px h-3.5 bg-gray-200 dark:bg-gray-700 mx-0.5" />

      <!-- Move up -->
      <button
        v-if="!isFirst"
        class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        title="Move block up"
        @click.stop="api?.moveBlock(block.id, 'up')"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
        </svg>
      </button>

      <!-- Move down -->
      <button
        v-if="!isLast"
        class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        title="Move block down"
        @click.stop="api?.moveBlock(block.id, 'down')"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <div v-if="!isFirst || !isLast" class="w-px h-3.5 bg-gray-200 dark:bg-gray-700 mx-0.5" />

      <!-- Select / edit -->
      <button
        class="p-1 rounded hover:bg-primary-50 dark:hover:bg-primary-950 text-gray-400 hover:text-primary-600 transition-colors"
        title="Select block"
        @click.stop="api?.selectBlock(block.id)"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      </button>

      <!-- Duplicate -->
      <button
        class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        title="Duplicate block"
        @click.stop="api?.duplicateBlock(block.id)"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <rect x="9" y="9" width="13" height="13" rx="2" stroke-width="2" /><rect x="2" y="2" width="13" height="13" rx="2" stroke-width="2" />
        </svg>
      </button>

      <!-- Delete -->
      <button
        class="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950 text-gray-400 hover:text-red-500 transition-colors"
        title="Delete block"
        @click.stop="api?.removeBlock(block.id)"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    </div>

    <!-- Unknown block fallback -->
    <div v-if="!component" class="p-4 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded text-sm text-red-500">
      Unknown block type: <code>{{ block.type }}</code>
    </div>

    <!-- Rendered block, with nested slot content for container blocks -->
    <component :is="component" v-else v-bind="block.props">
      <template v-for="slot in activeSlots" :key="slot.id" #[slot.id]>
        <div class="canvas-slot-wrapper" :class="{ 'canvas-slot-wrapper--empty': !childrenFor(slot.id).length }">
          <draggable
            :model-value="childrenFor(slot.id)"
            item-key="id"
            group="canvas-blocks"
            handle=".canvas-drag-handle"
            class="canvas-slot-list"
            :data-slot-owner="block.id"
            :data-slot-name="slot.id"
            :move="api?.checkMove"
            @update:model-value="setSlotChildren(slot.id, $event)"
            @start="onDragStart"
          >
            <template #item="{ element, index }">
              <CanvasBlock
                :block="element"
                :selected="api?.selectedId.value === element.id"
                editing
                :is-first="index === 0"
                :is-last="index === childrenFor(slot.id).length - 1"
              />
            </template>
          </draggable>
          <button
            type="button"
            class="canvas-slot-add"
            @click.stop="openAddPicker(slot.id)"
          >
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4" />
            </svg>
            Add block{{ activeSlots.length > 1 ? ` to ${slot.label}` : '' }}
          </button>
        </div>
      </template>
    </component>

    <!-- Transparent click-capture overlay — prevents links/buttons inside blocks
         from navigating while in editor mode. Sits above the block content but
         below the action bar (z-10 vs z-20) and below nested slots (which need
         their own clicks/drags), so it's only rendered for leaf blocks. -->
    <div
      v-if="editing && !activeSlots.length"
      class="absolute inset-0 z-10 cursor-pointer"
      @click.prevent.stop="api?.selectBlock(block.id)"
    />
  </div>
</template>

<style scoped>
.canvas-slot-wrapper {
  position: relative;
}
.canvas-slot-list {
  min-height: 2.5rem;
}
.canvas-slot-wrapper--empty .canvas-slot-list {
  min-height: 3rem;
  border: 1px dashed rgb(209 213 219);
  border-radius: 0.5rem;
  background: rgb(249 250 251 / 0.5);
}
:global(.dark) .canvas-slot-wrapper--empty .canvas-slot-list {
  border-color: rgb(55 65 81);
  background: rgb(31 41 55 / 0.3);
}
.canvas-slot-add {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  width: 100%;
  padding: 0.25rem;
  font-size: 0.6875rem;
  color: rgb(156 163 175);
  border-radius: 0.375rem;
  transition: color 0.15s, background-color 0.15s;
}
.canvas-slot-add:hover {
  color: rgb(var(--nuxflow-primary, 99 102 241));
  background: rgb(243 244 246);
}
:global(.dark) .canvas-slot-add:hover {
  background: rgb(31 41 55);
}
</style>
