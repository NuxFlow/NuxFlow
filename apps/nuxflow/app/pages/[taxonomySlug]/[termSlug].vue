<script setup lang="ts">
import type { PublicSiteInfo } from '~/utils/seo'

const route = useRoute()
const router = useRouter()
const taxonomySlug = route.params.taxonomySlug as string
const termSlug = route.params.termSlug as string
const page = computed(() => Math.max(1, Number(route.query.page) || 1))

interface PostItem {
  id: string
  title: string
  slug: string
  excerpt: string | null
  ogImage: string | null
  publishedAt: string | null
}

// Vue Router ranks this two-segment route above the `[...slug]` catch-all, so a translated
// page (/es/about) or any other two-segment content path lands here too. The site's active
// locales identify the translated case up front (no wasted taxonomy lookup); anything else
// that isn't a real taxonomy archive falls back to the content page renderer, which 404s
// properly if there's no content either.
const { data: site } = await useFetch<PublicSiteInfo>('/api/public/site', { headers: useRequestHeaders(['host']) })
const isLocalePath = (site.value?.locales ?? []).includes(taxonomySlug)

const { data, error } = await useFetch<{
  taxonomy: { id: string; name: string; slug: string }
  term: { id: string; name: string; slug: string; description: string | null }
  items: PostItem[]
  total: number
  page: number
  limit: number
  totalPages: number
}>(`/api/public/taxonomy/${taxonomySlug}/${termSlug}`, {
  query: computed(() => ({ page: page.value, limit: 10 })),
  headers: useRequestHeaders(['host']),
  immediate: !isLocalePath,
})

const renderAsPage = computed(() => isLocalePath || error.value?.statusCode === 404)
if (error.value && !renderAsPage.value) {
  throw createError({ statusCode: error.value.statusCode ?? 500, message: 'Something went wrong' })
}

const canonicalBase = computed(() => site.value?.canonicalBase ?? '')
const siteName = computed(() => site.value?.name ?? '')
const archiveUrl = computed(() => canonicalBase.value ? `${canonicalBase.value}/${taxonomySlug}/${termSlug}` : '')
const archiveTitle = computed(() => data.value ? `${data.value.term.name} — ${data.value.taxonomy.name}` : '')
const archiveDesc = computed(() => {
  if (!data.value) return ''
  return data.value.term.description
    || `${data.value.total} ${data.value.total === 1 ? 'post' : 'posts'} filed under ${data.value.term.name}${siteName.value ? ` on ${siteName.value}` : ''}.`
})

// Only when this route is actually rendering an archive — PublicContentPage sets its own.
if (!renderAsPage.value) {
  useSeoMeta({
    title: archiveTitle,
    description: archiveDesc,
    robots: computed(() => (site.value?.seo?.noindexTaxonomies ? 'noindex,follow' : undefined)),
    ogTitle: archiveTitle,
    ogDescription: archiveDesc,
    ogType: 'website',
    ogUrl: archiveUrl,
    ogImage: computed(() => site.value?.seo?.ogImage || undefined),
    twitterCard: 'summary',
  })

  useHead({
    script: computed(() => {
      if (!data.value || !archiveUrl.value) return []
      return [
        {
          type: 'application/ld+json',
          innerHTML: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: archiveTitle.value,
            description: archiveDesc.value,
            url: archiveUrl.value,
            mainEntity: {
              '@type': 'ItemList',
              numberOfItems: data.value.total,
              itemListElement: data.value.items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, url: `${canonicalBase.value}/${it.slug}`, name: it.title })),
            },
          }),
        },
        {
          type: 'application/ld+json',
          innerHTML: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: siteName.value || 'Home', item: `${canonicalBase.value}/` },
              { '@type': 'ListItem', position: 2, name: data.value.term.name, item: archiveUrl.value },
            ],
          }),
        },
      ]
    }),
  })
}

function goToPage(p: number) {
  router.push({ query: { ...route.query, page: p > 1 ? p : undefined } })
}

// timeZone: 'UTC' keeps this identical on server (UTC) and client (any timezone) — see
// the matching comment in [...slug].vue for the hydration-mismatch this avoids.
function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
}
</script>

<template>
  <PublicContentPage v-if="renderAsPage" :slug-path="`${taxonomySlug}/${termSlug}`" />
  <div v-else-if="data" class="max-w-3xl mx-auto px-4 py-12 space-y-8">
    <!-- Header -->
    <div>
      <p class="text-sm text-gray-500 uppercase tracking-wide font-medium mb-1">{{ data.taxonomy.name }}</p>
      <h1 class="text-3xl font-bold">{{ data.term.name }}</h1>
      <p v-if="data.term.description" class="mt-2 text-gray-500">{{ data.term.description }}</p>
      <p class="mt-1 text-sm text-gray-400">{{ data.total }} post{{ data.total !== 1 ? 's' : '' }}</p>
    </div>

    <!-- Post list -->
    <div v-if="data.items.length > 0" class="space-y-6">
      <article
        v-for="item in data.items"
        :key="item.id"
        class="border-b border-gray-100 dark:border-gray-800 pb-6 last:border-0"
      >
        <NuxtLink :to="`/${item.slug}`" class="group">
          <h2 class="text-xl font-semibold group-hover:text-primary-500 transition-colors">{{ item.title }}</h2>
        </NuxtLink>
        <p v-if="item.excerpt" class="mt-2 text-gray-500 text-sm leading-relaxed line-clamp-3">{{ item.excerpt }}</p>
        <p v-if="item.publishedAt" class="mt-2 text-xs text-gray-400">
          {{ formatDate(item.publishedAt) }}
        </p>
      </article>
    </div>
    <p v-else class="text-gray-400 text-sm">No published content in this {{ data.taxonomy.name.toLowerCase().slice(0, -1) }} yet.</p>

    <!-- Pagination -->
    <div v-if="data.totalPages > 1" class="flex items-center justify-center gap-2">
      <UButton
        variant="outline"
        size="sm"
        icon="i-lucide-chevron-left"
        :disabled="page <= 1"
        @click="goToPage(page - 1)"
      />
      <span class="text-sm text-gray-500">Page {{ page }} of {{ data.totalPages }}</span>
      <UButton
        variant="outline"
        size="sm"
        icon="i-lucide-chevron-right"
        :disabled="page >= data.totalPages"
        @click="goToPage(page + 1)"
      />
    </div>
  </div>
</template>
