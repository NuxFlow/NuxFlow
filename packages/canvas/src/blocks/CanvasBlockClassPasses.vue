<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { SpacingValue } from '../types'
import { spacingToCss } from '../utils/spacing'
import { useCanvasHost, type CanvasClassPass } from '../host'

const props = withDefaults(defineProps<{
  title?: string
  description?: string
  buttonText?: string
  bgColor?: string
  textColor?: string
  padding?: SpacingValue
}>(), {
  title: 'Class passes',
  description: 'Save when you book a block of sessions.',
  buttonText: 'Buy now',
  bgColor: undefined,
  textColor: undefined,
  padding: undefined,
})

const host = useCanvasHost()
const passes = ref<CanvasClassPass[]>([])
const canBuy = ref(false)
const loaded = ref(false)

const containerStyle = computed(() => ({
  backgroundColor: props.bgColor || 'transparent',
  color: props.textColor || 'inherit',
  padding: spacingToCss(props.padding, '60px 24px'),
}))

function price(pass: CanvasClassPass): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: pass.currency, minimumFractionDigits: Number.isInteger(pass.price) ? 0 : 2 }).format(pass.price)
  }
  catch {
    return `${pass.price} ${pass.currency}`
  }
}

function sessions(pass: CanvasClassPass): string {
  return pass.credits === 1 ? '1 session' : `${pass.credits} sessions`
}

function validity(pass: CanvasClassPass): string {
  return pass.validDays ? `Valid for ${pass.validDays} days` : 'Never expires'
}

// Fetched in the browser, like the Calendar block: the page around it is cached whole, and
// what's on sale changes without that page being saved.
onMounted(async () => {
  try {
    const result = await host.listClassPasses?.()
    passes.value = result?.passes ?? []
    canBuy.value = result?.canBuy ?? false
  }
  catch (err) {
    console.error('Failed to load class passes:', err)
  }
  finally {
    loaded.value = true
  }
})
</script>

<template>
  <section class="canvas-class-passes w-full" :style="containerStyle">
    <div class="mx-auto max-w-5xl px-6">
      <div v-if="title || description" class="text-center mb-10 space-y-3">
        <h2 v-if="title" class="text-3xl font-extrabold tracking-tight leading-tight md:text-4xl text-gray-900 dark:text-white">{{ title }}</h2>
        <p v-if="description" class="text-lg text-gray-500 dark:text-gray-400 max-w-2xl mx-auto whitespace-pre-wrap">{{ description }}</p>
      </div>
      <p v-if="loaded && passes.length === 0" class="text-center text-sm text-gray-500 dark:text-gray-400">No passes are on sale at the moment.</p>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div
          v-for="pass in passes"
          :key="pass.id"
          class="canvas-class-pass flex flex-col rounded-2xl border border-gray-200 dark:border-gray-800 p-6"
        >
          <h3 class="text-lg font-bold text-gray-900 dark:text-white">{{ pass.name }}</h3>
          <p class="text-3xl font-extrabold text-gray-900 dark:text-white mt-2">{{ price(pass) }}</p>
          <p class="text-sm font-medium text-primary-600 dark:text-primary-400 mt-1">{{ sessions(pass) }}</p>
          <p v-if="pass.description" class="text-sm text-gray-500 dark:text-gray-400 mt-3 whitespace-pre-wrap">{{ pass.description }}</p>
          <p class="text-xs text-gray-400 mt-3">{{ validity(pass) }}</p>
          <a
            v-if="canBuy"
            :href="`/booking/passes?buy=${pass.id}`"
            class="mt-auto inline-flex justify-center rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600 transition-colors"
            :style="{ marginTop: '1.25rem' }"
          >
            {{ buttonText }}
          </a>
        </div>
      </div>
    </div>
  </section>
</template>
