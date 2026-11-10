<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { SpacingValue } from '../types'
import { spacingToCss } from '../utils/spacing'
import { useCanvasHost, type CanvasProductCard } from '../host'
import NuxImage from './NuxImage.vue'

const props = withDefaults(defineProps<{
  product?: string
  buttonText?: string
  addText?: string
  bgColor?: string
  textColor?: string
  padding?: SpacingValue
}>(), {
  product: '',
  buttonText: 'View product',
  addText: 'Add to basket',
  bgColor: undefined,
  textColor: undefined,
  padding: undefined,
})

const host = useCanvasHost()
const item = ref<CanvasProductCard | null>(null)
const added = ref(false)

function add() {
  if (!item.value) return
  host.addToBasket?.(item.value)
  added.value = true
}
const loaded = ref(false)

const containerStyle = computed(() => ({
  backgroundColor: props.bgColor || 'transparent',
  color: props.textColor || 'inherit',
  padding: spacingToCss(props.padding, '60px 24px'),
}))

async function load() {
  const slug = props.product.trim()
  item.value = null
  if (!slug) {
    loaded.value = true
    return
  }
  try {
    const [found] = await host.listProducts?.({ limit: 1, slugs: [slug] }) ?? []
    item.value = found ?? null
  }
  catch (err) {
    console.error('Failed to load the product:', err)
  }
  finally {
    loaded.value = true
  }
}
onMounted(load)
watch(() => props.product, load)
</script>

<template>
  <section class="canvas-product w-full" :style="containerStyle">
    <div class="mx-auto max-w-5xl px-6">
      <p v-if="loaded && !item" class="text-center text-sm text-gray-500 dark:text-gray-400">{{ product ? 'That product isn\'t on sale.' : 'Choose a product in this block\'s settings.' }}</p>
      <div v-if="item" class="grid items-center gap-8 md:grid-cols-2">
        <div class="aspect-square overflow-hidden rounded-2xl bg-gray-100 dark:bg-gray-800">
          <NuxImage v-if="item.image" :src="item.image" :alt="item.title" :width="800" :height="800" fit="cover" class="h-full w-full object-cover" />
        </div>
        <div class="space-y-4">
          <h2 class="text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white">{{ item.title }}</h2>
          <p class="text-xl text-gray-800 dark:text-gray-200">
            {{ item.price }}
            <s v-if="item.compareAt" class="ml-2 text-base text-gray-400">{{ item.compareAt }}</s>
          </p>
          <p v-if="item.excerpt" class="text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{{ item.excerpt }}</p>
          <div class="flex flex-wrap items-center gap-3">
            <button
              v-if="item.available && item.variantId && host.addToBasket"
              type="button"
              class="canvas-product-button inline-flex items-center rounded-lg bg-primary-600 px-5 py-3 font-semibold text-white hover:bg-primary-700"
              @click="add"
            >
              {{ addText }}
            </button>
            <a
              :href="item.path"
              class="inline-flex items-center rounded-lg px-5 py-3 font-semibold"
              :class="item.available && item.variantId && host.addToBasket ? 'border border-gray-300 dark:border-gray-700' : 'canvas-product-button bg-primary-600 text-white hover:bg-primary-700'"
            >
              {{ item.available ? buttonText : 'Sold out' }}
            </a>
          </div>
          <p v-if="added" class="text-sm" role="status">Added to your basket. <a href="/checkout" class="underline font-medium">View basket</a></p>
        </div>
      </div>
    </div>
  </section>
</template>
