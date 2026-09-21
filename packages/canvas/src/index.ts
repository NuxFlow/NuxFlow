export * from './types'
export * from './blocks/definitions'
export { BUILTIN_BLOCK_COMPONENTS } from './blocks/components'
export { spacingToCss } from './utils/spacing'
export { safeJsonParse, parseImageList, normalizeImageValue } from './utils/json'
export type { ImageListItem, ImageFieldValue } from './utils/json'
export {
  CONSENT_COOKIE_NAME,
  CONSENT_EVENT,
  GDPR_COUNTRIES,
  isGdprCountry,
  parseConsentFromHeader,
  readConsentCookie,
  writeConsentCookie,
  hasOptionalConsent,
} from './utils/consent'
export type { ConsentState } from './utils/consent'
export { useCanvas } from './editor/useCanvas'
export { useAiImprove, AI_IMPROVE_ACTIONS } from './editor/useAiImprove'
export type { AiInstruction, AiImproveAction } from './editor/useAiImprove'
export { imageTransformsEnabledKey } from './utils/image-transforms'

// Vue components
//
// Deliberately NOT re-exporting the individual built-in block components
// (CanvasBlockHero, CanvasBlockCarousel, etc.) here even though this package's
// own blocks/components.ts imports them: those are only ever meant to be
// reached through the lazy `BUILTIN_BLOCK_COMPONENTS` map (defineAsyncComponent
// wrappers — see the comment there), so each one code-splits into its own
// chunk fetched only when a page actually renders that block. A static
// `export { default as X } from './blocks/X.vue'` here would put every block
// back on this barrel's own static export graph — reachable via the plain
// `import { ... } from '@nuxflow/canvas'` used all over the app — and once a
// module is reachable through both a static and a dynamic path, bundlers
// commonly fold it into whichever chunk the static path already belongs to
// instead of giving it its own lazily-fetched chunk, silently undoing the
// code-splitting the async wrapper was there to provide. Nothing outside this
// package needs these by name (dynamic-plugin blocks and the app-owned blocks
// resolve through the host app's own registry instead — see components.ts's
// own doc comment) — if a real need for one shows up, export that single
// component explicitly rather than reinstating the full list.
export { default as CanvasContentEditor } from './editor/CanvasContentEditor.vue'
export { default as NuxImage } from './blocks/NuxImage.vue'
