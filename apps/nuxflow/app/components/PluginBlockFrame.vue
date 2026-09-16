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

function postProps() {
  iframeRef.value?.contentWindow?.postMessage({ type: 'nuxflow:props', props: { ...attrs } }, '*')
}

function onMessage(event: MessageEvent) {
  if (event.source !== iframeRef.value?.contentWindow) return
  if (event.data?.type === 'nuxflow:resize' && typeof event.data.height === 'number') {
    height.value = event.data.height
    ready.value = true
  }
}

onMounted(() => {
  window.addEventListener('message', onMessage)
})

onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
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
      v-if="!ready"
      class="animate-pulse bg-gray-100 dark:bg-gray-800 rounded-lg h-16"
    />
    <iframe
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
