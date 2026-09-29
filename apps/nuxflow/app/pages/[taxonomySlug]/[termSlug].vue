<script setup lang="ts">
import { NuxImage } from '@nuxflow/canvas'
import type { PublicSiteInfo } from '~/utils/seo'

const route = useRoute()
const router = useRouter()
const requestOrigin = useRequestURL().origin
const taxonomySlug = route.params.taxonomySlug as string
const termSlug = route.params.termSlug as string
const page = computed(() => Math.max(1, Number(route.query.page) || 1))
const PER_PAGE = 10

interface ArchiveItem {
  id: string
  title: string
  slug: string
  path: string
  excerpt: string | null
  ogImage: string | null
  publishedAt: string | null
}

interface ArchiveData {
  taxonomy: { id: string; name: string; slug: string; isHierarchical: boolean; noindex: boolean }
  term: {
    id: string; name: string; slug: string; description: string | null
    seoTitle: string | null; seoDescription: string | null; ogImage: string | null
  }
  ancestors: { slug: string; name: string }[]
  children: { slug: string; name: string }[]
  items: ArchiveItem[]
  total: number
  page: number
  limit: number
  totalPages: number
}

// Vue Router ranks this two-segment route above the `[...slug]` catch-all, so a translated
// page (/es/about) or any other two-segment content path lands here too. The site's active
// locales identify the translated case up front (no wasted taxonomy lookup); anything else
// that isn't a real taxonomy archive falls back to the content page renderer, which 404s
// properly if there's no content either.
const { data: site } = await useFetch<PublicSiteInfo>('/api/public/site', { headers: useRequestHeaders(['host']) })
const isLocalePath = (site.value?.locales ?? []).includes(taxonomySlug)

const { data, error } = await useFetch<ArchiveData>(`/api/public/taxonomy/${taxonomySlug}/${termSlug}`, {
  query: computed(() => ({ page: page.value, limit: PER_PAGE })),
  headers: useRequestHeaders(['host']),
  immediate: !isLocalePath,
})

const renderAsPage = computed(() => isLocalePath || error.value?.statusCode === 404)
if (error.value && !renderAsPage.value) {
  throw createError({ statusCode: error.value.statusCode ?? 500, message: 'Something went wrong' })
}

const canonicalBase = computed(() => site.value?.canonicalBase ?? '')
const siteName = computed(() => site.value?.name ?? '')
const archivePath = `/${taxonomySlug}/${termSlug}`
const archiveUrl = computed(() => canonicalBase.value ? `${canonicalBase.value}${archivePath}` : '')
const pageUrl = computed(() => archiveUrl.value && page.value > 1 ? `${archiveUrl.value}?page=${page.value}` : archiveUrl.value)
const archiveTitle = computed(() => data.value ? (data.value.term.seoTitle || `${data.value.term.name} — ${data.value.taxonomy.name}`) : '')
const archiveDesc = computed(() => {
  if (!data.value) return ''
  const n = data.value.total
  return data.value.term.seoDescription
    || data.value.term.description
    || `${n} ${n === 1 ? 'item' : 'items'} filed under ${data.value.term.name}${siteName.value ? ` on ${siteName.value}` : ''}.`
})
const shareImage = computed(() => absolutize(data.value?.term.ogImage, requestOrigin) || site.value?.seo?.ogImage || undefined)
const noindex = computed(() => Boolean(site.value?.seo?.noindexTaxonomies || data.value?.taxonomy.noindex))
const feedPath = `/feed.xml?taxonomy=${encodeURIComponent(taxonomySlug)}&term=${encodeURIComponent(termSlug)}`

// Only when this route is actually rendering an archive — PublicContentPage sets its own.
if (!renderAsPage.value) {
  useSeoMeta({
    title: archiveTitle,
    description: archiveDesc,
    robots: computed(() => (noindex.value ? 'noindex,follow' : undefined)),
    ogTitle: archiveTitle,
    ogDescription: archiveDesc,
    ogType: 'website',
    ogUrl: pageUrl,
    ogImage: shareImage,
    twitterCard: computed(() => (shareImage.value ? 'summary_large_image' : 'summary')),
  })

  useHead({
    link: computed(() => data.value
      ? [{ rel: 'alternate', type: 'application/rss+xml', title: `${data.value.term.name}${siteName.value ? ` — ${siteName.value}` : ''}`, href: feedPath }]
      : []),
    script: computed(() => {
      if (!data.value || !archiveUrl.value) return []
      const base = canonicalBase.value
      const crumbs = [
        { name: siteName.value || 'Home', item: `${base}/` },
        { name: data.value.taxonomy.name, item: `${base}/${taxonomySlug}` },
        ...data.value.ancestors.map(a => ({ name: a.name, item: `${base}/${taxonomySlug}/${a.slug}` })),
        { name: data.value.term.name, item: archiveUrl.value },
      ]
      return [
        {
          type: 'application/ld+json',
          innerHTML: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: archiveTitle.value,
            description: archiveDesc.value,
            url: pageUrl.value,
            mainEntity: {
              '@type': 'ItemList',
              numberOfItems: data.value.total,
              itemListElement: data.value.items.map((it, i) => ({ '@type': 'ListItem', position: (page.value - 1) * PER_PAGE + i + 1, url: `${base}${it.path}`, name: it.title })),
            },
          }),
        },
        {
          type: 'application/ld+json',
          innerHTML: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.item })),
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
      <nav aria-label="Breadcrumb" class="text-sm text-gray-500 mb-2 flex flex-wrap items-center gap-1">
        <NuxtLink :to="`/${data.taxonomy.slug}`" class="hover:text-primary-500 uppercase tracking-wide font-medium">{{ data.taxonomy.name }}</NuxtLink>
        <template v-for="a in data.ancestors" :key="a.slug">
          <UIcon name="i-lucide-chevron-right" class="w-3.5 h-3.5 text-gray-300" />
          <NuxtLink :to="`/${data.taxonomy.slug}/${a.slug}`" class="hover:text-primary-500">{{ a.name }}</NuxtLink>
        </template>
      </nav>
      <div class="flex items-start justify-between gap-4">
        <h1 class="text-3xl font-bold">{{ data.term.name }}</h1>
        <a :href="feedPath" class="text-gray-400 hover:text-primary-500 mt-2" :aria-label="`RSS feed for ${data.term.name}`" title="RSS feed">
          <UIcon name="i-lucide-rss" class="w-5 h-5" />
        </a>
      </div>
      <p v-if="data.term.description" class="mt-2 text-gray-500">{{ data.term.description }}</p>
      <p class="mt-1 text-sm text-gray-400">{{ data.total }} {{ data.total === 1 ? 'item' : 'items' }}</p>
      <div v-if="data.children.length" class="mt-4 flex flex-wrap gap-2">
        <UButton
          v-for="c in data.children"
          :key="c.slug"
          :to="`/${data.taxonomy.slug}/${c.slug}`"
          size="xs"
          variant="soft"
          color="neutral"
        >
          {{ c.name }}
        </UButton>
      </div>
    </div>

    <!-- Item list -->
    <div v-if="data.items.length > 0" class="space-y-6">
      <article
        v-for="item in data.items"
        :key="item.id"
        class="flex gap-4 border-b border-gray-100 dark:border-gray-800 pb-6 last:border-0"
      >
        <div class="flex-1 min-w-0">
          <NuxtLink :to="item.path" class="group">
            <h2 class="text-xl font-semibold group-hover:text-primary-500 transition-colors">{{ item.title }}</h2>
          </NuxtLink>
          <p v-if="item.excerpt" class="mt-2 text-gray-500 text-sm leading-relaxed line-clamp-3">{{ item.excerpt }}</p>
          <p v-if="item.publishedAt" class="mt-2 text-xs text-gray-400">
            {{ formatDate(item.publishedAt) }}
          </p>
        </div>
        <NuxtLink v-if="item.ogImage" :to="item.path" class="shrink-0" tabindex="-1" aria-hidden="true">
          <NuxImage :src="item.ogImage" alt="" :width="160" :height="112" fit="cover" class="w-32 h-24 sm:w-40 sm:h-28 object-cover rounded-lg" />
        </NuxtLink>
      </article>
    </div>
    <p v-else class="text-gray-400 text-sm">Nothing has been published under {{ data.term.name }} yet.</p>

    <!-- Pagination -->
    <div v-if="data.totalPages > 1" class="flex items-center justify-center gap-2">
      <UButton
        variant="outline"
        size="sm"
        icon="i-lucide-chevron-left"
        aria-label="Previous page"
        :disabled="page <= 1"
        @click="goToPage(page - 1)"
      />
      <span class="text-sm text-gray-500">Page {{ page }} of {{ data.totalPages }}</span>
      <UButton
        variant="outline"
        size="sm"
        icon="i-lucide-chevron-right"
        aria-label="Next page"
        :disabled="page >= data.totalPages"
        @click="goToPage(page + 1)"
      />
    </div>
  </div>
</template>
