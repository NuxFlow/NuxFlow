<script setup lang="ts">
import { ref, computed } from 'vue'
import { CANVAS_BLOCKS, getPluginBlockDefinitions } from '../blocks/definitions'

const tabs = ['Blocks', 'Settings'] as const
const active = ref<typeof tabs[number]>('Blocks')

const categories = ['layout', 'content', 'media', 'cta'] as const

const categoryLabels: Record<string, string> = {
  layout: 'Layout',
  content: 'Content',
  media: 'Media',
  cta: 'Call to action',
}

function blocksFor(cat: string) {
  return CANVAS_BLOCKS.filter(b => b.category === cat)
}

const pluginBlocks = computed(() => getPluginBlockDefinitions())
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-bold text-gray-900 dark:text-white">Canvas Page Builder</h1>
        <p class="text-sm text-gray-500 mt-0.5">Visual drag-and-drop blocks for page content</p>
      </div>
      <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
        Active
      </span>
    </div>

    <!-- Tab nav -->
    <div class="flex gap-1 border-b border-gray-200 dark:border-gray-800">
      <button
        v-for="tab in tabs"
        :key="tab"
        class="px-4 py-2 text-sm font-medium border-b-2 transition-colors"
        :class="active === tab
          ? 'border-primary-500 text-primary-600 dark:text-primary-400'
          : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'"
        @click="active = tab"
      >
        {{ tab }}
      </button>
    </div>

    <!-- Blocks tab -->
    <template v-if="active === 'Blocks'">
      <p class="text-sm text-gray-500">
        The following blocks are available in the Canvas editor. Activate Canvas mode on any page from the content editor.
      </p>
      <div v-for="cat in categories" :key="cat" class="space-y-2">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-gray-400">{{ categoryLabels[cat] }}</h3>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div
            v-for="block in blocksFor(cat)"
            :key="block.id"
            class="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
          >
            <span :class="`${block.icon} w-5 h-5 mt-0.5 shrink-0`" />
            <div>
              <p class="text-sm font-medium text-gray-900 dark:text-white">{{ block.name }}</p>
              <p v-if="block.description" class="text-xs text-gray-400 mt-0.5">{{ block.description }}</p>
            </div>
          </div>
        </div>
      </div>

      <div v-if="pluginBlocks.length > 0" class="space-y-2">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-gray-400">Plugins</h3>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div
            v-for="block in pluginBlocks"
            :key="block.id"
            class="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
          >
            <span :class="`${block.icon} w-5 h-5 mt-0.5 shrink-0`" />
            <div>
              <p class="text-sm font-medium text-gray-900 dark:text-white">{{ block.name }}</p>
              <p v-if="block.description" class="text-xs text-gray-400 mt-0.5">{{ block.description }}</p>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Settings tab -->
    <template v-if="active === 'Settings'">
      <div class="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 text-center">
        <p class="text-sm text-gray-500">No additional settings for Canvas at this time.</p>
      </div>
    </template>
  </div>
</template>
