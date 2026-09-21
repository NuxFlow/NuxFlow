import type { InjectionKey, Ref } from 'vue'

/**
 * Whether the current site has Cloudflare Image Transformations enabled (an explicit,
 * default-off operator opt-in — see server/api/public/site.get.ts's
 * `imageTransformsEnabled` field). Provided once, at the app root (app.vue) from the
 * site-wide config fetch every page already makes, and inject()ed by every NuxImage.vue
 * instance — a page can render dozens of images, so this deliberately avoids giving each
 * one its own async settings fetch (see NuxImage.vue's own comment for why that would
 * defeat the purpose for the SSR'd, above-the-fold image that matters most for LCP).
 */
export const imageTransformsEnabledKey: InjectionKey<Ref<boolean>> = Symbol('nuxflow:image-transforms-enabled')
