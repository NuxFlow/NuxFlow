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

interface PublicPage {
  id: string
  title: string
  seoTitle?: string | null
  seoDescription?: string | null
  content: unknown
  hasComments?: boolean | null
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
})

const isCanvasPage = computed(() => {
  const c = page.value?.content
  return typeof c === 'object' && c !== null && (c as { type: string }).type === 'canvas'
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
        <h1 class="text-4xl font-bold text-gray-900 dark:text-white mb-8">
          {{ page.title }}
        </h1>
        <NuxBlock :content="page.content" />
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
