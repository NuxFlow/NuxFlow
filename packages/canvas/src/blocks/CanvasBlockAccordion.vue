<script setup lang="ts">
import { ref, computed } from 'vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import type { SpacingValue } from '../types'

const props = withDefaults(defineProps<{
  title?: string
  description?: string
  itemsJson?: string
  bgColor?: string
  textColor?: string
  padding?: SpacingValue
}>(), {
  title: 'Frequently Asked Questions',
  description: 'Everything you need to know about our product.',
  itemsJson: '[{"question":"How does NuxFlow work?","answer":"NuxFlow operates natively on Cloudflare Workers edge nodes. It fetches your content directly from D1 and renders pages with Vue 3 server-side rendering."},{"question":"Do I need server configuration?","answer":"No, NuxFlow is fully serverless. You deploy it once to Cloudflare and it scales automatically with zero maintenance."}]',
})

const activeIndex = ref<number | null>(null)

function toggle(index: number) {
  activeIndex.value = activeIndex.value === index ? null : index
}

const parsedItems = computed(() => {
  if (!props.itemsJson) return []
  try {
    const val = JSON.parse(props.itemsJson)
    return Array.isArray(val) ? val as Array<{ question: string; answer: string }> : []
  } catch {
    return []
  }
})

const containerStyle = computed(() => {
  const p = props.padding
  return {
    backgroundColor: props.bgColor || 'transparent',
    color: props.textColor || 'inherit',
    padding: p ? `${p.top}${p.unit} ${p.right}${p.unit} ${p.bottom}${p.unit} ${p.left}${p.unit}` : '60px 24px',
  }
})
</script>

<template>
  <section class="canvas-accordion w-full" :style="containerStyle">
    <div class="mx-auto max-w-3xl px-6">
      <div v-if="title || description" class="text-center mb-10 space-y-2">
        <h2 v-if="title" class="text-3xl font-extrabold tracking-tight leading-tight">{{ title }}</h2>
        <p v-if="description" class="text-lg opacity-80 whitespace-pre-wrap">{{ description }}</p>
      </div>

      <div v-if="parsedItems.length > 0" class="space-y-4">
        <div
          v-for="(item, index) in parsedItems"
          :key="index"
          class="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm transition-all"
          :class="activeIndex === index ? 'ring-1 ring-primary-500' : ''"
        >
          <button
            type="button"
            class="w-full flex items-center justify-between p-5 text-left font-semibold text-gray-900 dark:text-white hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors"
            @click="toggle(index)"
          >
            <span>{{ item.question }}</span>
            <UIcon
              name="i-lucide-chevron-down"
              mode="svg"
              class="w-5 h-5 transition-transform duration-300 shrink-0 ml-4 text-gray-400"
              :class="activeIndex === index ? 'rotate-180 text-primary-500' : ''"
            />
          </button>
          
          <div
            v-show="activeIndex === index"
            class="border-t border-gray-100 dark:border-gray-800/80 p-5 text-gray-600 dark:text-gray-300 text-sm leading-relaxed whitespace-pre-wrap bg-gray-50/30 dark:bg-gray-900/10"
          >
            {{ item.answer }}
          </div>
        </div>
      </div>
      <div v-else class="text-center py-6 text-gray-400">
        No items configured.
      </div>
    </div>
  </section>
</template>
