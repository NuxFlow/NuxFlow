<script setup lang="ts">
// Owns the preview iframe and its postMessage bridge entirely — the parent only
// needs to pass the generated CSS down as a prop, it never touches the iframe DOM
// node directly.
const props = defineProps<{
  css: string
  device: 'desktop' | 'tablet' | 'mobile'
}>()

const previewPath = ref('/')
const iframeEl = ref<HTMLIFrameElement | null>(null)

function sendPreviewCSS() {
  iframeEl.value?.contentWindow?.postMessage(
    { type: 'nuxflow:preview-css', css: props.css },
    window.location.origin,
  )
}

let previewTimer: ReturnType<typeof setTimeout> | null = null
watch(() => props.css, () => {
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(sendPreviewCSS, 300)
})
onBeforeUnmount(() => {
  if (previewTimer) clearTimeout(previewTimer)
})

function onIframeLoad() {
  // Re-inject CSS after every iframe navigation (plugin re-initialises on each load)
  setTimeout(sendPreviewCSS, 100)
}

function navigatePreview() {
  if (!iframeEl.value) return
  const path = previewPath.value.startsWith('/') ? previewPath.value : '/' + previewPath.value
  iframeEl.value.src = path
}

const iframeWrapperStyle = computed(() => {
  if (props.device === 'mobile') return { width: '375px', minWidth: '375px', maxWidth: '375px', height: '100%' }
  if (props.device === 'tablet') return { width: '768px', minWidth: '768px', maxWidth: '768px', height: '100%' }
  return { width: '100%', height: '100%' }
})
</script>

<template>
  <main class="flex-1 flex flex-col overflow-hidden">
    <!-- URL bar -->
    <div class="h-10 shrink-0 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex items-center gap-2 px-3">
      <UIcon name="i-lucide-globe" class="w-3.5 h-3.5 text-gray-400 shrink-0" />
      <input
        v-model="previewPath"
        type="text"
        placeholder="/"
        class="flex-1 bg-transparent text-sm text-gray-700 dark:text-gray-300 placeholder-gray-400 focus:outline-none font-mono"
        @keydown.enter="navigatePreview"
      >
      <button
        class="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
        @click="navigatePreview"
      >
        Go
      </button>
    </div>

    <!-- Preview area -->
    <div
      class="flex-1 overflow-auto flex"
      :class="device !== 'desktop'
        ? 'items-center justify-center p-6 bg-gray-200 dark:bg-gray-900'
        : 'bg-gray-100 dark:bg-gray-900/80'"
    >
      <div
        class="overflow-hidden transition-all duration-300 bg-white"
        :class="device !== 'desktop' ? 'rounded-2xl shadow-2xl' : 'w-full h-full'"
        :style="iframeWrapperStyle"
      >
        <ClientOnly>
          <iframe
            ref="iframeEl"
            src="/"
            class="w-full h-full border-0 block"
            title="Live preview"
            @load="onIframeLoad"
          />
          <template #fallback>
            <div class="w-full h-full flex items-center justify-center text-sm text-gray-400 bg-gray-50 dark:bg-gray-800">
              <div class="text-center space-y-2">
                <UIcon name="i-lucide-monitor" class="w-8 h-8 mx-auto opacity-30" />
                <p>Loading preview…</p>
              </div>
            </div>
          </template>
        </ClientOnly>
      </div>
    </div>
  </main>
</template>
