<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const query = ref((route.query.q as string) ?? '')

interface SearchResult {
  id: string
  title: string
  excerpt: string
  slug: string | null
}

interface SearchResponse {
  results: SearchResult[]
}

const { data, pending, execute } = await useLazyFetch<SearchResponse>('/api/v1/search', {
  query: computed(() => ({ q: query.value })),
  immediate: !!route.query.q,
})

useSeoMeta({ title: computed(() => query.value ? `Search: ${query.value}` : 'Search') })

function search() {
  router.replace({ query: query.value ? { q: query.value } : {} })
  execute()
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-12 space-y-8">
    <h1 class="text-3xl font-bold text-gray-900 dark:text-white">Search</h1>

    <form class="flex gap-2" @submit.prevent="search">
      <UInput
        v-model="query"
        placeholder="Search posts…"
        icon="i-lucide-search"
        size="lg"
        class="flex-1"
        :loading="pending"
        autofocus
      />
      <UButton type="submit" size="lg" :loading="pending">Search</UButton>
    </form>

    <div v-if="data && !pending">
      <p v-if="data.results.length === 0 && query" class="text-gray-400 text-sm">
        No results for <strong>{{ query }}</strong>.
      </p>

      <ul v-else-if="data.results.length > 0" class="space-y-6">
        <li
          v-for="result in data.results"
          :key="result.id"
          class="border-b border-gray-100 dark:border-gray-800 pb-6 last:border-0"
        >
          <NuxtLink
            v-if="result.slug"
            :to="`/${result.slug}`"
            class="group"
          >
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white group-hover:text-primary-500 transition-colors">
              {{ result.title }}
            </h2>
          </NuxtLink>
          <h2 v-else class="text-lg font-semibold text-gray-900 dark:text-white">{{ result.title }}</h2>
          <!-- excerpt may contain <mark> tags from the FTS snippet — safe, server-generated -->
          <!-- eslint-disable-next-line vue/no-v-html -->
          <p v-if="result.excerpt" class="mt-1 text-sm text-gray-500 leading-relaxed [&_mark]:bg-yellow-100 [&_mark]:dark:bg-yellow-900/40 [&_mark]:rounded [&_mark]:px-0.5" v-html="result.excerpt" />
        </li>
      </ul>
    </div>
  </div>
</template>
