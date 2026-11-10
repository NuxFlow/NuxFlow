<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { SpacingValue } from '../types'
import { spacingToCss } from '../utils/spacing'
import { useCanvasHost, type CanvasProductCard } from '../host'
import NuxImage from './NuxImage.vue'

const props = withDefaults(defineProps<{
  title?: string
  description?: string
  collection?: string
  columns?: string
  limit?: number
  bgColor?: string
  textColor?: string
  padding?: SpacingValue
}>(), {
  title: 'Shop',
  description: '',
  collection: '',
  columns: '3',
  limit: 12,
  bgColor: undefined,
  textColor: undefined,
  padding: undefined,
})

const host = useCanvasHost()
const products = ref<CanvasProductCard[]>([])
const loaded = ref(false)

const containerStyle = computed(() => ({
  backgroundColor: props.bgColor || 'transparent',
  color: props.textColor || 'inherit',
  padding: spacingToCss(props.padding, '60px 24px'),
}))

const gridClass = computed(() => ({
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 lg:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
}[props.columns] ?? 'sm:grid-cols-2 lg:grid-cols-3'))

// Fetched in the browser, like the Posts block: the page around it is cached whole, and
// prices and stock change without that page being saved.
async function load() {
  try {
    products.value = await host.listProducts?.({ limit: Number(props.limit) || 12, collection: props.collection.trim() || undefined }) ?? []
  }
  catch (err) {
    console.error('Failed to load products:', err)
  }
  finally {
    loaded.value = true
  }
}
onMounted(load)
watch(() => [props.collection, props.limit], load)
</script>

<template>
  <section class="canvas-products w-full" :style="containerStyle">
    <div class="mx-auto max-w-6xl px-6">
      <div v-if="title || description" class="text-center mb-10 space-y-3">
        <h2 v-if="title" class="text-3xl font-extrabold tracking-tight leading-tight md:text-4xl text-gray-900 dark:text-white">{{ title }}</h2>
        <p v-if="description" class="text-lg text-gray-500 dark:text-gray-400 max-w-2xl mx-auto whitespace-pre-wrap">{{ description }}</p>
      </div>
      <p v-if="loaded && products.length === 0" class="text-center text-sm text-gray-500 dark:text-gray-400">No products to show yet.</p>
      <div class="canvas-products-grid grid gap-6" :class="gridClass" :data-count="products.length">
        <a v-for="p in products" :key="p.id" :href="p.path" class="canvas-product-card group flex flex-col">
          <div class="aspect-square overflow-hidden rounded-2xl bg-gray-100 dark:bg-gray-800">
            <NuxImage v-if="p.image" :src="p.image" :alt="p.title" :width="600" :height="600" fit="cover" class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
          </div>
          <p class="mt-3 font-semibold text-gray-900 dark:text-white">{{ p.title }}</p>
          <p class="text-sm text-gray-700 dark:text-gray-300">
            {{ p.price }}
            <s v-if="p.compareAt" class="ml-1 text-gray-400">{{ p.compareAt }}</s>
            <span v-if="!p.available" class="ml-2 text-xs text-gray-500">Sold out</span>
          </p>
        </a>
      </div>
    </div>
  </section>
</template>
