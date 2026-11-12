/**
 * Provides @nuxflow/canvas's CanvasHost (packages/canvas/src/host.ts) — the one place the
 * package's blocks and editor reach this app's API and components. Universal: the Posts
 * and Calendar blocks inject it during SSR too.
 */

import { defineAsyncComponent } from 'vue'
import { canvasHostKey, type CanvasAvailability, type CanvasClassPass, type CanvasContent, type CanvasEventList, type CanvasHost, type CanvasGalleryPicks, type CanvasGoogleReviews, type CanvasPostFilter, type CanvasPostItem, type CanvasProductCard } from '@nuxflow/canvas'

// Every method rejects with an Error carrying the server's own message, which the package
// shows to the user as-is.
async function call<T>(request: () => Promise<T>, fallback: string): Promise<T> {
  try {
    return await request()
  } catch (e: unknown) {
    throw new Error(getErrorMessage(e, fallback), { cause: e })
  }
}

export default defineNuxtPlugin((nuxtApp) => {
  const host: CanvasHost = {
    async listPosts({ filters, ...query }) {
      const data = await call(() => $fetch<{ posts?: CanvasPostItem[] }>('/api/public/posts', { query: { ...query, ...filters } }), 'Could not load posts')
      return data.posts ?? []
    },
    async googleReviews() {
      const data = await call(() => $fetch<{ reviews: CanvasGoogleReviews | null }>('/_nuxflow/google-reviews'), 'Could not load the reviews')
      return data.reviews
    },
    async availability(path) {
      return call(() => $fetch<CanvasAvailability>('/_nuxflow/availability', { query: { path } }), 'Could not load the calendar')
    },
    async loadGalleryPicks(query) {
      const data = await call(() => $fetch<{ picks: CanvasGalleryPicks | null }>('/_nuxflow/gallery-picks', { query }), 'Could not load your picks')
      return data.picks
    },
    async saveGalleryPicks(input) {
      return call(() => $fetch<{ count: number; submitted: boolean }>('/_nuxflow/gallery-picks', { method: 'POST', body: { action: 'save', ...input } }), input.submit ? 'Could not send your picks' : 'Could not save your picks')
    },
    async listPostFilters(type) {
      const data = await call(() => $fetch<{ filters?: CanvasPostFilter[] }>('/api/public/posts', { query: { type, limit: 1 } }), 'Could not load filters')
      return data.filters ?? []
    },
    async listEvents({ limit, from, to, past, taxonomy }) {
      const data = await call(() => $fetch<Partial<CanvasEventList>>('/api/public/events', { query: { limit, from, to, past: past ? '1' : undefined, taxonomy } }), 'Could not load events')
      return { events: data.events ?? [], timeZone: data.timeZone ?? 'UTC', feedUrl: data.feedUrl }
    },
    async listProducts({ limit, collection, slugs }) {
      try {
        const data = await $fetch<{ products?: CanvasProductCard[] }>('/api/public/shop', { query: { limit, collection, slugs: slugs?.join(',') } })
        return data.products ?? []
      }
      catch (e: unknown) {
        // 404: the site's shop is off, which is nothing to sell rather than a failure.
        if ((e as { statusCode?: number } | null)?.statusCode === 404) return []
        throw new Error(getErrorMessage(e, 'Could not load products'), { cause: e })
      }
    },
    addToBasket(product) {
      if (!product.variantId) return
      nuxtApp.runWithContext(() => useCart().add({
        variantId: product.variantId!,
        quantity: 1,
        title: product.title,
        label: product.variantLabel ?? '',
        price: product.price,
        image: product.image,
        path: product.path,
      }))
    },
    async listClassPasses() {
      return call(() => $fetch<{ passes: CanvasClassPass[]; canBuy: boolean }>('/api/public/class-passes'), 'Could not load passes')
    },
    async improveText(text, instruction) {
      const data = await call(() => $fetch<{ alternatives?: string[] }>('/api/v1/ai/improve', { method: 'POST', body: { text, instruction } }), 'AI request failed')
      return data.alternatives ?? []
    },
    generatePage(request) {
      return call(() => $fetch<CanvasContent>('/api/v1/ai/generate-canvas', { method: 'POST', body: request }), 'Generation failed')
    },
    suggestFocalPoint(url) {
      return call(() => $fetch<{ focalX: number; focalY: number }>('/api/v1/ai/suggest-focal-point', { method: 'POST', body: { url } }), 'Could not suggest a focal point')
    },
    async videoPlaybackUrl({ streamId, blockId, path }) {
      const data = await call(() => $fetch<{ url: string | null }>('/api/public/video-playback', { query: { video: streamId, block: blockId || undefined, path } }), 'Could not load the video')
      return data.url
    },
    // Lazy, so visitors never download admin-only components.
    mediaPicker: defineAsyncComponent(() => import('~/components/editor/MediaPicker.vue')),
    voiceInput: defineAsyncComponent(() => import('~/components/ai/VoiceInput.vue')),
  }
  nuxtApp.vueApp.provide(canvasHostKey, host)
})
