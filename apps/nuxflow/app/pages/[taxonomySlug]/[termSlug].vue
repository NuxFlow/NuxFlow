<script setup lang="ts">
const route = useRoute()
const taxonomySlug = route.params.taxonomySlug as string
const termSlug = route.params.termSlug as string

const { data, error } = await useFetch<{
  taxonomy: { id: string; name: string; slug: string }
  term: { id: string; name: string; slug: string; description: string | null }
  items: { id: string; title: string; slug: string; excerpt: string | null; publishedAt: string | null }[]
}>(`/api/public/taxonomy/${taxonomySlug}/${termSlug}`, {
  headers: useRequestHeaders(['host']),
})

if (error.value) {
  throw createError({ statusCode: 404, message: 'Not found' })
}

useSeoMeta({
  title: computed(() => data.value ? `${data.value.term.name} — ${data.value.taxonomy.name}` : ''),
})
</script>

<template>
  <div v-if="data" class="max-w-3xl mx-auto px-4 py-12 space-y-8">
    <!-- Header -->
    <div>
      <p class="text-sm text-gray-500 uppercase tracking-wide font-medium mb-1">{{ data.taxonomy.name }}</p>
      <h1 class="text-3xl font-bold">{{ data.term.name }}</h1>
      <p v-if="data.term.description" class="mt-2 text-gray-500">{{ data.term.description }}</p>
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
          {{ new Date(item.publishedAt).toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric' }) }}
        </p>
      </article>
    </div>
    <p v-else class="text-gray-400 text-sm">No published content in this {{ data.taxonomy.name.toLowerCase().slice(0, -1) }} yet.</p>
  </div>
</template>
