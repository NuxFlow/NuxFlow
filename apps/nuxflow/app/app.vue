<script setup lang="ts">
import { imageTransformsEnabledKey } from '@nuxflow/canvas'

const { data: siteInfo } = useFetch<{ name?: string; faviconUrl?: string | null; imageTransformsEnabled?: boolean; hasPlugins?: boolean }>('/api/public/site', {
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

useHead({
  titleTemplate: (title) => {
    const name = siteInfo.value?.name
    return name
      ? (title ? `${name} | ${title}` : name)
      : (title ?? '')
  },
  link: computed(() => {
    const url = siteInfo.value?.faviconUrl
    if (!url) return []
    const type = url.endsWith('.svg') ? 'image/svg+xml'
      : url.endsWith('.ico') ? 'image/x-icon'
      : 'image/png'
    return [{ rel: 'icon', type, href: url }]
  }),
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <UNotifications />
</template>
