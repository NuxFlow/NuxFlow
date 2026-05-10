<script setup lang="ts">
import { computed } from 'vue'
import type { CanvasBlockData, CanvasBlockDefinition } from '../types'
import FieldRenderer from './FieldRenderer.vue'

const props = defineProps<{
  block: CanvasBlockData
  definition: CanvasBlockDefinition
}>()

const emit = defineEmits<{
  'update:prop': [key: string, value: unknown]
  close: []
  remove: []
  duplicate: []
  moveUp: []
  moveDown: []
}>()

// Only show fields whose condition (if any) passes against the current props
const visibleFields = computed(() =>
  props.definition.fields.filter(f => !f.condition || f.condition(props.block.props)),
)
</script>

<template>
  <aside class="flex flex-col h-full bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 w-72 shrink-0">
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
      <div class="flex items-center gap-2">
        <span :class="`${definition.icon} w-4 h-4 text-primary-500 shrink-0`" />
        <span class="text-sm font-semibold text-gray-900 dark:text-white">{{ definition.name }}</span>
      </div>
      <button
        class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        title="Close panel"
        @click="emit('close')"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <!-- Quick actions -->
    <div class="flex items-center gap-1 px-3 py-2 border-b border-gray-100 dark:border-gray-800">
      <button
        class="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors"
        title="Move up"
        @click="emit('moveUp')"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
        </svg>
        Up
      </button>
      <button
        class="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors"
        title="Move down"
        @click="emit('moveDown')"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
        Down
      </button>
      <button
        class="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors"
        title="Duplicate block"
        @click="emit('duplicate')"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <rect x="9" y="9" width="13" height="13" rx="2" stroke-width="2" /><rect x="2" y="2" width="13" height="13" rx="2" stroke-width="2" />
        </svg>
        Copy
      </button>
      <button
        class="ml-auto flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-red-50 dark:hover:bg-red-950 text-red-500 transition-colors"
        title="Remove block"
        @click="emit('remove')"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        Delete
      </button>
    </div>

    <!-- Fields -->
    <div class="flex-1 overflow-y-auto px-4 py-3 space-y-4">
      <div v-for="field in visibleFields" :key="field.key">
        <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
          {{ field.label }}
        </label>
        <FieldRenderer
          :field="field"
          :model-value="block.props[field.key]"
          @update:model-value="emit('update:prop', field.key, $event)"
        />
      </div>

      <p v-if="!visibleFields.length" class="text-xs text-gray-400 text-center py-4">
        No settings for this block.
      </p>
    </div>
  </aside>
</template>
