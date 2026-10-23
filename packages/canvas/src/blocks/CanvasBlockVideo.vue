<script setup lang="ts">
import { computed, inject, onMounted, ref, watch } from 'vue'
import type { SpacingValue } from '../types'
import { spacingToCss } from '../utils/spacing'
import { blockIdKey } from '../utils/block-context'
import { canvasHostKey } from '../host'
import { isStreamPlayerUrl, parseVideoUrl, videoEmbedUrl } from '../utils/video-url'

const props = withDefaults(defineProps<{
  url?: string
  aspectRatio?: '16:9' | '4:3' | '1:1' | '9:16'
  caption?: string
  autoplay?: boolean
  muted?: boolean
  padding?: SpacingValue
  /** Search-engine details (VideoObject structured data and the video sitemap) — not shown. */
  title?: string
  description?: string
  /**
   * Set by the public page API, never stored: true when this is a private Cloudflare Stream
   * video (plays only with a signed link), false when it's public. Absent in the editor
   * and in pages cached before this existed — the block then asks.
   */
  privateVideo?: boolean
}>(), {
  url: '',
  aspectRatio: '16:9',
  caption: '',
  autoplay: false,
  muted: false,
  padding: undefined,
  title: '',
  description: '',
  privateVideo: undefined,
})

const paddingStyle = computed(() => ({ padding: spacingToCss(props.padding, '16px 24px') }))

const aspectMap: Record<string, number> = {
  '16:9': 56.25,
  '4:3': 75,
  '1:1': 100,
  '9:16': 177.78,
}

const paddingBottom = computed(() => `${aspectMap[props.aspectRatio ?? '16:9'] ?? 56.25}%`)

const video = computed(() => parseVideoUrl(props.url))

// ── Private Cloudflare Stream videos ─────────────────────────────────────────
// A Stream video can require signed links (password and members-only pages make theirs
// private). The signed link expires, so it's fetched in the browser for whoever is
// watching — never put into the server-rendered (and cached) page.
const host = inject(canvasHostKey, null)
const blockId = inject(blockIdKey, '')
const needsLookup = computed(() => video.value?.provider === 'stream' && props.privateVideo !== false && Boolean(host?.videoPlaybackUrl))
const signedUrl = ref<string | null>(null)
const lookupState = ref<'pending' | 'done' | 'failed'>('pending')

async function lookUpPlayback() {
  const v = video.value
  if (!needsLookup.value || !v || !host?.videoPlaybackUrl) return
  lookupState.value = 'pending'
  signedUrl.value = null
  try {
    const path = typeof window !== 'undefined' ? window.location.pathname.replace(/^\/+|\/+$/g, '') : ''
    const url = await host.videoPlaybackUrl({ streamId: v.id, blockId, path })
    signedUrl.value = url && isStreamPlayerUrl(url) ? url : null
    lookupState.value = 'done'
  } catch {
    lookupState.value = 'failed'
  }
}

onMounted(lookUpPlayback)
watch(() => [props.url, props.privateVideo], lookUpPlayback)

const embedUrl = computed(() => {
  const v = video.value
  if (!v) return null
  if (needsLookup.value) {
    if (lookupState.value !== 'done') return null
    if (signedUrl.value) {
      const u = new URL(signedUrl.value)
      if (props.autoplay) u.searchParams.set('autoplay', 'true')
      if (props.muted) u.searchParams.set('muted', 'true')
      return u.toString()
    }
    // The server said this video is public after all.
  }
  return videoEmbedUrl(v, { autoplay: props.autoplay, muted: props.muted })
})
</script>

<template>
  <div :style="paddingStyle">
    <!-- Embed -->
    <div v-if="embedUrl" class="relative overflow-hidden rounded-lg" :style="{ paddingBottom, height: 0 }">
      <iframe
        :src="embedUrl"
        :title="title || caption || 'Video'"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen
        class="absolute inset-0 w-full h-full border-0"
        loading="lazy"
      />
    </div>

    <!-- A private video while its signed link loads, or when it can't be played here -->
    <div
      v-else-if="video"
      class="canvas-video-pending flex flex-col items-center justify-center rounded-lg bg-black text-gray-400"
      :style="{ aspectRatio: aspectRatio?.replace(':', '/') ?? '16/9' }"
    >
      <p v-if="lookupState === 'failed'" class="text-sm px-4 text-center">This video can't be played right now.</p>
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
