<script setup lang="ts">
import { imageTransformsEnabledKey } from '@nuxflow/canvas'
import type { PublicSiteSeo } from '~/utils/seo'

const { data: siteInfo } = useFetch<{
  name?: string
  locale?: string | null
  faviconUrl?: string | null
  imageTransformsEnabled?: boolean
  hasPlugins?: boolean
  seo?: PublicSiteSeo
}>('/api/public/site', {
  // Explicit key so dynamic-plugins.client.ts can read this same response back out of
  // the Nuxt payload cache (via useNuxtData) instead of issuing its own separate fetch
  // just to check `hasPlugins` — see that plugin for why this works despite plugins
  // running before this component's own <script setup>.
  key: 'nuxflow-public-site',
  headers: useRequestHeaders(['host']),
})

// Provided once at the app root and inject()ed by every NuxImage.vue instance — see
// image-transforms.ts's own doc comment for why this can't be each image's own fetch.
provide(imageTransformsEnabledKey, computed(() => siteInfo.value?.imageTransformsEnabled ?? false))

const route = useRoute()
const isAdminRoute = computed(() => route.path === '/admin' || route.path.startsWith('/admin/'))
const seo = computed(() => siteInfo.value?.seo)

useHead({
  // "Page title | Site name" — the page's own topic first, the brand last, as search
  // results truncate from the end. A page whose title already is the site name (or a
  // page that opts out with `titleTemplate: null`, like the homepage) isn't doubled up.
  titleTemplate: (title) => {
    const name = siteInfo.value?.name
    if (!title) return name ?? ''
    if (!name || title === name || title.endsWith(` | ${name}`)) return title
    return `${title} | ${name}`
  },
  htmlAttrs: {
    lang: computed(() => siteInfo.value?.locale || 'en'),
  },
  link: computed(() => {
    const url = siteInfo.value?.faviconUrl
    if (!url) return []
    const type = url.endsWith('.svg') ? 'image/svg+xml'
      : url.endsWith('.ico') ? 'image/x-icon'
      : 'image/png'
    return [{ rel: 'icon', type, href: url }]
  }),
  // Search engine ownership verification (Admin → SEO → Social & verification).
  meta: computed(() => {
    const v = seo.value?.verification
    if (!v || isAdminRoute.value) return []
    return [
      v.google && { name: 'google-site-verification', content: v.google },
      v.bing && { name: 'msvalidate.01', content: v.bing },
      v.yandex && { name: 'yandex-verification', content: v.yandex },
      v.pinterest && { name: 'p:domain_verify', content: v.pinterest },
    ].filter((m): m is { name: string; content: string } => Boolean(m))
  }),
})

// Site-wide defaults every public page inherits unless it sets its own (pages register
// their meta after this component, so theirs win).
useSeoMeta({
  description: computed(() => (isAdminRoute.value ? undefined : seo.value?.description || undefined)),
  ogSiteName: computed(() => siteInfo.value?.name || undefined),
  ogImage: computed(() => (isAdminRoute.value ? undefined : seo.value?.ogImage || undefined)),
  twitterSite: computed(() => (seo.value?.twitterHandle ? `@${seo.value.twitterHandle}` : undefined)),
  robots: computed(() => (isAdminRoute.value || seo.value?.noindex ? 'noindex,nofollow' : undefined)),
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <UNotifications />
</template>
