<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SpacingValue } from '../types'
import { spacingToCss } from '../utils/spacing'
import { mapEmbedUrl, mapLinkUrl, mapProviderName } from '../utils/map'

// Theme hooks: .canvas-map, .canvas-map-frame, .canvas-map-placeholder, .canvas-map-caption.
// With "load only when clicked" (the default) nothing is fetched from the map provider
// until the visitor asks — no third-party cookies or requests just for opening the page.

const props = withDefaults(defineProps<{
  title?: string
  address?: string
  provider?: string
  latitude?: number | string
  longitude?: number | string
  zoom?: number | string
  height?: number | string
  clickToLoad?: boolean
  caption?: string
  rounded?: boolean
  bgColor?: string
  textColor?: string
  padding?: SpacingValue
}>(), {
  title: '',
  address: '',
  provider: 'google',
  latitude: 0,
  longitude: 0,
  zoom: 14,
  height: 400,
  clickToLoad: true,
  caption: '',
  rounded: true,
  bgColor: '',
  textColor: '',
  padding: undefined,
})

const embedUrl = computed(() => mapEmbedUrl(props))
const linkUrl = computed(() => mapLinkUrl(props))
const providerName = computed(() => mapProviderName(props.provider))
const loaded = ref(false)
const showFrame = computed(() => Boolean(embedUrl.value) && (!props.clickToLoad || loaded.value))
const frameHeight = computed(() => {
  const n = Number(props.height)
  return `${Number.isFinite(n) ? Math.min(900, Math.max(160, n)) : 400}px`
})
const label = computed(() => props.title || props.address || 'Map')

const containerStyle = computed(() => ({
  backgroundColor: props.bgColor || undefined,
  color: props.textColor || undefined,
  padding: spacingToCss(props.padding, '48px 24px'),
}))
</script>

<template>
  <section class="canvas-map" :style="containerStyle">
    <div class="mx-auto max-w-5xl">
      <h2 v-if="title" class="text-2xl font-bold mb-4">{{ title }}</h2>
      <div
        class="canvas-map-frame relative w-full overflow-hidden bg-gray-100 dark:bg-gray-800"
        :class="{ 'rounded-xl': rounded }"
        :style="{ height: frameHeight }"
      >
        <iframe
          v-if="showFrame"
          :src="embedUrl!"
          :title="`${providerName}: ${label}`"
          class="absolute inset-0 h-full w-full border-0"
          loading="lazy"
          referrerpolicy="no-referrer-when-downgrade"
          allowfullscreen
        />
        <div v-else class="canvas-map-placeholder absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <svg class="h-10 w-10 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
            <circle cx="12" cy="9.5" r="2.5" />
          </svg>
          <template v-if="embedUrl">
            <p v-if="address" class="font-medium">{{ address }}</p>
            <button
              type="button"
              class="rounded-lg bg-white/90 px-4 py-2 text-sm font-semibold text-gray-900 shadow hover:bg-white dark:bg-gray-900/90 dark:text-white"
              @click="loaded = true"
            >
              Show map
            </button>
            <p class="text-xs opacity-60">Loads {{ providerName }}.</p>
          </template>
          <p v-else class="text-sm opacity-60">
            {{ provider === 'osm' ? 'Add the latitude and longitude to show the map.' : 'Add an address to show the map.' }}
          </p>
        </div>
      </div>
      <div v-if="caption || linkUrl" class="canvas-map-caption mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <p v-if="caption" class="opacity-80">{{ caption }}</p>
        <a v-if="linkUrl" :href="linkUrl" target="_blank" rel="noopener" class="underline opacity-80 hover:opacity-100">
          Open in {{ providerName }}
        </a>
      </div>
    </div>
  </section>
</template>
