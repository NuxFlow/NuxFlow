<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue'
import type { SpacingValue } from '../types'
import { spacingToCss } from '../utils/spacing'
import { useCanvasHost, type CanvasGoogleReviews } from '../host'
import { canvasApiKey } from '../editor/canvasApi'

// Theme hooks: .canvas-google-reviews, .canvas-google-reviews-summary, .canvas-google-review,
// .canvas-google-reviews-attribution.
// The business's Google rating and reviews, as Google returns them (Settings → Business →
// Google reviews). Shown as written, with Google's attribution and a link to all of them.

const props = withDefaults(defineProps<{
  title?: string
  maxReviews?: number | string
  layout?: string
  bgColor?: string
  textColor?: string
  padding?: SpacingValue
}>(), {
  title: 'What our customers say',
  maxReviews: 3,
  layout: 'grid',
  bgColor: '',
  textColor: '',
  padding: undefined,
})

const host = useCanvasHost()
const inEditor = inject(canvasApiKey, null) !== null
const data = ref<CanvasGoogleReviews | null>(null)
const loaded = ref(false)

onMounted(async () => {
  try {
    data.value = await host.googleReviews?.() ?? null
  }
  catch {
    data.value = null
  }
  loaded.value = true
})

const shown = computed(() => (data.value?.reviews ?? []).slice(0, Math.max(0, Math.min(5, Number(props.maxReviews) || 0))))
const stars = (n: number) => Array.from({ length: 5 }, (_, i) => i < Math.round(n))
const containerStyle = computed(() => ({
  backgroundColor: props.bgColor || undefined,
  color: props.textColor || undefined,
  padding: spacingToCss(props.padding, '48px 24px'),
}))
</script>

<template>
  <section v-if="data || (inEditor && loaded)" class="canvas-google-reviews" :style="containerStyle">
    <div class="mx-auto max-w-5xl">
      <h2 v-if="title" class="mb-6 text-center text-3xl font-bold">{{ title }}</h2>

      <p v-if="!data" class="text-center text-sm opacity-60">
        Add your Google Place ID and a Google Places API key in Settings → Business, and your reviews will show here.
      </p>

      <template v-else>
        <div v-if="data.rating !== null" class="canvas-google-reviews-summary mb-8 flex flex-wrap items-center justify-center gap-3">
          <span class="text-3xl font-bold">{{ data.rating.toFixed(1) }}</span>
          <span class="flex text-amber-500" :aria-label="`${data.rating} out of 5 stars`" role="img">
            <svg v-for="(on, i) in stars(data.rating)" :key="i" viewBox="0 0 24 24" class="h-6 w-6" :fill="on ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z" /></svg>
          </span>
          <span class="text-sm opacity-75">{{ data.count.toLocaleString() }} reviews on Google</span>
        </div>

        <ul :class="layout === 'list' ? 'mx-auto max-w-2xl space-y-4' : 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3'">
          <li v-for="(r, i) in shown" :key="i" class="canvas-google-review rounded-xl border border-current/15 p-4">
            <div class="mb-2 flex items-center gap-3">
              <img v-if="r.photo" :src="r.photo" alt="" class="h-9 w-9 rounded-full" referrerpolicy="no-referrer" loading="lazy">
              <div class="min-w-0">
                <a v-if="r.authorUrl" :href="r.authorUrl" target="_blank" rel="noopener nofollow" class="block truncate font-semibold hover:underline">{{ r.author }}</a>
                <p v-else class="truncate font-semibold">{{ r.author }}</p>
                <p class="text-xs opacity-60">{{ r.when }}</p>
              </div>
            </div>
            <span class="mb-2 flex text-amber-500" :aria-label="`${r.rating} out of 5 stars`" role="img">
              <svg v-for="(on, j) in stars(r.rating)" :key="j" viewBox="0 0 24 24" class="h-4 w-4" :fill="on ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z" /></svg>
            </span>
            <p class="text-sm opacity-90 whitespace-pre-line line-clamp-6">{{ r.text }}</p>
          </li>
        </ul>

        <p class="canvas-google-reviews-attribution mt-6 text-center text-sm opacity-75">
          Reviews from <span class="font-semibold">Google</span>
          <template v-if="data.url"> · <a :href="data.url" target="_blank" rel="noopener" class="underline">See all reviews on Google</a></template>
        </p>
      </template>
    </div>
  </section>
</template>
