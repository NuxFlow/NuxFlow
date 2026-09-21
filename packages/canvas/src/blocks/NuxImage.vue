<script setup lang="ts">
// Shared image-rendering component for every Canvas block and public page that renders a
// media URL. Two jobs: (1) always emit explicit width/height so the browser reserves
// layout space before the image loads (fixes CLS at CanvasBlockImage.vue, the one place
// left with no CSS aspect-ratio wrapper already reserving that space); (2) when the
// current site has opted into Cloudflare Image Transformations (see
// server/api/public/site.get.ts's `imageTransformsEnabled`), resize/re-encode through
// Cloudflare's `/cdn-cgi/image/...` endpoint instead of serving the original file.
//
// Deliberately NOT built on @nuxt/image — see nuxt.config.ts's `image` comment for why
// its provider system can't resolve a per-request origin, which this multi-tenant,
// multi-custom-domain app needs. Cloudflare's transform URL format is simple enough to
// build directly: `${origin}/cdn-cgi/image/<params>/<source>`, where `origin` is
// whatever domain is actually serving *this* request (useRequestURL(), isomorphic).
import { computed, inject, ref } from 'vue'
import { imageTransformsEnabledKey } from '../utils/image-transforms'

// Ambient declaration only — mirrors CanvasBlockFooter.vue's identical pattern. This
// package isn't itself a Nuxt app; useRequestURL() is a real Nuxt auto-import supplied
// by whichever host app (apps/nuxflow) actually renders this component.
declare const useRequestURL: () => URL

const props = withDefaults(defineProps<{
  src?: string
  alt?: string
  width?: number
  height?: number
  /** Cloudflare 'fit' param — only applied when both width and height are set. */
  fit?: 'cover' | 'contain' | 'scale-down' | 'crop' | 'pad'
  quality?: number
  loading?: 'lazy' | 'eager'
}>(), {
  src: '',
  alt: '',
  width: undefined,
  height: undefined,
  fit: undefined,
  quality: 85,
  loading: 'lazy',
})

const enabled = inject(imageTransformsEnabledKey, ref(false))

// SVGs aren't resized by Cloudflare Image Transformations (vector, no benefit) and a
// relative/empty src has nothing to build a transform URL against.
const isTransformable = computed(() =>
  Boolean(props.src) && !props.src.toLowerCase().endsWith('.svg'),
)

const transformedSrc = computed(() => {
  if (!enabled.value || !isTransformable.value) return props.src

  const params: string[] = ['format=auto', `quality=${props.quality}`]
  if (props.width) params.push(`width=${props.width}`)
  if (props.height) params.push(`height=${props.height}`)
  if (props.width && props.height && props.fit) params.push(`fit=${props.fit}`)

  let origin = ''
  try {
    origin = useRequestURL().origin
  }
  catch {
    // useRequestURL() throws outside a live Nuxt request context (e.g. this package's
    // own isolated unit tests) — fall back to the untransformed URL rather than crash.
    return props.src
  }

  return `${origin}/cdn-cgi/image/${params.join(',')}/${props.src}`
})
</script>

<template>
  <img
    :src="transformedSrc"
    :alt="alt"
    :width="width"
    :height="height"
    :loading="loading"
    decoding="async"
  >
</template>
