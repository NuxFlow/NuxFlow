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
export const BUILTIN_BLOCK_COMPONENTS: Record<string, Component> = {
  'canvas-hero': defineAsyncComponent(() => import('./CanvasBlockHero.vue')),
  'canvas-text': defineAsyncComponent(() => import('./CanvasBlockText.vue')),
  'canvas-image': defineAsyncComponent(() => import('./CanvasBlockImage.vue')),
  'canvas-columns': defineAsyncComponent(() => import('./CanvasBlockColumns.vue')),
  'canvas-container': defineAsyncComponent(() => import('./CanvasBlockContainer.vue')),
  'canvas-cta': defineAsyncComponent(() => import('./CanvasBlockCta.vue')),
  'canvas-spacer': defineAsyncComponent(() => import('./CanvasBlockSpacer.vue')),
  'canvas-video': defineAsyncComponent(() => import('./CanvasBlockVideo.vue')),
  'canvas-testimonial': defineAsyncComponent(() => import('./CanvasBlockTestimonial.vue')),
  'canvas-features': defineAsyncComponent(() => import('./CanvasBlockFeatures.vue')),
  'canvas-button': defineAsyncComponent(() => import('./CanvasBlockButton.vue')),
  'canvas-accordion': defineAsyncComponent(() => import('./CanvasBlockAccordion.vue')),
  'canvas-pricing': defineAsyncComponent(() => import('./CanvasBlockPricing.vue')),
  'canvas-calendar': defineAsyncComponent(() => import('./CanvasBlockCalendar.vue')),
  'canvas-gdpr': defineAsyncComponent(() => import('./CanvasBlockGdpr.vue')),
  'canvas-footer': defineAsyncComponent(() => import('./CanvasBlockFooter.vue')),
  'canvas-gallery': defineAsyncComponent(() => import('./CanvasBlockGallery.vue')),
  'canvas-carousel': defineAsyncComponent(() => import('./CanvasBlockCarousel.vue')),
  'html-block/html': defineAsyncComponent(() => import('./HtmlBlock.vue')),
}
