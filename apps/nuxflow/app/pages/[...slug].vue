<script setup lang="ts">
import Paywall from '~/components/memberships/Paywall.vue'

const route = useRoute()
const slug = computed(() => (route.params.slug as string[]).join('/'))

interface Tier {
  id: string
  name: string
  price: number
  currency: string
  interval: 'month' | 'year'
  features: string[]
}

interface Author {
  name: string
  image: string | null
}

interface PublicPage {
  id: string
  title: string
  seoTitle?: string | null
  seoDescription?: string | null
  content: unknown
  excerpt?: string | null
  ogImage?: string | null
  publishedAt?: string | null
  hasComments?: boolean | null
  author?: Author | null
}

interface GateData {
  gated: true
  requiredTier: string | null
  tiers: Tier[]
}

const gated = ref<GateData | null>(null)

const { data: page, error } = await useFetch<PublicPage>(() => `/api/public/pages/${slug.value}`, {
  headers: useRequestHeaders(['host', 'cookie']),
  onResponseError({ response }) {
    if (response.status === 402) {
      gated.value = response._data as unknown as GateData
    }
  },
})

// Clear gate state when slug changes (navigating to a different page)
watch(slug, () => { gated.value = null })

useSeoMeta({
  title: page.value?.seoTitle || page.value?.title,
  description: page.value?.seoDescription,
  ogImage: page.value?.ogImage ?? undefined,
})

const isCanvasPage = computed(() => {
  const c = page.value?.content
  return typeof c === 'object' && c !== null && (c as { type: string }).type === 'canvas'
})

const formattedDate = computed(() => {
  if (!page.value?.publishedAt) return null
  return new Date(page.value.publishedAt).toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric' })
})
</script>

<template>
  <div>
    <!-- Membership gate: 402 response -->
    <div v-if="gated" class="max-w-4xl mx-auto px-6 py-12">
      <Paywall :tiers="gated.tiers" />
    </div>

    <!-- Normal page rendering -->
    <template v-else-if="page">
      <!-- Canvas pages: full-width, no container — blocks handle their own layout -->
      <template v-if="isCanvasPage">
        <NuxBlock :content="page.content" />
        <CommentSection v-if="page.hasComments" :item-id="page.id" class="max-w-4xl mx-auto px-6 py-12" />
      </template>

      <!-- Rich-text / other content: contained with title -->
      <div v-else class="max-w-4xl mx-auto px-6 py-12">
        <!-- Featured image -->
        <img
          v-if="page.ogImage"
          :src="page.ogImage"
          :alt="page.title"
          class="w-full h-64 object-cover rounded-2xl mb-8"
        >

        <h1 class="text-4xl font-bold text-gray-900 dark:text-white mb-4">
          {{ page.title }}
        </h1>

        <!-- Author + date meta -->
        <div v-if="page.author || formattedDate" class="flex items-center gap-3 mb-8 text-sm text-gray-500">
          <template v-if="page.author">
            <UAvatar
              :src="page.author.image ?? undefined"
              :alt="page.author.name"
              size="sm"
            />
            <span class="font-medium text-gray-700 dark:text-gray-300">{{ page.author.name }}</span>
          </template>
          <span v-if="page.author && formattedDate" class="text-gray-300 dark:text-gray-600">·</span>
          <time v-if="formattedDate">{{ formattedDate }}</time>
        </div>

        <NuxBlock :content="page.content" />

        <!-- Social share -->
        <PublicShareButtons :title="page.title" class="mt-10 pt-8 border-t border-gray-100 dark:border-gray-800" />

        <CommentSection v-if="page.hasComments" :item-id="page.id" />
      </div>
    </template>

    <div v-else-if="error && error.statusCode !== 402" class="min-h-[60vh] flex items-center justify-center">
      <div class="text-center">
        <p class="text-6xl font-bold text-gray-200 dark:text-gray-800">{{ error.statusCode }}</p>
        <p class="mt-2 text-gray-500">
          {{ error.statusCode === 404 ? 'Page not found' : 'Something went wrong' }}
        </p>
        <UButton to="/" variant="link" class="mt-4">Go home</UButton>
      </div>
    </div>
  </div>
</template>
