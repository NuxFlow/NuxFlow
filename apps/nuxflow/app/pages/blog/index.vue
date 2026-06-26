<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const page = computed(() => Math.max(1, Number(route.query.page) || 1))

type BlogLayout = 'list' | 'grid'
const layout = ref<BlogLayout>('list')

onMounted(() => {
  const saved = localStorage.getItem('blog-layout') as BlogLayout | null
  if (saved === 'list' || saved === 'grid') layout.value = saved
})

function setLayout(l: BlogLayout) {
  layout.value = l
  localStorage.setItem('blog-layout', l)
}

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

const { data: site } = await useFetch('/api/public/site', { headers: useRequestHeaders(['host']) })
const canonicalBase = computed(() => (site.value as { canonicalBase?: string } | null)?.canonicalBase ?? '')
const siteName = computed(() => (site.value as { name?: string } | null)?.name ?? '')

useSeoMeta({
  title: 'Blog',
  description: computed(() => data.value ? `${data.value.total} posts` : 'All posts'),
  ogType: 'website',
  ogTitle: computed(() => siteName.value ? `Blog — ${siteName.value}` : 'Blog'),
  ogUrl: computed(() => canonicalBase.value ? `${canonicalBase.value}/blog` : ''),
  twitterCard: 'summary',
})

useHead({
  script: computed(() => {
    if (!data.value || !canonicalBase.value) return []
    return [{
      type: 'application/ld+json',
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: 'Blog',
        url: `${canonicalBase.value}/blog`,
        numberOfItems: data.value.total,
        ...(siteName.value ? { publisher: { '@type': 'Organization', name: siteName.value } } : {}),
      }),
    }]
  }),
})

function goToPage(p: number) {
  router.push({ query: { ...route.query, page: p > 1 ? p : undefined } })
}

function formatDate(d: string | null) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric' })
}
</script>

<template>
  <div class="max-w-5xl mx-auto px-4 py-12 space-y-8">
    <!-- Header -->
    <div class="flex items-end justify-between">
      <div>
        <h1 class="text-3xl font-bold text-gray-900 dark:text-white">Blog</h1>
        <p v-if="data" class="mt-1 text-gray-500 text-sm">{{ data.total }} post{{ data.total !== 1 ? 's' : '' }}</p>
      </div>
      <!-- Layout toggle -->
      <div class="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
        <button
          type="button"
          :class="layout === 'list' ? 'bg-white dark:bg-gray-700 shadow text-gray-900 dark:text-white' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'"
          class="p-1.5 rounded-md transition-colors"
          title="List view"
          @click="setLayout('list')"
        >
          <span class="i-lucide-list w-4 h-4 block" />
        </button>
        <button
          type="button"
          :class="layout === 'grid' ? 'bg-white dark:bg-gray-700 shadow text-gray-900 dark:text-white' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'"
          class="p-1.5 rounded-md transition-colors"
          title="Grid view"
          @click="setLayout('grid')"
        >
          <span class="i-lucide-layout-grid w-4 h-4 block" />
        </button>
      </div>
    </div>

    <!-- Posts -->
    <div v-if="data && data.posts.length > 0">
      <!-- Grid layout -->
      <div v-if="layout === 'grid'" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        <article
          v-for="post in data.posts"
          :key="post.id"
          class="group rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden hover:shadow-md transition-shadow bg-white dark:bg-gray-900"
        >
          <NuxtLink :to="`/${post.slug}`" class="block">
            <div class="relative overflow-hidden aspect-[4/3] bg-gray-100 dark:bg-gray-800">
              <img
                v-if="post.ogImage"
                :src="post.ogImage"
                :alt="post.title"
                class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              >
              <div v-else class="w-full h-full flex items-center justify-center">
                <span class="i-lucide-image w-10 h-10 text-gray-300" />
              </div>
            </div>
            <div class="p-4 space-y-2">
              <h2 class="font-semibold text-gray-900 dark:text-white group-hover:text-primary-500 transition-colors leading-snug line-clamp-2">
                {{ post.title }}
              </h2>
              <p v-if="post.excerpt" class="text-sm text-gray-500 leading-relaxed line-clamp-2">
                {{ post.excerpt }}
              </p>
              <time v-if="post.publishedAt" class="block text-xs text-gray-400">
                {{ formatDate(post.publishedAt) }}
              </time>
            </div>
          </NuxtLink>
        </article>
      </div>

      <!-- List layout -->
      <div v-else class="max-w-3xl space-y-8">
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
              class="w-full h-56 object-cover rounded-xl mb-4"
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
              {{ formatDate(post.publishedAt) }}
            </time>
            <NuxtLink :to="`/${post.slug}`" class="text-xs text-primary-500 hover:underline font-medium">
              Read more →
            </NuxtLink>
          </div>
          <div class="mt-6 border-b border-gray-100 dark:border-gray-800" />
        </article>
      </div>
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
