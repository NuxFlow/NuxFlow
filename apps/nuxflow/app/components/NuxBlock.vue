<script setup lang="ts">
import { canvasHostKey, isCanvasContent } from '@nuxflow/canvas'
import { isStreamPlayerUrl, streamEmbedUrl } from '@nuxflow/canvas/video'
import { renderTipTap } from '#shared/lib/render-tiptap'

// Stored content is either a Canvas document or TipTap JSON.
const props = defineProps<{ content: unknown }>()

const canvas = computed(() => isCanvasContent(props.content) ? props.content : null)
const html = computed(() => canvas.value ? '' : renderTipTap(props.content))

// A Cloudflare Stream video in a post that may need a signed link renders as a placeholder
// (render-tiptap.ts); swap each for its player once the page is in the browser — the same
// lookup the Canvas Video block makes (CanvasHost.videoPlaybackUrl).
const host = inject(canvasHostKey, null)
const prose = ref<HTMLElement | null>(null)

async function fillVideos() {
  await nextTick()
  const root = prose.value
  if (!root || !host?.videoPlaybackUrl) return
  const path = window.location.pathname.replace(/^\/+|\/+$/g, '')
  for (const el of root.querySelectorAll<HTMLElement>('[data-nuxflow-video]')) {
    const streamId = el.dataset.nuxflowVideo!
    delete el.dataset.nuxflowVideo
    let src: string | null = null
    try {
      const signed = await host.videoPlaybackUrl({ streamId, blockId: '', path })
      src = signed === null ? streamEmbedUrl(streamId) : isStreamPlayerUrl(signed) ? signed : null
    } catch {
      src = null
    }
    if (!src) {
      el.textContent = "This video can't be played right now."
      el.style.cssText += ';display:flex;align-items:center;justify-content:center;color:#9ca3af;height:auto;padding:4rem 1rem'
      continue
    }
    const iframe = document.createElement('iframe')
    iframe.src = src
    iframe.title = 'Video'
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'
    iframe.allowFullscreen = true
    iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0'
    el.replaceChildren(iframe)
  }
}

onMounted(fillVideos)
watch(html, fillVideos)
</script>

<template>
  <NuxBlocks v-if="canvas" :blocks="canvas.blocks" />
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div v-else ref="prose" class="nux-content" v-html="html" />
</template>
