<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const page = computed(() => Math.max(1, Number(route.query.page) || 1))

interface Post {
  id: string
  title: string
  slug: string
  excerpt: string | null
  ogImage: string | null
  publishedAt: string | null
}

interface PostsResponse {
  posts: Post[]
  total: number
  page: number
  limit: number
  totalPages: number
}

const { data } = await useFetch<PostsResponse>('/api/public/posts', {
  query: computed(() => ({ page: page.value, limit: 10 })),
  headers: useRequestHeaders(['host']),
})

useSeoMeta({
  title: 'Blog',
  description: computed(() => data.value ? `${data.value.total} posts` : 'All posts'),
})

function goToPage(p: number) {
  router.push({ query: { ...route.query, page: p > 1 ? p : undefined } })
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-12 space-y-10">
    <div>
      <h1 class="text-3xl font-bold text-gray-900 dark:text-white">Blog</h1>
      <p v-if="data" class="mt-1 text-gray-500 text-sm">{{ data.total }} post{{ data.total !== 1 ? 's' : '' }}</p>
    </div>

    <div v-if="data && data.posts.length > 0" class="space-y-8">
      <article
        v-for="post in data.posts"
        :key="post.id"
        class="group"
      >
        <NuxtLink :to="`/${post.slug}`" class="block">
          <img
            v-if="post.ogImage"
            :src="post.ogImage"
            :alt="post.title"
            class="w-full h-48 object-cover rounded-xl mb-4"
          >
          <h2 class="text-xl font-semibold text-gray-900 dark:text-white group-hover:text-primary-500 transition-colors">
            {{ post.title }}
          </h2>
        </NuxtLink>
        <p v-if="post.excerpt" class="mt-2 text-gray-500 text-sm leading-relaxed line-clamp-3">
          {{ post.excerpt }}
        </p>
        <div class="flex items-center gap-4 mt-3">
          <time v-if="post.publishedAt" class="text-xs text-gray-400">
            {{ new Date(post.publishedAt).toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric' }) }}
          </time>
          <NuxtLink :to="`/${post.slug}`" class="text-xs text-primary-500 hover:underline font-medium">
            Read more →
          </NuxtLink>
        </div>
        <div class="mt-6 border-b border-gray-100 dark:border-gray-800" />
      </article>
    </div>

    <p v-else-if="data" class="text-gray-400 text-sm">No posts published yet.</p>

    <!-- Pagination -->
    <div v-if="data && data.totalPages > 1" class="flex items-center justify-center gap-2">
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
