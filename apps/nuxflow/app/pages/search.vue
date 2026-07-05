<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const query = ref((route.query.q as string) ?? '')

interface SearchExcerptSegment {
  text: string
  highlighted: boolean
}

interface SearchResult {
  id: string
  title: string
  excerptSegments: SearchExcerptSegment[]
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
          <!-- Each segment is rendered as plain text (auto-escaped) — the excerpt is
               author-controlled content, so it's never trusted as raw HTML. Only the
               <mark> wrapper itself is real markup, applied structurally below. -->
          <p v-if="result.excerptSegments.length" class="mt-1 text-sm text-gray-500 leading-relaxed">
            <template v-for="(segment, i) in result.excerptSegments" :key="i">
              <mark v-if="segment.highlighted" class="bg-yellow-100 dark:bg-yellow-900/40 rounded px-0.5">{{ segment.text }}</mark>
              <template v-else>{{ segment.text }}</template>
            </template>
          </p>
        </li>
      </ul>
    </div>
  </div>
</template>
