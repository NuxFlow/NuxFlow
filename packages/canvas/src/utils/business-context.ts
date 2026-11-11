import type { InjectionKey, Ref } from 'vue'
import type { BusinessInfo } from './business-hours'

/**
 * The site's business details (Settings → Business) with the time zone and language its
 * hours are read in. Provided once at the app root (app.vue) from `GET /api/public/site`,
 * like imageTransformsEnabledKey, so the Opening Hours block has them during SSR and
 * hydration without a fetch of its own.
 */
export interface BusinessContext {
  info: BusinessInfo | null
  siteName: string
  timeZone: string
  locale: string
}

export const businessContextKey: InjectionKey<Ref<BusinessContext>> = Symbol('nuxflow:business')
