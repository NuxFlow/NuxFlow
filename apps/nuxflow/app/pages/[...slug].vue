<script setup lang="ts">
// Public content pages — rendering, SEO meta, and structured data all live in
// PublicContentPage (app/components/public/ContentPage.vue), which the two-segment
// [taxonomySlug]/[termSlug].vue route also uses for translated pages (/es/about).
const route = useRoute()
const slugPath = computed(() => (route.params.slug as string[]).join('/'))
</script>

<template>
  <PublicContentPage :slug-path="slugPath" />
</template>
