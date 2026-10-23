/**
 * Provides @nuxflow/canvas's CanvasHost (packages/canvas/src/host.ts) — the one place the
 * package's blocks and editor reach this app's API and components. Universal: the Posts
 * and Calendar blocks inject it during SSR too.
 */

import { defineAsyncComponent } from 'vue'
import { canvasHostKey, type CanvasContent, type CanvasEventItem, type CanvasHost, type CanvasPostItem } from '@nuxflow/canvas'

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
    async listPosts(query) {
      const data = await call(() => $fetch<{ posts?: CanvasPostItem[] }>('/api/public/posts', { query }), 'Could not load posts')
      return data.posts ?? []
    },
    async listEvents(limit) {
      const data = await call(() => $fetch<{ events?: CanvasEventItem[] }>('/api/public/events', { query: { limit } }), 'Could not load events')
      return data.events ?? []
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
