<script setup lang="ts">
import type { PublicSiteInfo } from '~/utils/seo'

// Public content pages — rendering, SEO meta, and structured data all live in
// PublicContentPage (app/components/public/ContentPage.vue), which the two-segment
// [taxonomySlug]/[termSlug].vue route also uses for translated pages (/es/about).
// A single segment naming one of the site's taxonomies (/category) is that taxonomy's
// overview page instead — content slugs can't collide with it (both write paths refuse).
const route = useRoute()
const slugPath = computed(() => (route.params.slug as string[]).join('/'))

const { data: site } = await useFetch<PublicSiteInfo>('/api/public/site', { headers: useRequestHeaders(['host']) })
const isTaxonomyIndex = computed(() => !slugPath.value.includes('/')
  && (site.value?.taxonomies ?? []).some(t => t.slug === slugPath.value))
</script>

<template>
  <PublicTaxonomyIndex v-if="isTaxonomyIndex" :taxonomy-slug="slugPath" />
  <PublicContentPage v-else :slug-path="slugPath" />
</template>
