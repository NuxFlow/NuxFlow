<script setup lang="ts">
import { ref, computed } from 'vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import { CANVAS_BLOCKS, getDynamicBlockDefinitions } from '../blocks/definitions'



const categories = ['layout', 'content', 'media', 'cta', 'forms', 'advanced', 'commerce'] as const

const categoryLabels: Record<string, string> = {
  layout: 'Layout',
  content: 'Content',
  media: 'Media',
  cta: 'Call to action',
  forms: 'Forms',
  advanced: 'Advanced',
  commerce: 'Commerce',
}

function blocksFor(cat: string) {
  return CANVAS_BLOCKS.filter(b => b.category === cat)
}

const extensionBlocks = computed(() => getDynamicBlockDefinitions())
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


      <p class="text-sm text-gray-500">
        The following blocks are available in the Canvas editor. Activate Canvas mode on any page from the content editor.
      </p>
      <div v-for="cat in categories" :key="cat">
        <template v-if="blocksFor(cat).length > 0">
          <h3 class="text-xs font-semibold uppercase tracking-wider text-gray-400">{{ categoryLabels[cat] }}</h3>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div
              v-for="block in blocksFor(cat)"
              :key="block.id"
              class="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
            >
              <UIcon :name="block.icon" mode="svg" class="w-5 h-5 mt-0.5 shrink-0" />
              <div>
                <p class="text-sm font-medium text-gray-900 dark:text-white">{{ block.name }}</p>
                <p v-if="block.description" class="text-xs text-gray-400 mt-0.5">{{ block.description }}</p>
              </div>
            </div>
          </div>
        </template>
      </div>

      <div v-if="extensionBlocks.length > 0" class="space-y-2">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-gray-400">Extensions</h3>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div
            v-for="block in extensionBlocks"
            :key="block.id"
            class="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
          >
            <UIcon :name="block.icon" mode="svg" class="w-5 h-5 mt-0.5 shrink-0" />
            <div>
              <p class="text-sm font-medium text-gray-900 dark:text-white">{{ block.name }}</p>
              <p v-if="block.description" class="text-xs text-gray-400 mt-0.5">{{ block.description }}</p>
            </div>
          </div>
        </div>
      </div>

  </div>
</template>
