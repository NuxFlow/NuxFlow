<script setup lang="ts">
// Three layouts:
//  - grid      — every photo cropped to one shape (the only layout before `layout`
//                existed, so it stays the default for galleries saved without one)
//  - masonry   — whole photos in staggered CSS columns
//  - justified — whole photos in rows of equal height (each item's flex-grow is its
//                width/height ratio, so a row's items all end up the same height)
// Theme hooks: .canvas-gallery[data-layout], .canvas-gallery-item, .canvas-gallery-caption.
import { computed, inject, ref } from 'vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import type { SpacingValue } from '../types'
import NuxLightbox from './NuxLightbox.vue'
import NuxImage from './NuxImage.vue'
import { spacingToCss } from '../utils/spacing'
import { parseImageList, type ImageListItem } from '../utils/json'
import { aspectRatioValue, imageRatio, type GalleryLayout } from '../utils/gallery'
import { blockIdKey } from '../utils/block-context'

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
  rounded: false,
  lightbox: true,
  allowDownload: false,
})

const parsedImages = computed<ImageListItem[]>(() => parseImageList(props.images))

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
const downloadBase = computed(() => {
  if (!props.allowDownload || !blockId) return ''
  let pathname = ''
  try {
    pathname = useRequestURL().pathname
  }
  catch {
    pathname = typeof window !== 'undefined' ? window.location.pathname : ''
  }
  const path = pathname.replace(/^\/+|\/+$/g, '')
  return `/api/public/gallery-download?path=${encodeURIComponent(path)}&block=${encodeURIComponent(blockId)}`
})
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
    <template v-if="parsedImages.length">
      <!-- Masonry -->
      <div v-if="layout === 'masonry'" :class="masonryCols" :style="{ columnGap: gapPx }">
        <figure
          v-for="(img, i) in parsedImages"
          :key="i"
          class="canvas-gallery-item break-inside-avoid m-0"
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
          <figcaption v-if="showCaptions && img.caption" class="canvas-gallery-caption mt-1.5 text-sm opacity-75">
            {{ img.caption }}
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
          v-for="(img, i) in parsedImages"
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
          <figcaption
            v-if="showCaptions && img.caption"
            class="canvas-gallery-caption pointer-events-none absolute inset-x-0 bottom-0 px-3 py-2 text-sm text-white bg-gradient-to-t from-black/70 to-transparent"
          >
            {{ img.caption }}
          </figcaption>
        </figure>
      </div>

      <!-- Cropped grid -->
      <div v-else class="grid" :class="gridCols" :style="{ gap: gapPx }">
        <figure v-for="(img, i) in parsedImages" :key="i" class="canvas-gallery-item m-0">
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
          <figcaption v-if="showCaptions && img.caption" class="canvas-gallery-caption mt-1.5 text-sm opacity-75">
            {{ img.caption }}
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
      :images="parsedImages"
      :initial-index="lightboxIndex"
      :download-url="downloadBase ? photoDownloadUrl : undefined"
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
