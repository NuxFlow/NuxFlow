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

// ── Layout regions (structural theming) ──────────────────────────────────────
// A dynamic plugin can register a block (same registry as Canvas blocks — see
// useBlockRegistry.ts) and be designated via Admin → Themes → Layout regions
// to own the header/footer chrome, going beyond what theme CSS alone can
// restyle. Unset, or the designated block isn't resolvable, and the built-in
// header/footer render exactly as before — this is purely additive.
const headerBlockId = computed(() => (site.value as { headerBlockId?: string | null } | null)?.headerBlockId ?? null)
const footerBlockId = computed(() => (site.value as { footerBlockId?: string | null } | null)?.footerBlockId ?? null)
const { resolve } = useBlockRegistry()

useHead({
  link: computed(() => {
    // `as const` on each `rel`/`type` keeps them as literal types (matching a specific
    // member of @unhead/vue's Link discriminated union — AlternateFeedLink, CanonicalLink,
    // etc.) through the conditional array below. Without it, combining these via a
    // ternary/spread widens `rel` to plain `string`, which no longer matches anything in
    // the union (GenericLink is deliberately excluded from it — see unhead's own docs on
    // `defineLink()` — so there's no permissive fallback for a widened `rel` here).
    const feedLinks = [
      { rel: 'alternate' as const, type: 'application/rss+xml' as const, title: 'RSS Feed', href: '/feed.xml' },
      { rel: 'alternate' as const, type: 'application/atom+xml' as const, title: 'Atom Feed', href: '/atom.xml' },
    ]
    return canonicalBase.value
      ? [...feedLinks, { rel: 'canonical' as const, href: `${canonicalBase.value}${route.path}` }]
      : feedLinks
  }),
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
    <template v-if="headerBlockId">
      <component :is="resolve(headerBlockId)" v-if="resolve(headerBlockId)" />
      <ClientOnly v-else>
        <component :is="resolve(headerBlockId)" v-if="resolve(headerBlockId)" />
        <template #fallback><PublicSiteHeader /></template>
      </ClientOnly>
    </template>
    <PublicSiteHeader v-else />

    <div class="flex flex-1">
      <main class="flex-1 min-w-0">
        <slot />
      </main>
      <PublicSiteSidebar />
    </div>

    <template v-if="footerBlockId">
      <component :is="resolve(footerBlockId)" v-if="resolve(footerBlockId)" />
      <ClientOnly v-else>
        <component :is="resolve(footerBlockId)" v-if="resolve(footerBlockId)" />
        <template #fallback><PublicSiteFooter /></template>
      </ClientOnly>
    </template>
    <PublicSiteFooter v-else />

    <ClientOnly><PublicCookieConsent /></ClientOnly>
    <ClientOnly><PublicPushNotificationBanner /></ClientOnly>
  </div>
</template>
