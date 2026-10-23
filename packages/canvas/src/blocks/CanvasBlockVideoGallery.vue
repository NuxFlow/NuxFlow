<script setup lang="ts">
import { computed, inject, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import type { SpacingValue } from '../types'
import { spacingToCss } from '../utils/spacing'
import { blockIdKey } from '../utils/block-context'
import { canvasHostKey } from '../host'
import { isStreamPlayerUrl, parseVideoList, parseVideoUrl, videoEmbedUrl, videoThumbnailUrl, videoWatchUrl, type VideoRef } from '../utils/video-url'

const props = withDefaults(defineProps<{
  /** One video per line: `URL` or `URL | Title`. */
  videos?: string
  columns?: '1' | '2' | '3' | '4'
  aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3'
  gap?: number
  showTitles?: boolean
  rounded?: boolean
  padding?: SpacingValue
  /** Set by the public page API, never stored: Stream ids here that need a signed link. */
  privateVideos?: string[]
}>(), {
  videos: '',
  columns: '3',
  aspectRatio: '16:9',
  gap: 16,
  showTitles: true,
  rounded: true,
  padding: undefined,
  privateVideos: undefined,
})

interface Item { ref: VideoRef; title: string; needsLookup: boolean }

const host = inject(canvasHostKey, null)
const blockId = inject(blockIdKey, '')

const items = computed<Item[]>(() => parseVideoList(props.videos).map(({ url, title }) => {
  const ref = parseVideoUrl(url)!
  // A Stream video may be private: ask unless the page API said it's public (editor: always ask).
  const needsLookup = ref.provider === 'stream' && (props.privateVideos === undefined || props.privateVideos.includes(ref.id))
  return { ref, title, needsLookup }
}))

const gridStyle = computed(() => ({
  padding: spacingToCss(props.padding, '16px 24px'),
  gap: `${Math.max(0, Number(props.gap ?? 16))}px`,
}))
const gridCols = computed(() => ({
  '1': 'grid-cols-1',
  '2': 'grid-cols-1 sm:grid-cols-2',
  '3': 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  '4': 'grid-cols-2 lg:grid-cols-4',
}[props.columns ?? '3'] ?? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'))
const tileAspect = computed(() => (props.aspectRatio ?? '16:9').replace(':', '/'))

// ── Thumbnails ───────────────────────────────────────────────────────────────
// YouTube and public Stream videos have one at a fixed address; Vimeo's comes from its
// public oEmbed endpoint. A private Stream video shows a plain tile (its thumbnail needs a
// signed link too).
const vimeoThumbs = reactive<Record<string, string>>({})

function thumbnail(item: Item): string | null {
  if (item.needsLookup) return null
  if (item.ref.provider === 'vimeo') return vimeoThumbs[item.ref.id] ?? null
  return videoThumbnailUrl(item.ref)
}

onMounted(() => {
  for (const item of items.value) {
    if (item.ref.provider !== 'vimeo' || vimeoThumbs[item.ref.id]) continue
    fetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(videoWatchUrl(item.ref))}&width=640`, { credentials: 'omit' })
      .then(r => (r.ok ? r.json() as Promise<{ thumbnail_url?: unknown }> : null))
      .then((data) => {
        if (typeof data?.thumbnail_url === 'string' && data.thumbnail_url.startsWith('https://')) vimeoThumbs[item.ref.id] = data.thumbnail_url
      })
      .catch(() => {})
  }
})

// ── Player ───────────────────────────────────────────────────────────────────
const openIndex = ref<number | null>(null)
const playerUrl = ref<string | null>(null)
const playerError = ref(false)
const closeBtn = ref<HTMLButtonElement | null>(null)
let previouslyFocused: HTMLElement | null = null

async function load(index: number) {
  const item = items.value[index]
  if (!item) return
  playerUrl.value = null
  playerError.value = false
  if (!item.needsLookup || !host?.videoPlaybackUrl) {
    playerUrl.value = videoEmbedUrl(item.ref, { autoplay: true })
    return
  }
  try {
    const path = window.location.pathname.replace(/^\/+|\/+$/g, '')
    const signed = await host.videoPlaybackUrl({ streamId: item.ref.id, blockId, path })
    if (openIndex.value !== index) return
    if (signed === null) {
      playerUrl.value = videoEmbedUrl(item.ref, { autoplay: true })
    } else if (isStreamPlayerUrl(signed)) {
      const u = new URL(signed)
      u.searchParams.set('autoplay', 'true')
      playerUrl.value = u.toString()
    } else {
      playerError.value = true
    }
  } catch {
    if (openIndex.value === index) playerError.value = true
  }
}

async function open(index: number) {
  previouslyFocused = document.activeElement as HTMLElement | null
  openIndex.value = index
  void load(index)
  await nextTick()
  closeBtn.value?.focus()
}

function close() {
  openIndex.value = null
  playerUrl.value = null
  previouslyFocused?.focus()
}

function step(delta: number) {
  if (openIndex.value === null || items.value.length < 2) return
  const next = (openIndex.value + delta + items.value.length) % items.value.length
  openIndex.value = next
  void load(next)
}

function onKey(e: KeyboardEvent) {
  if (openIndex.value === null) return
  if (e.key === 'Escape') close()
  else if (e.key === 'ArrowRight') step(1)
  else if (e.key === 'ArrowLeft') step(-1)
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

const openItem = computed(() => (openIndex.value === null ? null : items.value[openIndex.value] ?? null))
const playerAspect = computed(() => (openItem.value && props.aspectRatio === '9:16' ? '9/16' : '16/9'))
</script>

<template>
  <div class="canvas-video-gallery">
    <div v-if="items.length" class="grid" :class="gridCols" :style="gridStyle">
      <button
        v-for="(item, i) in items"
        :key="`${item.ref.provider}:${item.ref.id}:${i}`"
        type="button"
        class="canvas-video-gallery-item group text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-current"
        :aria-label="`Play ${item.title || 'video'}`"
        @click="open(i)"
      >
        <span
          class="relative block w-full overflow-hidden bg-gray-900"
          :class="rounded ? 'rounded-lg' : ''"
          :style="{ aspectRatio: tileAspect }"
        >
          <img
            v-if="thumbnail(item)"
            :src="thumbnail(item)!"
            :alt="item.title"
            loading="lazy"
            class="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          >
          <span class="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/35 transition-colors">
            <span class="flex items-center justify-center w-14 h-14 rounded-full bg-black/60 text-white">
              <UIcon name="i-lucide-play" mode="svg" class="w-7 h-7 ml-1" />
            </span>
          </span>
        </span>
        <span v-if="showTitles && item.title" class="canvas-video-gallery-title block mt-2 text-sm font-medium">{{ item.title }}</span>
      </button>
    </div>

    <div
      v-else
      class="mx-6 my-4 flex flex-col items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-400 py-12 px-4 text-center"
    >
      <UIcon name="i-lucide-clapperboard" mode="svg" class="w-10 h-10 mb-2 opacity-50" />
      <p class="text-sm">Add one video link per line — YouTube, Vimeo or Cloudflare Stream. Add a title after a <code>|</code>.</p>
    </div>

    <Teleport to="body">
      <div
        v-if="openItem"
        class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/90 p-4"
        role="dialog"
        aria-modal="true"
        :aria-label="openItem.title || 'Video'"
        @click.self="close"
      >
        <button
          ref="closeBtn"
          type="button"
          class="absolute top-4 right-4 flex items-center justify-center w-10 h-10 rounded-full bg-white/10 text-white hover:bg-white/20"
          aria-label="Close"
          @click="close"
        >
          <UIcon name="i-lucide-x" mode="svg" class="w-5 h-5" />
        </button>
        <button
          v-if="items.length > 1"
          type="button"
          class="absolute left-4 top-1/2 -translate-y-1/2 flex items-center justify-center w-10 h-10 rounded-full bg-white/10 text-white hover:bg-white/20"
          aria-label="Previous video"
          @click="step(-1)"
        >
          <UIcon name="i-lucide-chevron-left" mode="svg" class="w-5 h-5" />
        </button>
        <button
          v-if="items.length > 1"
          type="button"
          class="absolute right-4 top-1/2 -translate-y-1/2 flex items-center justify-center w-10 h-10 rounded-full bg-white/10 text-white hover:bg-white/20"
          aria-label="Next video"
          @click="step(1)"
        >
          <UIcon name="i-lucide-chevron-right" mode="svg" class="w-5 h-5" />
        </button>

        <div class="w-full" :class="playerAspect === '9/16' ? 'max-w-[min(90vw,calc(85vh*9/16))]' : 'max-w-[min(90vw,calc(85vh*16/9))]'">
          <div class="relative w-full overflow-hidden rounded-lg bg-black" :style="{ aspectRatio: playerAspect }">
            <iframe
              v-if="playerUrl"
              :src="playerUrl"
              :title="openItem.title || 'Video'"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowfullscreen
              class="absolute inset-0 w-full h-full border-0"
            />
            <p v-else-if="playerError" class="absolute inset-0 flex items-center justify-center text-sm text-gray-400 px-4 text-center">
              This video can't be played right now.
            </p>
          </div>
          <p v-if="openItem.title" class="mt-3 text-center text-sm text-gray-200">{{ openItem.title }}</p>
        </div>
      </div>
    </Teleport>
  </div>
</template>
