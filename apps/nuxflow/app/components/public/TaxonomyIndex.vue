<script setup lang="ts">
import type { PublicSiteInfo } from '~/utils/seo'

// Overview page for /{taxonomy}: every term with published content, nested for a
// hierarchical taxonomy, with counts (a parent's count includes its sub-terms').
const props = defineProps<{ taxonomySlug: string }>()

interface OverviewTerm {
  slug: string
  name: string
  description: string | null
  parentSlug: string | null
  count: number
  total: number
}

const { data: site } = await useFetch<PublicSiteInfo>('/api/public/site', { headers: useRequestHeaders(['host']) })
const { data, error } = await useFetch<{
  taxonomy: { slug: string; name: string; description: string | null; isHierarchical: boolean; noindex: boolean }
  terms: OverviewTerm[]
}>(() => `/api/public/taxonomy/${props.taxonomySlug}`, { headers: useRequestHeaders(['host']) })

if (error.value) {
  throw createError({ statusCode: error.value.statusCode ?? 500, message: error.value.statusCode === 404 ? 'Page not found' : 'Something went wrong' })
}

// The API returns terms already in manual order; nest them by parent slug.
const rows = computed(() => flattenTermTree((data.value?.terms ?? [])
  .map((t, i) => ({ ...t, id: t.slug, parentId: t.parentSlug, sortOrder: i }))))

const canonicalBase = computed(() => site.value?.canonicalBase ?? '')
const siteName = computed(() => site.value?.name ?? '')
const title = computed(() => data.value?.taxonomy.name ?? '')
const description = computed(() => data.value?.taxonomy.description
  || `All ${data.value?.taxonomy.name.toLowerCase() ?? ''}${siteName.value ? ` on ${siteName.value}` : ''}.`)
const url = computed(() => canonicalBase.value ? `${canonicalBase.value}/${props.taxonomySlug}` : '')

useSeoMeta({
  title,
  description,
  robots: computed(() => (site.value?.seo?.noindexTaxonomies || data.value?.taxonomy.noindex ? 'noindex,follow' : undefined)),
  ogTitle: title,
  ogDescription: description,
  ogType: 'website',
  ogUrl: url,
  ogImage: computed(() => site.value?.seo?.ogImage || undefined),
})

useHead({
  script: computed(() => {
    if (!data.value || !url.value) return []
    return [{
      type: 'application/ld+json',
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: title.value,
        description: description.value,
        url: url.value,
        mainEntity: {
          '@type': 'ItemList',
          numberOfItems: data.value.terms.length,
          itemListElement: data.value.terms.map((t, i) => ({
            '@type': 'ListItem', position: i + 1, name: t.name, url: `${canonicalBase.value}/${props.taxonomySlug}/${t.slug}`,
          })),
        },
      }),
    }]
  }),
})
</script>

<template>
  <div v-if="data" class="max-w-3xl mx-auto px-4 py-12 space-y-8">
    <div>
      <h1 class="text-3xl font-bold">{{ data.taxonomy.name }}</h1>
      <p v-if="data.taxonomy.description" class="mt-2 text-gray-500">{{ data.taxonomy.description }}</p>
    </div>

    <ul v-if="rows.length" class="divide-y divide-gray-100 dark:divide-gray-800">
      <li
        v-for="term in rows"
        :key="term.slug"
        class="py-3"
        :style="{ paddingLeft: `${term.depth * 1.5}rem` }"
      >
        <NuxtLink :to="`/${data.taxonomy.slug}/${term.slug}`" class="group flex items-baseline justify-between gap-4">
          <span class="font-medium group-hover:text-primary-500 transition-colors">{{ term.name }}</span>
          <span class="text-sm text-gray-400 shrink-0">{{ term.total }}</span>
        </NuxtLink>
        <p v-if="term.description" class="text-sm text-gray-500 mt-0.5">{{ term.description }}</p>
      </li>
    </ul>
    <p v-else class="text-gray-400 text-sm">Nothing has been published here yet.</p>
  </div>
</template>
