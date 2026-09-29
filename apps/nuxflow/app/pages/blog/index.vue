<script setup lang="ts">
import { NuxImage } from '@nuxflow/canvas'
import type { PublicSiteInfo } from '~/utils/seo'

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
  /** Public URL (translations live at /{locale}/{source slug}, the homepage at /). */
  path: string
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

const { data, error } = await useFetch<PostsResponse>('/api/public/posts', {
  query: computed(() => ({ page: page.value, limit: 10 })),
  headers: useRequestHeaders(['host']),
})

const { data: site } = await useFetch<PublicSiteInfo>('/api/public/site', { headers: useRequestHeaders(['host']) })
const canonicalBase = computed(() => site.value?.canonicalBase ?? '')
const siteName = computed(() => site.value?.name ?? '')

const blogTitle = computed(() => (page.value > 1 ? `Blog — page ${page.value}` : 'Blog'))
const blogDesc = computed(() => {
  const latest = data.value?.posts.slice(0, 3).map(p => p.title).join(', ')
  const who = siteName.value ? ` from ${siteName.value}` : ''
  return latest ? `The latest articles${who}: ${latest}.` : `Articles and updates${who}.`
})
const blogUrl = computed(() => canonicalBase.value ? `${canonicalBase.value}/blog${page.value > 1 ? `?page=${page.value}` : ''}` : '')

useSeoMeta({
  title: blogTitle,
  description: blogDesc,
  ogType: 'website',
  ogTitle: computed(() => siteName.value ? `${blogTitle.value} — ${siteName.value}` : blogTitle.value),
  ogDescription: blogDesc,
  ogUrl: blogUrl,
  ogImage: computed(() => site.value?.seo?.ogImage || undefined),
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
        name: blogTitle.value,
        description: blogDesc.value,
        url: blogUrl.value,
        mainEntity: {
          '@type': 'ItemList',
          numberOfItems: data.value.total,
          itemListElement: data.value.posts.map((p, i) => ({ '@type': 'ListItem', position: (page.value - 1) * 10 + i + 1, url: `${canonicalBase.value}${p.path}`, name: p.title })),
        },
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
  // timeZone: 'UTC' keeps this identical on server (UTC) and client (any timezone) —
  // see the matching comment in [...slug].vue for the hydration-mismatch this avoids.
  return new Date(d).toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
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
          v-for="(post, i) in data.posts"
          :key="post.id"
          class="group rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden hover:shadow-md transition-shadow bg-white dark:bg-gray-900"
        >
          <NuxtLink :to="post.path" class="block">
            <div class="relative overflow-hidden aspect-[4/3] bg-gray-100 dark:bg-gray-800">
              <NuxImage
                v-if="post.ogImage"
                :src="post.ogImage"
                :alt="post.title"
                :width="600"
                :height="450"
                fit="cover"
                class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                :loading="i === 0 ? 'eager' : 'lazy'"
              />
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
          v-for="(post, i) in data.posts"
          :key="post.id"
          class="group"
        >
          <NuxtLink :to="post.path" class="block">
            <NuxImage
              v-if="post.ogImage"
              :src="post.ogImage"
              :alt="post.title"
              :width="800"
              :height="224"
              fit="cover"
              class="w-full h-56 object-cover rounded-xl mb-4"
              :loading="i === 0 ? 'eager' : 'lazy'"
            />
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
            <NuxtLink :to="post.path" class="text-xs text-primary-500 hover:underline font-medium">
              Read more →
            </NuxtLink>
          </div>
          <div class="mt-6 border-b border-gray-100 dark:border-gray-800" />
        </article>
      </div>
    </div>

    <p v-else-if="error" class="text-red-500 text-sm">Something went wrong loading posts. Please try again later.</p>
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
