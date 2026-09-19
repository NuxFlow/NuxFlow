<script setup lang="ts">
// Generic renderer for every dynamic-plugin Canvas block — registered once per
// declared block id (see app/plugins/dynamic-plugins.client.ts), parameterised by
// which plugin/block it renders. The plugin's own code never runs here or anywhere
// else in the main app; it only ever runs inside the sandboxed iframe this component
// embeds. sandbox="allow-scripts" WITHOUT allow-same-origin gives that iframe an
// opaque origin — no cookies, no localStorage, no reaching this page's DOM except
// through the narrow postMessage protocol below (props in, rendered height out).
const props = defineProps<{
  pluginId: string
  blockType: string // full block id, e.g. "my-plugin/example"
}>()

const attrs = useAttrs()

// blockType is "{pluginId}/{blockName}" — the route only needs the blockName part,
// mirroring _nuxflow/ext/[pluginId]/[...path].ts's own pluginId/rest split.
const blockName = computed(() => props.blockType.slice(props.pluginId.length + 1))
const src = computed(() => `/_nuxflow/plugin-frame/${encodeURIComponent(props.pluginId)}/${blockName.value}`)

const iframeRef = ref<HTMLIFrameElement | null>(null)
const height = ref<number | null>(null)
const ready = ref(false)
const failed = ref(false)
// Bumped on retry and used as the iframe's :key, so Vue tears down and recreates the
// element (a fresh iframe, fresh @load) rather than trying to reuse one that never
// finished loading.
const retryAttempt = ref(0)

// A broken/removed plugin, or one whose client bundle throws before ever posting a
// resize message, previously left the loading skeleton spinning forever with no
// operator-visible signal. 8s comfortably covers a real (if slow) load — this frame's
// content is a small, pre-bundled Vue app fetched from same-origin KV, not a
// heavyweight page — while still failing fast enough to tell a real break apart from
// "still loading."
const BLOCK_LOAD_TIMEOUT_MS = 8_000
let timeoutId: ReturnType<typeof setTimeout> | undefined

function armTimeout() {
  clearTimeout(timeoutId)
  timeoutId = setTimeout(() => {
    if (!ready.value) failed.value = true
  }, BLOCK_LOAD_TIMEOUT_MS)
}

function postProps() {
  iframeRef.value?.contentWindow?.postMessage({ type: 'nuxflow:props', props: { ...attrs } }, '*')
}

function onMessage(event: MessageEvent) {
  if (event.source !== iframeRef.value?.contentWindow) return
  if (event.data?.type === 'nuxflow:resize' && typeof event.data.height === 'number') {
    height.value = event.data.height
    ready.value = true
    // A late resize (arriving just after the timeout fired) still counts as success —
    // the iframe stays mounted (v-show, not v-if) specifically so this can happen.
    failed.value = false
    clearTimeout(timeoutId)
  }
}

function retry() {
  failed.value = false
  ready.value = false
  height.value = null
  retryAttempt.value++
  armTimeout()
}

onMounted(() => {
  window.addEventListener('message', onMessage)
  armTimeout()
})

onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
  clearTimeout(timeoutId)
})

// Attrs can change per re-render (e.g. editing this block's props in the Canvas
// settings panel) — relay every change into the iframe. Deep because field values
// like `padding` or `images` are objects/arrays. useAttrs()'s return value is
// already reactive, so watch it directly instead of spreading into a fresh
// object (and a fresh allocation) on every trigger.
watch(attrs, postProps, { deep: true })
</script>

<template>
  <div class="nuxflow-plugin-block relative">
    <div
      v-if="failed"
      class="rounded-lg border border-dashed border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-4 text-center text-sm text-red-600 dark:text-red-400"
    >
      <p>This block ({{ blockType }}) failed to load.</p>
      <button type="button" class="mt-2 font-medium underline" @click="retry">
        Retry
      </button>
    </div>
    <div
      v-else-if="!ready"
      class="animate-pulse bg-gray-100 dark:bg-gray-800 rounded-lg h-16"
    />
    <iframe
      v-show="!failed"
      :key="retryAttempt"
      ref="iframeRef"
      :src="src"
      sandbox="allow-scripts"
      :title="`${blockType} plugin block`"
      :style="{
        display: 'block',
        border: 'none',
        width: '100%',
        height: height ? `${height}px` : '0',
      }"
      @load="postProps"
    />
  </div>
</template>
