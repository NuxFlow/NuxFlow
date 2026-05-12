<script setup lang="ts">
import { inject, computed } from 'vue'
import { CANVAS_BLOCKS, getPluginBlockDefinitions } from '../blocks/definitions'

const emit = defineEmits<{ pick: [typeId: string]; close: [] }>()

const categories = ['content', 'media', 'layout', 'cta'] as const

function blocksFor(cat: string) {
  return CANVAS_BLOCKS.filter(b => b.category === cat)
}

const categoryLabels: Record<string, string> = {
  content: 'Content',
  media: 'Media',
  layout: 'Layout',
  cta: 'Call to action',
}

interface BlockRegistryLike {
  all(): Array<{ id: string; name: string; icon?: string }>
  dynamicBlocks(): Array<{ id: string; name: string; icon?: string }>
}

const registry = inject<BlockRegistryLike | null>('nuxflow:blockRegistry', null)

// Blocks registered by active dynamic (external) plugins.
const dynamicBlocks = computed(() => registry?.dynamicBlocks() ?? [])

// Blocks registered by bundled plugins via registerBlockDefinition().
const bundledPluginBlocks = computed(() => getPluginBlockDefinitions())

// Combined plugins section — bundled first, then dynamic.
const pluginBlocks = computed(() => [
  ...bundledPluginBlocks.value,
  ...dynamicBlocks.value.map(b => ({ ...b, thumbnailColor: '#f0fdf4' as string | undefined })),
])
</script>

<template>
  <div class="fixed inset-0 z-50 overflow-y-auto bg-black/50" @click.self="emit('close')">
    <div class="flex min-h-full items-center justify-center p-4" @click.self="emit('close')">
    <div class="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden">
      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800">
        <h2 class="text-base font-semibold text-gray-900 dark:text-white">Add a block</h2>
        <button
          class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          @click="emit('close')"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Block grid -->
      <div class="overflow-y-auto flex-1 min-h-0 px-5 py-4 space-y-6">
        <div v-for="cat in categories" :key="cat">
          <p class="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">{{ categoryLabels[cat] }}</p>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="block in blocksFor(cat)"
              :key="block.id"
              class="flex flex-col items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 p-3 hover:border-primary-400 hover:shadow-sm transition-all text-center group"
              :style="{ backgroundColor: block.thumbnailColor ?? '#f9fafb' }"
              @click="emit('pick', block.id)"
            >
              <span
                :class="`${block.icon} w-7 h-7 text-gray-600 dark:text-gray-300 group-hover:text-primary-600 transition-colors`"
              />
              <span class="text-xs font-medium text-gray-700 dark:text-gray-300 group-hover:text-primary-700 transition-colors leading-tight">
                {{ block.name }}
              </span>
            </button>
          </div>
        </div>

        <!-- Plugin blocks (bundled + dynamic) -->
        <div v-if="pluginBlocks.length > 0">
          <p class="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Plugins</p>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="block in pluginBlocks"
              :key="block.id"
              class="flex flex-col items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 p-3 hover:border-primary-400 hover:shadow-sm transition-all text-center group"
              :style="{ backgroundColor: block.thumbnailColor ?? '#f0fdf4' }"
              @click="emit('pick', block.id)"
            >
              <span
                :class="`${('icon' in block ? block.icon : undefined) ?? 'i-lucide-box'} w-7 h-7 text-gray-600 dark:text-gray-300 group-hover:text-primary-600 transition-colors`"
              />
              <span class="text-xs font-medium text-gray-700 dark:text-gray-300 group-hover:text-primary-700 transition-colors leading-tight">
                {{ block.name }}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
    </div>
  </div>
</template>
