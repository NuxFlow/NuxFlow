<script setup lang="ts">
import { computed } from 'vue'
import type { SpacingValue } from '../types'

const props = withDefaults(defineProps<{
  url?: string
  aspectRatio?: '16:9' | '4:3' | '1:1' | '9:16'
  caption?: string
  autoplay?: boolean
  muted?: boolean
  padding?: SpacingValue
}>(), {
  url: '',
  aspectRatio: '16:9',
  caption: '',
  autoplay: false,
  muted: false,
})

const paddingStyle = computed(() => {
  const p = props.padding
  return p ? { padding: `${p.top}${p.unit} ${p.right}${p.unit} ${p.bottom}${p.unit} ${p.left}${p.unit}` } : { padding: '16px 24px' }
})

const aspectMap: Record<string, number> = {
  '16:9': 56.25,
  '4:3': 75,
  '1:1': 100,
  '9:16': 177.78,
}

const paddingBottom = computed(() => `${aspectMap[props.aspectRatio ?? '16:9'] ?? 56.25}%`)

const embedUrl = computed(() => {
  const raw = props.url?.trim()
  if (!raw) return null

  // Cloudflare Stream
  const cfStream = raw.match(/(?:videodelivery\.net\/|cloudflarestream\.com\/|watch\.cloudflarestream\.com\/|^)([a-f0-9]{32})(?:\/iframe)?$/i)
  if (cfStream) {
    const params = new URLSearchParams()
    if (props.autoplay) params.set('autoplay', 'true')
    if (props.muted) params.set('muted', 'true')
    params.set('controls', 'true')
    return `https://iframe.videodelivery.net/${cfStream[1]}?${params}`
  }

  // YouTube
  const yt = raw.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/)
  if (yt) {
    const params = new URLSearchParams({ rel: '0', modestbranding: '1' })
    if (props.autoplay) params.set('autoplay', '1')
    if (props.muted) params.set('mute', '1')
    return `https://www.youtube.com/embed/${yt[1]}?${params}`
  }

  // Vimeo
  const vimeo = raw.match(/vimeo\.com\/(\d+)/)
  if (vimeo) {
    const params = new URLSearchParams()
    if (props.autoplay) params.set('autoplay', '1')
    if (props.muted) params.set('muted', '1')
    return `https://player.vimeo.com/video/${vimeo[1]}?${params}`
  }

  return null
})
</script>

<template>
  <div :style="paddingStyle">
    <!-- Embed -->
    <div v-if="embedUrl" class="relative overflow-hidden rounded-lg" :style="{ paddingBottom, height: 0 }">
      <iframe
        :src="embedUrl"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen
        class="absolute inset-0 w-full h-full border-0"
        loading="lazy"
      />
    </div>

    <!-- Empty state -->
    <div
      v-else
      class="flex flex-col items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-400"
      :style="{ aspectRatio: aspectRatio?.replace(':', '/') ?? '16/9' }"
    >
      <svg class="w-10 h-10 mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <p class="text-sm">Paste a YouTube, Vimeo, or Cloudflare Stream URL</p>
    </div>

    <p v-if="caption" class="mt-2 text-sm text-gray-500 text-center">{{ caption }}</p>
  </div>
</template>
