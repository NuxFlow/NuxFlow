<script setup lang="ts">
import { defineAsyncComponent, computed, inject } from 'vue'
import type { CanvasBlockData } from '../types'
import { getBlockDefinition } from '../blocks/definitions'

interface BlockRegistryLike { resolve(id: string): object | undefined }

import CanvasBlockHero from '../blocks/CanvasBlockHero.vue'
import CanvasBlockText from '../blocks/CanvasBlockText.vue'
import CanvasBlockImage from '../blocks/CanvasBlockImage.vue'
import CanvasBlockColumns from '../blocks/CanvasBlockColumns.vue'
import CanvasBlockCta from '../blocks/CanvasBlockCta.vue'
import CanvasBlockSpacer from '../blocks/CanvasBlockSpacer.vue'
import CanvasBlockVideo from '../blocks/CanvasBlockVideo.vue'
import CanvasBlockTestimonial from '../blocks/CanvasBlockTestimonial.vue'
import CanvasBlockFeatures from '../blocks/CanvasBlockFeatures.vue'

const COMPONENTS: Record<string, ReturnType<typeof defineAsyncComponent> | object> = {
  CanvasBlockHero,
  CanvasBlockText,
  CanvasBlockImage,
  CanvasBlockColumns,
  CanvasBlockCta,
  CanvasBlockSpacer,
  CanvasBlockVideo,
  CanvasBlockTestimonial,
  CanvasBlockFeatures,
}

const props = defineProps<{
  block: CanvasBlockData
  selected?: boolean
  editing?: boolean
}>()

const emit = defineEmits<{
  select: []
  duplicate: []
  remove: []
}>()

const registry = inject<BlockRegistryLike | null>('nuxflow:blockRegistry', null)

const definition = computed(() => getBlockDefinition(props.block.type))
const component = computed(() =>
  definition.value
    ? COMPONENTS[definition.value.component]
    : registry?.resolve(props.block.type) ?? null,
)
</script>

<template>
  <div
    class="relative group/block transition-all"
    :class="[
      editing ? 'cursor-pointer' : '',
      selected ? 'ring-2 ring-primary-500 ring-inset' : '',
    ]"
    @click.stop="editing && emit('select')"
  >
    <!-- Floating action bar — appears on hover in editor mode -->
    <div
      v-if="editing"
      class="absolute top-2 right-2 hidden group-hover/block:flex items-center gap-0.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-md px-1 py-0.5 z-20"
    >
      <!-- Block label -->
      <span class="text-xs font-medium text-gray-500 dark:text-gray-400 px-1.5">
        {{ definition?.name ?? block.type }}
      </span>

      <div class="w-px h-3.5 bg-gray-200 dark:bg-gray-700 mx-0.5" />

      <!-- Select / edit -->
      <button
        class="p-1 rounded hover:bg-primary-50 dark:hover:bg-primary-950 text-gray-400 hover:text-primary-600 transition-colors"
        title="Select block"
        @click.stop="emit('select')"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      </button>

      <!-- Duplicate -->
      <button
        class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        title="Duplicate block"
        @click.stop="emit('duplicate')"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <rect x="9" y="9" width="13" height="13" rx="2" stroke-width="2"/><rect x="2" y="2" width="13" height="13" rx="2" stroke-width="2"/>
        </svg>
      </button>

      <!-- Delete -->
      <button
        class="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950 text-gray-400 hover:text-red-500 transition-colors"
        title="Delete block"
        @click.stop="emit('remove')"
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

    <!-- Rendered block -->
    <component
      :is="component"
      v-else
      v-bind="block.props"
    />

    <!-- Transparent click-capture overlay — prevents links/buttons inside blocks
         from navigating while in editor mode. Sits above the block content but
         below the action bar (z-10 vs z-20). -->
    <div
      v-if="editing"
      class="absolute inset-0 z-10 cursor-pointer"
      @click.prevent.stop="emit('select')"
    />
  </div>
</template>
