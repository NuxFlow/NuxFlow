<script setup lang="ts">
const route = useRoute()

// Deduped with PublicSiteHeader's identical fetch — no extra request.
const { data: site } = await useFetch('/api/public/site', {
  headers: useRequestHeaders(['host']),
})

const canonicalBase = computed(() =>
  (site.value as { canonicalBase?: string } | null)?.canonicalBase ?? '',
)

const siteName = computed(() => (site.value as { name?: string } | null)?.name ?? '')
const logoUrl = computed(() => (site.value as { logoUrl?: string } | null)?.logoUrl ?? '')

useHead({
  link: computed(() => [
    { rel: 'alternate', type: 'application/rss+xml', title: 'RSS Feed', href: '/feed.xml' },
    { rel: 'alternate', type: 'application/atom+xml', title: 'Atom Feed', href: '/atom.xml' },
    ...(canonicalBase.value
      ? [{ rel: 'canonical', href: `${canonicalBase.value}${route.path}` }]
      : []),
  ]),
  script: computed(() => {
    if (!siteName.value || !canonicalBase.value) return []
    return [
      {
        type: 'application/ld+json',
        innerHTML: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: siteName.value,
          url: canonicalBase.value,
          ...(logoUrl.value ? { logo: logoUrl.value } : {}),
        }),
      },
      {
        type: 'application/ld+json',
        innerHTML: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: siteName.value,
          url: canonicalBase.value,
          potentialAction: {
            '@type': 'SearchAction',
            target: {
              '@type': 'EntryPoint',
              urlTemplate: `${canonicalBase.value}/search?q={search_term_string}`,
            },
            'query-input': 'required name=search_term_string',
          },
        }),
      },
    ]
  }),
})
</script>

<template>
  <div class="mesh-bg min-h-screen flex flex-col">
    <PublicSiteHeader />
    <div class="flex flex-1">
      <main class="flex-1 min-w-0">
        <slot />
      </main>
      <PublicSiteSidebar />
    </div>
    <PublicSiteFooter />
    <ClientOnly><PublicCookieConsent /></ClientOnly>
    <ClientOnly><PublicPushNotificationBanner /></ClientOnly>
  </div>
</template>
