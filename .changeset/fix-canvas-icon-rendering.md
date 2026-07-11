---
"@nuxflow/canvas": patch
---

fix: icon-class content fields (`i-lucide-*`) never actually rendered a glyph — hero badges, feature/footer icons, carousel/lightbox arrows, accordion chevrons, pricing checkmarks, and the block picker all showed as flat coloured boxes with nothing inside.

**Root cause:** these components rendered icons as raw `<span :class="iconClass">`, but nothing in this project's build tooling generates CSS for arbitrary `i-lucide-*` utility classes — @nuxt/ui's actual icon mechanism is the `<Icon>`/`<UIcon>` component, which resolves icons at runtime, not via a build-time CSS-class scan. Static template icons happened to render correctly elsewhere in the app only because they go through `<UIcon>`; every place in `packages/canvas` using the raw-span pattern was silently broken regardless of whether the icon name was static or content-driven.

**Fix:** replaced every raw icon span with `<UIcon mode="svg" :name="...">` (explicit `mode="svg"` — this project's default Nuxt Icon mode is CSS-class based, which has the same build-time-scan limitation) across `CanvasBlockHero`, `CanvasBlockFeatures`, `CanvasBlockFooter`, `CanvasBlockAccordion`, `CanvasBlockCarousel`, `CanvasBlockGallery`, `CanvasBlockPricing`, `NuxLightbox`, `BlockPicker`, `CanvasAdmin`, `AiGenerateModal`, `FieldRenderer`, and `SettingsPanel`. Added `@nuxt/ui` as a peer/dev dependency of `@nuxflow/canvas` so the import resolves correctly for this workspace package.
