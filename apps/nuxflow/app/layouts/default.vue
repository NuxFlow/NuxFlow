<script setup lang="ts">
const route = useRoute()

// Deduped with PublicSiteHeader's identical fetch — no extra request.
const { data: site } = await useFetch('/api/public/site', {
  headers: useRequestHeaders(['host']),
})

const canonicalBase = computed(() =>
  (site.value as { canonicalBase?: string } | null)?.canonicalBase ?? '',
)

useHead({
  link: computed(() => [
    { rel: 'alternate', type: 'application/rss+xml', title: 'RSS Feed', href: '/feed.xml' },
    ...(canonicalBase.value
      ? [{ rel: 'canonical', href: `${canonicalBase.value}${route.path}` }]
      : []),
  ]),
})
</script>

<template>
  <div class="mesh-bg min-h-screen">
    <PublicSiteHeader />
    <main>
      <slot />
    </main>
    <ClientOnly><PublicCookieConsent /></ClientOnly>
    <ClientOnly><PublicPushNotificationBanner /></ClientOnly>
  </div>
</template>
