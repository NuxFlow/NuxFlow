<script setup lang="ts">
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
})

if (error.value) {
  throw createError({ statusCode: 404, message: 'Not found' })
}

useSeoMeta({
  title: computed(() => data.value ? `${data.value.term.name} — ${data.value.taxonomy.name}` : ''),
})

function goToPage(p: number) {
  router.push({ query: { ...route.query, page: p > 1 ? p : undefined } })
}
</script>

<template>
  <div v-if="data" class="max-w-3xl mx-auto px-4 py-12 space-y-8">
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
          {{ new Date(item.publishedAt).toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric' }) }}
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
