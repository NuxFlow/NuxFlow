import { defineAsyncComponent, type Component } from 'vue'

/**
 * Single source of truth mapping every *built-in* block's `CanvasBlockDefinition.id`
 * (see `CANVAS_BLOCKS` in `./definitions.ts`) to its real Vue component. "Built-in"
 * means the component ships inside this package — it does NOT cover the handful of
 * app-owned built-ins that live in `apps/nuxflow` (ContactFormBlock, DynamicFormBlock,
 * MembershipsBlock) or genuine dynamic-plugin blocks. Both of those continue to resolve
 * exclusively through the host app's own registry (`useBlockRegistry.ts`, injected as
 * `'nuxflow:blockRegistry'`) — never through this map — which preserves the metadata
 * vs. rendering split CLAUDE.md documents: a dynamic plugin's block metadata
 * (`src/blocks.json`) is readable synchronously with no live component required, and
 * its actual component only has to exist once an instance of it is rendered.
 *
 * Previously this id -> component association was hand-duplicated in independent
 * places (this package's own `CanvasBlock.vue` editor renderer, and the host app's
 * `nuxflow-plugin-components.ts` SSR registration) that had to be kept in sync by
 * hand. Both now read from this single map — see `getBuiltinComponentIds()`/its
 * consumers if a future built-in needs excluding from one of those without a second
 * hand-maintained list.
 *
 * Every entry is wrapped in `defineAsyncComponent(() => import(...))` rather than a
 * static top-of-file import. Without this, every one of these ~19 block components
 * (hero, carousel, gallery, calendar, pricing, accordion, etc.) was pulled into the
 * same synchronous import graph as `nuxflow-plugin-components.ts` — a universal
 * (server+client) Nuxt plugin that runs on *every* route — so Vite/Rollup had no
 * reason to split any of them into their own chunk: every visitor's client bundle
 * shipped all built-in blocks regardless of which ones the page they landed on
 * actually uses. `defineAsyncComponent` is Vue-native and SSR-safe (Vue's SSR
 * renderer awaits an async component's loader before rendering it — no client-only
 * flash, no hydration mismatch for above-the-fold blocks), and it makes each
 * `import('./CanvasBlockXxx.vue')` call a genuine dynamic-import boundary Rollup can
 * split on, so a page only downloads the block components it actually renders.
 *
 * This only changes *how* each component is loaded, not what gets resolved: `resolve()`
 * (`useBlockRegistry.ts`) and `BUILTIN_BLOCK_COMPONENTS[id]` (`CanvasBlock.vue`) both
 * return the async component wrapper object itself synchronously (never a Promise),
 * so every existing `resolve(block.type)` truthiness check — deciding whether to
 * render normally vs. fall back to `ClientOnly` for a not-yet-loaded dynamic plugin
 * block (`NuxBlocks.vue`) — is unaffected; only the underlying `.vue` module's
 * fetch/instantiation is deferred until Vue actually mounts that block instance.
 */
// Unwraps the module's default export explicitly instead of leaving it to Vue. Vue only
// unwraps `.default` when the loaded value looks like an ES module namespace
// (`__esModule`, or `Symbol.toStringTag === 'Module'`); in the Workers server build it
// doesn't, so Vue treated the namespace object itself as the component and every block
// server-rendered as an empty `<!---->` (pages had no content until hydration, and
// crawlers saw none at all). Browsers were unaffected, which is why it went unnoticed.
export function lazyBlock(load: () => Promise<{ default: Component }>): Component {
  return defineAsyncComponent(() => load().then(m => m.default))
}

export const BUILTIN_BLOCK_COMPONENTS: Record<string, Component> = {
  'canvas-hero': lazyBlock(() => import('./CanvasBlockHero.vue')),
  'canvas-text': lazyBlock(() => import('./CanvasBlockText.vue')),
  'canvas-image': lazyBlock(() => import('./CanvasBlockImage.vue')),
  'canvas-columns': lazyBlock(() => import('./CanvasBlockColumns.vue')),
  'canvas-container': lazyBlock(() => import('./CanvasBlockContainer.vue')),
  'canvas-cta': lazyBlock(() => import('./CanvasBlockCta.vue')),
  'canvas-spacer': lazyBlock(() => import('./CanvasBlockSpacer.vue')),
  'canvas-video': lazyBlock(() => import('./CanvasBlockVideo.vue')),
  'canvas-testimonial': lazyBlock(() => import('./CanvasBlockTestimonial.vue')),
  'canvas-features': lazyBlock(() => import('./CanvasBlockFeatures.vue')),
  'canvas-button': lazyBlock(() => import('./CanvasBlockButton.vue')),
  'canvas-accordion': lazyBlock(() => import('./CanvasBlockAccordion.vue')),
  'canvas-pricing': lazyBlock(() => import('./CanvasBlockPricing.vue')),
  'canvas-calendar': lazyBlock(() => import('./CanvasBlockCalendar.vue')),
  'canvas-posts': lazyBlock(() => import('./CanvasBlockPosts.vue')),
  'canvas-gdpr': lazyBlock(() => import('./CanvasBlockGdpr.vue')),
  'canvas-footer': lazyBlock(() => import('./CanvasBlockFooter.vue')),
  'canvas-gallery': lazyBlock(() => import('./CanvasBlockGallery.vue')),
  'canvas-carousel': lazyBlock(() => import('./CanvasBlockCarousel.vue')),
  'html-block/html': lazyBlock(() => import('./HtmlBlock.vue')),
}
