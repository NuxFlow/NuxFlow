<script setup lang="ts">
/**
 * Renders a received email's HTML safely. The HTML comes from an arbitrary outside sender,
 * so it only ever goes into a sandboxed iframe's srcdoc:
 *  - `sandbox` without allow-scripts/allow-same-origin: no script, an opaque origin (no
 *    access to the admin's cookies or DOM), no form submission.
 *  - a CSP <meta> blocks every remote load by default — tracking pixels would otherwise
 *    tell the sender when and where the message was opened. "Load remote images" relaxes
 *    img-src only.
 *  - links open in a new tab (allow-popups + <base target>), escaping the sandbox so the
 *    destination page works normally.
 * Plain-text messages render as text, never as HTML.
 */
const props = defineProps<{
  html: string | null
  text: string | null
}>()

const loadRemote = ref(false)
const hasRemoteImages = computed(() => !!props.html && /<img[^>]+src=["']?https?:/i.test(props.html))

const srcdoc = computed(() => {
  if (!props.html) return ''
  // The sandbox still permits the frame to navigate itself — a sender's
  // <meta http-equiv="refresh"> could swap in their own page inside the admin UI.
  const html = props.html.replace(/<meta\s[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi, '')
  const imgSrc = loadRemote.value ? 'data: https: http:' : 'data:'
  const csp = `default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'; font-src data:`
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>body{margin:0;padding:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.5;color:#111827;background:#fff;word-wrap:break-word}img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`
})
</script>

<template>
  <div>
    <template v-if="html">
      <div v-if="hasRemoteImages && !loadRemote" class="flex items-center justify-between gap-3 mb-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800 text-xs text-gray-500">
        <span>Remote images are blocked to protect your privacy.</span>
        <UButton size="xs" variant="ghost" @click="loadRemote = true">Load images</UButton>
      </div>
      <iframe
        :srcdoc="srcdoc"
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        referrerpolicy="no-referrer"
        title="Email message"
        class="w-full h-[28rem] rounded-lg border border-gray-200 dark:border-gray-700 bg-white resize-y"
      />
    </template>
    <pre v-else class="whitespace-pre-wrap break-words font-sans text-sm text-gray-700 dark:text-gray-300">{{ text || '(empty message)' }}</pre>
  </div>
</template>
