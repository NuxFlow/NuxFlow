<script setup lang="ts">
// Three layouts:
//  - grid      — every photo cropped to one shape (the only layout before `layout`
//                existed, so it stays the default for galleries saved without one)
//  - masonry   — whole photos in staggered CSS columns
//  - justified — whole photos in rows of equal height (each item's flex-grow is its
//                width/height ratio, so a row's items all end up the same height)
// Theme hooks: .canvas-gallery[data-layout], .canvas-gallery-item, .canvas-gallery-caption.
import { computed, inject, onMounted, ref } from 'vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import type { SpacingValue } from '../types'
import NuxLightbox from './NuxLightbox.vue'
import NuxImage from './NuxImage.vue'
import { spacingToCss } from '../utils/spacing'
import { parseImageList, type ImageListItem } from '../utils/json'
import { aspectRatioValue, imageRatio, type GalleryLayout } from '../utils/gallery'
import { blockIdKey } from '../utils/block-context'
import { useCanvasHost } from '../host'

// Ambient — a Nuxt auto-import supplied by the host app (same pattern as NuxImage.vue).
declare const useRequestURL: () => URL

// Transform request widths (Cloudflare Image Transformations, when enabled) — well above
// what a tile is displayed at on most screens, far below a full-resolution original.
const GRID_THUMB_SIZE = 600
const UNCROPPED_THUMB_WIDTH = 900

const props = withDefaults(defineProps<{
  images?: string
  layout?: GalleryLayout
  columns?: '2' | '3' | '4'
  aspectRatio?: string
  rowHeight?: number
  gap?: number
  showCaptions?: boolean
  showCameraDetails?: boolean
  /** Client proofing: hearts on the photos and "Send my picks" (server/utils/gallery-picks.ts in NuxFlow). */
  allowFavourites?: boolean
  rounded?: boolean
  lightbox?: boolean
  allowDownload?: boolean
  padding?: SpacingValue
}>(), {
  images: '[]',
  layout: 'grid',
  columns: '3',
  aspectRatio: '1:1',
  rowHeight: 280,
  gap: 8,
  showCaptions: false,
  showCameraDetails: false,
  allowFavourites: false,
  rounded: false,
  lightbox: true,
  allowDownload: false,
  padding: undefined,
})

const parsedImages = computed<ImageListItem[]>(() => parseImageList(props.images))

function hasCaption(img: ImageListItem): boolean {
  return Boolean((props.showCaptions && img.caption) || (props.showCameraDetails && img.camera))
}
// The lightbox has always shown captions; camera details join them when switched on.
const lightboxImages = computed(() => parsedImages.value.map(img => ({
  ...img,
  caption: [img.caption, props.showCameraDetails ? img.camera : ''].filter(Boolean).join(' · ') || undefined,
})))

const gridCols = computed(() => ({
  '2': 'grid-cols-2',
  '3': 'grid-cols-2 sm:grid-cols-3',
  '4': 'grid-cols-2 sm:grid-cols-4',
}[props.columns ?? '3']))

const masonryCols = computed(() => ({
  '2': 'columns-1 sm:columns-2',
  '3': 'columns-2 md:columns-3',
  '4': 'columns-2 md:columns-3 lg:columns-4',
}[props.columns ?? '3']))

const containerStyle = computed(() => ({ padding: spacingToCss(props.padding, '16px 24px') }))

const gridRatio = computed(() => aspectRatioValue(props.aspectRatio))
const gridThumbHeight = computed(() => Math.round(GRID_THUMB_SIZE / gridRatio.value))

const gapPx = computed(() => `${Math.max(0, Number(props.gap) || 0)}px`)
const rowHeightPx = computed(() => `${Math.min(600, Math.max(120, Number(props.rowHeight) || 280))}px`)

function grownHeight(img: ImageListItem): number | undefined {
  return img.width && img.height ? Math.round(UNCROPPED_THUMB_WIDTH / imageRatio(img)) : undefined
}

function justifiedStyle(img: ImageListItem) {
  const r = imageRatio(img)
  return {
    flexGrow: r,
    flexBasis: `calc(var(--nf-gallery-row-h) * ${r})`,
    aspectRatio: String(r),
  }
}

// ── Downloads (client galleries) ────────────────────────────────────────────
// Served by /api/public/gallery-download, which finds this block on this page and applies
// the page's own access rules. Off in the editor (no block id is provided there).
const blockId = inject(blockIdKey, '')
const pagePath = computed(() => {
  let pathname = ''
  try {
    pathname = useRequestURL().pathname
  }
  catch {
    pathname = typeof window !== 'undefined' ? window.location.pathname : ''
  }
  return pathname.replace(/^\/+|\/+$/g, '')
})
const downloadBase = computed(() => {
  if (!props.allowDownload || !blockId) return ''
  return `/api/public/gallery-download?path=${encodeURIComponent(pagePath.value)}&block=${encodeURIComponent(blockId)}`
})

// ── Client proofing ─────────────────────────────────────────────────────────
// Each person hearts photos; picks save to the site shortly after each change (and to this
// browser, so a reload keeps them), and "Send my picks" tells the photographer. A random
// token kept in this browser is who they are — no account. Off in the editor (no block id).
const host = useCanvasHost()
const picking = computed(() => props.allowFavourites && Boolean(blockId) && Boolean(host.saveGalleryPicks))
const picked = ref<string[]>([])
const pickerName = ref('')
const pickNote = ref('')
const showNote = ref(false)
const onlyPicked = ref(false)
const pickStatus = ref<'' | 'saving' | 'saved' | 'sent' | 'needs-name' | 'error'>('')
const pickError = ref('')
const nameInput = ref<HTMLInputElement | null>(null)
let pickToken = ''
let saveTimer: ReturnType<typeof setTimeout> | undefined

const storageKey = () => `nuxflow:picks:${pagePath.value}:${blockId}`
function readStorage(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function writeStorage(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* private mode: picks still save to the site */ }
}
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

const pickedSet = computed(() => new Set(picked.value))
const isPicked = (url: string) => pickedSet.value.has(url)

function togglePick(url: string) {
  picked.value = isPicked(url) ? picked.value.filter(u => u !== url) : [...picked.value, url]
  writeStorage(storageKey(), JSON.stringify(picked.value))
  queueSave()
}

function queueSave() {
  clearTimeout(saveTimer)
  if (!pickerName.value.trim()) {
    pickStatus.value = 'needs-name'
    return
  }
  pickStatus.value = 'saving'
  saveTimer = setTimeout(() => { void sendPicks(false) }, 800)
}

async function sendPicks(submit: boolean) {
  clearTimeout(saveTimer)
  if (!host.saveGalleryPicks) return
  if (!pickerName.value.trim()) {
    pickStatus.value = 'needs-name'
    nameInput.value?.focus()
    return
  }
  writeStorage('nuxflow:picker-name', pickerName.value.trim())
  pickError.value = ''
  pickStatus.value = 'saving'
  try {
    await host.saveGalleryPicks({
      path: pagePath.value, block: blockId, token: pickToken, name: pickerName.value.trim(),
      photos: picked.value, note: pickNote.value || undefined, submit,
    })
    pickStatus.value = submit ? 'sent' : 'saved'
  }
  catch (err) {
    pickStatus.value = 'error'
    pickError.value = err instanceof Error ? err.message : 'Your picks couldn\'t be saved.'
  }
}

onMounted(async () => {
  if (!picking.value) return
  pickToken = readStorage('nuxflow:picker-token') ?? ''
  if (!/^[\w-]{24,128}$/.test(pickToken)) {
    pickToken = newToken()
    writeStorage('nuxflow:picker-token', pickToken)
  }
  pickerName.value = readStorage('nuxflow:picker-name') ?? ''
  try {
    const local = JSON.parse(readStorage(storageKey()) ?? '[]')
    if (Array.isArray(local)) picked.value = local.filter((u): u is string => typeof u === 'string')
  }
  catch { /* ignore a damaged copy */ }
  try {
    const saved = await host.loadGalleryPicks?.({ path: pagePath.value, block: blockId, token: pickToken })
    if (saved) {
      picked.value = saved.photos
      pickerName.value = pickerName.value || saved.pickerName
      pickNote.value = saved.note ?? ''
      showNote.value = Boolean(saved.note)
      if (saved.submittedAt) pickStatus.value = 'sent'
    }
  }
  catch { /* the local copy stands */ }
})

/** The photos shown: all, or only this person's picks — with their place in the gallery. */
const visibleImages = computed(() => parsedImages.value
  .map((img, i) => ({ img, i }))
  .filter(({ img }) => !(picking.value && onlyPicked.value) || isPicked(img.url)))
const photoDownloadUrl = (i: number) => `${downloadBase.value}&index=${i}`

const lightboxOpen = ref(false)
const lightboxIndex = ref(0)

function openLightbox(i: number) {
  if (!props.lightbox) return
  lightboxIndex.value = i
  lightboxOpen.value = true
}
</script>

<template>
  <div class="canvas-gallery" :data-layout="layout" :style="containerStyle">
    <div v-if="downloadBase && parsedImages.length" class="canvas-gallery-actions flex justify-end mb-3">
      <a
        :href="downloadBase"
        download
        class="canvas-gallery-download inline-flex items-center gap-2 rounded-md border border-current/20 px-3 py-1.5 text-sm font-medium opacity-90 hover:opacity-100 transition-opacity"
      >
        <UIcon name="i-lucide-download" mode="svg" class="w-4 h-4" />
        Download all ({{ parsedImages.length }})
      </a>
    </div>
    <div
      v-if="picking && parsedImages.length"
      class="canvas-gallery-picks mb-4 space-y-3 rounded-xl border border-current/15 p-4 text-sm"
      role="region"
      aria-label="Your favourites"
    >
      <p>
        <strong>{{ picked.length }} {{ picked.length === 1 ? 'photo' : 'photos' }} picked.</strong>
        Tap the heart on the ones you love, then send them.
      </p>
      <div class="flex flex-wrap items-end gap-3">
        <label class="flex flex-col gap-1">
          <span class="font-medium">Your name</span>
          <input
            ref="nameInput"
            v-model="pickerName"
            type="text"
            maxlength="80"
            autocomplete="name"
            class="rounded-md border border-current/20 bg-transparent px-2 py-1.5"
            @change="picked.length && queueSave()"
          >
        </label>
        <label class="flex items-center gap-2 pb-1.5">
          <input v-model="onlyPicked" type="checkbox">
          Show only my picks
        </label>
        <button v-if="!showNote" type="button" class="pb-1.5 underline opacity-80 hover:opacity-100" @click="showNote = true">Add a note</button>
        <button
          type="button"
          class="canvas-gallery-send ml-auto rounded-md bg-primary-600 px-4 py-2 font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
          :disabled="!picked.length || pickStatus === 'saving'"
          @click="sendPicks(true)"
        >
          Send my picks
        </button>
      </div>
      <label v-if="showNote" class="flex flex-col gap-1">
        <span class="font-medium">Note for the photographer</span>
        <textarea v-model="pickNote" rows="2" maxlength="2000" class="rounded-md border border-current/20 bg-transparent px-2 py-1.5" @change="queueSave()" />
      </label>
      <p class="text-xs opacity-75" role="status">
        <template v-if="pickStatus === 'needs-name'">Add your name so we know whose picks these are.</template>
        <template v-else-if="pickStatus === 'saving'">Saving…</template>
        <template v-else-if="pickStatus === 'saved'">Saved. Press Send my picks when you're done.</template>
        <template v-else-if="pickStatus === 'sent'">Sent, thank you. You can still change your picks and send them again.</template>
        <template v-else-if="pickStatus === 'error'">{{ pickError }}</template>
      </p>
    </div>
    <template v-if="parsedImages.length">
      <!-- Masonry -->
      <div v-if="layout === 'masonry'" :class="masonryCols" :style="{ columnGap: gapPx }">
        <figure
          v-for="{ img, i } in visibleImages"
          :key="i"
          class="canvas-gallery-item relative break-inside-avoid m-0"
          :style="{ marginBottom: gapPx }"
        >
          <button
            type="button"
            class="block w-full overflow-hidden group"
            :class="[rounded ? 'rounded-lg' : '', lightbox ? 'cursor-zoom-in' : 'cursor-default']"
            :aria-label="lightbox ? `View image ${i + 1} full size` : undefined"
            @click="openLightbox(i)"
          >
            <NuxImage
              :src="img.url"
              :alt="img.alt || ''"
              :width="UNCROPPED_THUMB_WIDTH"
              :height="grownHeight(img)"
              class="block w-full h-auto transition-transform duration-500 ease-out group-hover:scale-[1.03]"
            />
          </button>
          <button
            v-if="picking"
            type="button"
            class="canvas-gallery-pick absolute top-2 right-2 z-10 rounded-full bg-black/40 p-1.5 text-white backdrop-blur transition hover:bg-black/60"
            :aria-pressed="isPicked(img.url)"
            :aria-label="isPicked(img.url) ? `Remove photo ${i + 1} from your favourites` : `Add photo ${i + 1} to your favourites`"
            @click.stop="togglePick(img.url)"
          >
            <svg viewBox="0 0 24 24" class="w-5 h-5 block" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :fill="isPicked(img.url) ? '#f43f5e' : 'none'" :class="isPicked(img.url) ? 'text-rose-500' : ''" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" /></svg>
          </button>
          <figcaption v-if="hasCaption(img)" class="canvas-gallery-caption mt-1.5 text-sm opacity-75">
            <template v-if="showCaptions && img.caption">{{ img.caption }}</template>
            <span v-if="showCameraDetails && img.camera" class="canvas-gallery-camera block text-xs opacity-80">{{ img.camera }}</span>
          </figcaption>
        </figure>
      </div>

      <!-- Justified rows -->
      <div
        v-else-if="layout === 'justified'"
        class="canvas-gallery-rows flex flex-wrap items-start"
        :style="{ gap: gapPx, '--nf-gallery-row-h-base': rowHeightPx }"
      >
        <figure
          v-for="{ img, i } in visibleImages"
          :key="i"
          class="canvas-gallery-item relative min-w-0 m-0 overflow-hidden group"
          :class="rounded ? 'rounded-lg' : ''"
          :style="justifiedStyle(img)"
        >
          <button
            type="button"
            class="absolute inset-0 block w-full h-full"
            :class="lightbox ? 'cursor-zoom-in' : 'cursor-default'"
            :aria-label="lightbox ? `View image ${i + 1} full size` : undefined"
            @click="openLightbox(i)"
          >
            <NuxImage
              :src="img.url"
              :alt="img.alt || ''"
              :width="UNCROPPED_THUMB_WIDTH"
              :height="grownHeight(img)"
              class="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
            />
          </button>
          <button
            v-if="picking"
            type="button"
            class="canvas-gallery-pick absolute top-2 right-2 z-10 rounded-full bg-black/40 p-1.5 text-white backdrop-blur transition hover:bg-black/60"
            :aria-pressed="isPicked(img.url)"
            :aria-label="isPicked(img.url) ? `Remove photo ${i + 1} from your favourites` : `Add photo ${i + 1} to your favourites`"
            @click.stop="togglePick(img.url)"
          >
            <svg viewBox="0 0 24 24" class="w-5 h-5 block" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :fill="isPicked(img.url) ? '#f43f5e' : 'none'" :class="isPicked(img.url) ? 'text-rose-500' : ''" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" /></svg>
          </button>
          <figcaption
            v-if="hasCaption(img)"
            class="canvas-gallery-caption pointer-events-none absolute inset-x-0 bottom-0 px-3 py-2 text-sm text-white bg-gradient-to-t from-black/70 to-transparent"
          >
            <template v-if="showCaptions && img.caption">{{ img.caption }}</template>
            <span v-if="showCameraDetails && img.camera" class="canvas-gallery-camera block text-xs opacity-80">{{ img.camera }}</span>
          </figcaption>
        </figure>
      </div>

      <!-- Cropped grid -->
      <div v-else class="grid" :class="gridCols" :style="{ gap: gapPx }">
        <figure v-for="{ img, i } in visibleImages" :key="i" class="canvas-gallery-item relative m-0">
          <button
            type="button"
            class="relative overflow-hidden block w-full group"
            :class="[rounded ? 'rounded-lg' : '', lightbox ? 'cursor-zoom-in' : 'cursor-default']"
            :style="{ aspectRatio: String(gridRatio) }"
            :aria-label="lightbox ? `View image ${i + 1} full size` : undefined"
            @click="openLightbox(i)"
          >
            <NuxImage
              :src="img.url"
              :alt="img.alt || ''"
              :width="GRID_THUMB_SIZE"
              :height="gridThumbHeight"
              fit="cover"
              class="w-full h-full object-cover transition-transform duration-300 ease-out group-hover:scale-105"
            />
          </button>
          <button
            v-if="picking"
            type="button"
            class="canvas-gallery-pick absolute top-2 right-2 z-10 rounded-full bg-black/40 p-1.5 text-white backdrop-blur transition hover:bg-black/60"
            :aria-pressed="isPicked(img.url)"
            :aria-label="isPicked(img.url) ? `Remove photo ${i + 1} from your favourites` : `Add photo ${i + 1} to your favourites`"
            @click.stop="togglePick(img.url)"
          >
            <svg viewBox="0 0 24 24" class="w-5 h-5 block" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :fill="isPicked(img.url) ? '#f43f5e' : 'none'" :class="isPicked(img.url) ? 'text-rose-500' : ''" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" /></svg>
          </button>
          <figcaption v-if="hasCaption(img)" class="canvas-gallery-caption mt-1.5 text-sm opacity-75">
            <template v-if="showCaptions && img.caption">{{ img.caption }}</template>
            <span v-if="showCameraDetails && img.camera" class="canvas-gallery-camera block text-xs opacity-80">{{ img.camera }}</span>
          </figcaption>
        </figure>
      </div>
    </template>

    <div
      v-else
      class="flex items-center justify-center h-40 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700"
    >
      <div class="text-center">
        <UIcon name="i-lucide-images" mode="svg" class="w-8 h-8 text-gray-300 mx-auto block mb-2" />
        <span class="text-sm text-gray-400">No images — edit this block to add photos</span>
      </div>
    </div>

    <NuxLightbox
      v-if="lightboxOpen"
      :images="lightboxImages"
      :initial-index="lightboxIndex"
      :download-url="downloadBase ? photoDownloadUrl : undefined"
      :is-picked="picking ? (n: number) => isPicked(parsedImages[n]?.url ?? '') : undefined"
      @toggle-pick="(n: number) => parsedImages[n] && togglePick(parsedImages[n]!.url)"
      @close="lightboxOpen = false"
    />
  </div>
</template>

<style scoped>
/* Justified rows: shorter rows on phones so two or three photos still share a row. */
.canvas-gallery-rows {
  --nf-gallery-row-h: calc(var(--nf-gallery-row-h-base) * 0.6);
}
@media (min-width: 640px) {
  .canvas-gallery-rows {
    --nf-gallery-row-h: var(--nf-gallery-row-h-base);
  }
}
/* Keeps the last row from stretching a lone photo across the full width. */
.canvas-gallery-rows::after {
  content: '';
  flex-grow: 999999;
}
</style>
