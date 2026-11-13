<script setup lang="ts">
// The Canvas editor draws the page inside this same-origin frame so it looks the way
// it does live. The admin never loads a site's theme CSS (it restyles the whole page,
// admin included), and Tailwind's responsive classes need the page's own width. Blocks
// are still ordinary components of this Vue app, teleported into the frame's document,
// so the editor's state, injections and event handlers work exactly as before.
//
// Into the frame go: the admin's own stylesheets (Tailwind and the blocks' styles,
// mirrored as more load), then the site's styling from CanvasHost.siteStyles() (theme
// CSS, appearance settings, stylesheet links from custom head HTML) — the same order a
// public page's <head> has. Styles are always added as DOM nodes, never as HTML: no
// script ever reaches this frame, because it shares the admin's origin.
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { useCanvasHost, type CanvasSiteStyles } from '../host'

export type FrameViewport = 'fit' | 'desktop' | 'tablet' | 'phone'

const props = defineProps<{ viewport: FrameViewport }>()
const emit = defineEmits<{ keydown: [event: KeyboardEvent]; backgroundClick: [] }>()

const host = useCanvasHost()

const VIEWPORT_WIDTHS: Record<FrameViewport, number | null> = { fit: null, desktop: 1280, tablet: 768, phone: 390 }

const containerRef = ref<HTMLElement | null>(null)
const iframeRef = ref<HTMLIFrameElement | null>(null)
/** The <main> inside the frame that the blocks are teleported into. */
const root = shallowRef<HTMLElement | null>(null)

// ── Size: the frame is as tall as its box; a fixed viewport is scaled down to fit ──

const box = ref({ width: 0, height: 0 })
let resizeObserver: ResizeObserver | null = null
const phoneScreen = ref(false)
let phoneQuery: MediaQueryList | null = null
const onPhoneQuery = () => { phoneScreen.value = !!phoneQuery?.matches }

const frameStyle = computed(() => {
  const target = VIEWPORT_WIDTHS[props.viewport]
  const { width, height } = box.value
  // Pixel heights throughout: a percentage of the flex-sized box doesn't resolve, and the
  // frame would fall back to the browser's default 150px.
  if (!width) return { width: '100%', height: '100%' }
  // On a phone (where the width buttons are hidden, below Tailwind's sm) the page always
  // uses the editor's own width — a desktop page scaled to a phone is too small to tap.
  if (!target || phoneScreen.value) return { width: '100%', height: `${height}px` }
  const scale = Math.min(1, width / target)
  return {
    width: `${target}px`,
    height: `${height / scale}px`,
    transform: scale < 1 ? `scale(${scale})` : undefined,
    transformOrigin: 'top left',
    // Centred when it fits; scaled frames already fill the width.
    marginLeft: scale < 1 ? '0' : `${(width - target) / 2}px`,
  }
})

// ── Building the frame's document ───────────────────────────────────────────

const SRCDOC = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>'

/** Parent <link>/<style> → its copy in the frame, so removals can follow. */
const mirrored = new Map<Node, Node>()
let siteMarker: Node | null = null
const cleanups: Array<() => void> = []

function isStyleNode(node: Node): node is HTMLLinkElement | HTMLStyleElement {
  if (node.nodeName === 'STYLE') return true
  return node.nodeName === 'LINK' && /(?:^|\s)stylesheet(?:\s|$)/i.test((node as HTMLLinkElement).rel)
}

function mirror(doc: Document, node: Node) {
  if (!isStyleNode(node) || mirrored.has(node)) return
  const copy = doc.importNode(node, true)
  doc.head.insertBefore(copy, siteMarker)
  mirrored.set(node, copy)
}

function addSiteStyles(doc: Document, styles: CanvasSiteStyles) {
  for (const href of styles.links) {
    const link = doc.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.dataset.nuxflowSite = ''
    doc.head.appendChild(link)
  }
  for (const css of styles.styles) {
    const style = doc.createElement('style')
    style.dataset.nuxflowSite = ''
    style.textContent = css
    doc.head.appendChild(style)
  }
}

function applyColourMode(doc: Document, darkMode: CanvasSiteStyles['darkMode']) {
  // 'auto' follows the same colour-mode preference the public site would use, which is
  // the one this browser has for the admin (same cookie, same origin).
  const dark = darkMode === 'dark' || (darkMode === 'auto' && document.documentElement.classList.contains('dark'))
  doc.documentElement.classList.toggle('dark', dark)
}

function buildPage(doc: Document) {
  // The public layout's wrappers (layouts/default.vue), so theme selectors such as
  // `main h1` or `.mesh-bg` match here too.
  const page = doc.createElement('div')
  page.className = 'mesh-bg min-h-screen flex flex-col'
  page.dataset.frameBackground = ''
  const row = doc.createElement('div')
  row.className = 'flex flex-1'
  row.dataset.frameBackground = ''
  const main = doc.createElement('main')
  main.className = 'flex-1 min-w-0'
  main.dataset.frameBackground = ''
  row.appendChild(main)
  page.appendChild(row)
  doc.body.appendChild(page)
  return main
}

function on<K extends keyof DocumentEventMap>(target: Document, type: K, fn: (e: DocumentEventMap[K]) => void) {
  target.addEventListener(type, fn as EventListener)
  cleanups.push(() => target.removeEventListener(type, fn as EventListener))
}

// SortableJS auto-scrolls from dragover events on the *main* document, which a drag
// inside the frame never reaches — so the frame scrolls itself near its edges.
function autoScroll(win: Window, e: DragEvent) {
  const edge = 60
  const h = win.innerHeight
  if (e.clientY < edge) win.scrollBy(0, -Math.ceil((edge - e.clientY) / 3))
  else if (e.clientY > h - edge) win.scrollBy(0, Math.ceil((e.clientY - (h - edge)) / 3))
}

let siteStyles: CanvasSiteStyles | null = null

async function onLoad() {
  const frame = iframeRef.value
  const doc = frame?.contentDocument
  const win = frame?.contentWindow
  if (!frame || !doc || !win || !doc.body) return
  // A new frame first holds a temporary about:blank document, which the srcdoc one
  // replaces — anything built into it would be thrown away.
  if (win.location.href !== 'about:srcdoc') return
  // The same document again (the check in onMounted and the load event can both fire).
  if (root.value?.ownerDocument === doc) return

  doc.documentElement.lang = document.documentElement.lang
  siteMarker = doc.createComment('site styles')
  doc.head.appendChild(siteMarker)

  // The admin's stylesheets, and any added later (a block's CSS loads with its chunk).
  for (const node of Array.from(document.head.childNodes)) mirror(doc, node)
  const headObserver = new MutationObserver((records) => {
    for (const r of records) {
      r.addedNodes.forEach(n => mirror(doc, n))
      r.removedNodes.forEach((n) => {
        mirrored.get(n)?.parentNode?.removeChild(mirrored.get(n)!)
        mirrored.delete(n)
      })
    }
  })
  headObserver.observe(document.head, { childList: true })
  cleanups.push(() => headObserver.disconnect())

  // Follow the admin's colour mode for a site set to 'auto'.
  const modeObserver = new MutationObserver(() => applyColourMode(doc, siteStyles?.darkMode ?? 'auto'))
  modeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  cleanups.push(() => modeObserver.disconnect())
  applyColourMode(doc, 'auto')

  on(doc, 'keydown', e => emit('keydown', e))
  on(doc, 'click', (e) => {
    const target = e.target as HTMLElement | null
    if (!target || target === doc.body || target === doc.documentElement || target.dataset?.frameBackground !== undefined) {
      emit('backgroundClick')
    }
  })
  on(doc, 'dragover', e => autoScroll(win, e))

  root.value = buildPage(doc)

  try {
    siteStyles = (await host.siteStyles?.()) ?? null
  }
  catch {
    siteStyles = null // the page still shows, just without the site's theme
  }
  if (siteStyles && iframeRef.value === frame) {
    addSiteStyles(doc, siteStyles)
    applyColourMode(doc, siteStyles.darkMode)
  }
}

onMounted(() => {
  phoneQuery = window.matchMedia('(max-width: 639px)')
  onPhoneQuery()
  phoneQuery.addEventListener('change', onPhoneQuery)
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(([entry]) => {
      if (entry) box.value = { width: entry.contentRect.width, height: entry.contentRect.height }
    })
    resizeObserver.observe(containerRef.value)
  }
  // A srcdoc frame may already have loaded before the listener was attached.
  if (iframeRef.value?.contentDocument?.readyState === 'complete' && iframeRef.value.contentDocument.body) {
    void onLoad()
  }
})

onBeforeUnmount(() => {
  phoneQuery?.removeEventListener('change', onPhoneQuery)
  resizeObserver?.disconnect()
  for (const fn of cleanups.splice(0)) fn()
  mirrored.clear()
})

</script>

<template>
  <div ref="containerRef" class="relative overflow-hidden bg-gray-100 dark:bg-gray-950">
    <iframe
      ref="iframeRef"
      :srcdoc="SRCDOC"
      title="Page preview — click a block to edit it"
      class="block border-0 bg-white"
      :class="viewport === 'fit' ? '' : 'shadow-sm'"
      :style="frameStyle"
      data-testid="canvas-frame"
      @load="onLoad"
    />
    <Teleport v-if="root" :to="root">
      <slot />
    </Teleport>
  </div>
</template>
