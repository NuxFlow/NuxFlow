<script setup lang="ts">
import { setResponseStatus } from 'h3'
import Paywall from '~/components/memberships/Paywall.vue'
import { NuxImage } from '@nuxflow/canvas'
import type { PublicSiteInfo } from '~/utils/seo'

/**
 * A published content item rendered at `slugPath` (e.g. `about`, `es/about`, `es`).
 * Rendered by the catch-all `[...slug].vue`, and also by `[taxonomySlug]/[termSlug].vue`
 * for two-segment paths that turn out to be a translated page (`/es/about`) rather than a
 * taxonomy archive — Vue Router ranks that two-segment route above the catch-all, so
 * without this a translated URL could never reach the page renderer at all.
 */
const props = defineProps<{ slugPath: string }>()

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
  slug: string
  path?: string
  seoTitle?: string | null
  seoDescription?: string | null
  content: unknown
  excerpt?: string | null
  ogImage?: string | null
  canonicalUrl?: string | null
  robots?: string | null
  publishedAt?: string | null
  updatedAt?: string | null
  hasComments?: boolean | null
  author?: Author | null
  locale?: string | null
  defaultLocale?: string | null
  type?: { slug: string; name: string } | null
  event?: { startAt: string; endAt?: string | null; allDay?: boolean | null; location?: string | null; url?: string | null } | null
  availableLocales?: Array<{ locale: string; slug: string; rawSlug?: string }> | null
  alternates?: Array<{ locale: string; path: string }> | null
  terms?: PublicTerm[] | null
}

interface PublicTerm {
  taxonomySlug: string
  taxonomyName: string
  isHierarchical: boolean
  termSlug: string
  termName: string
  path: string
}

interface GateData {
  gated: true
  requiredTier: string | null
  tiers: Tier[]
}

const gated = ref<GateData | null>(null)

const { data: page, error } = await useFetch<PublicPage>(() => `/api/public/pages/${props.slugPath}`, {
  headers: useRequestHeaders(['host', 'cookie']),
  onResponseError({ response }) {
    if (response.status === 402) {
      gated.value = response._data as unknown as GateData
    }
  },
})

// This component renders its own inline error/paywall UI instead of throwing (so the
// rest of the layout keeps rendering), which means Nuxt's own error-boundary status
// propagation never kicks in — without this, a missing/gated page would otherwise
// silently ship as a 200, which search engines then index as a real, live page.
if (import.meta.server) {
  const requestEvent = useRequestEvent()
  if (requestEvent) {
    if (gated.value) {
      setResponseStatus(requestEvent, 402)
    } else if (error.value && error.value.statusCode !== 402) {
      setResponseStatus(requestEvent, error.value.statusCode ?? 500)
    }
  }
}

// Share available translations with layout/header via useState
const activeLocalesState = useState<Array<{ locale: string; slug: string; rawSlug?: string }>>('active-locales', () => [])
watch(page, (val) => {
  activeLocalesState.value = val?.availableLocales || []
}, { immediate: true })

// Deduped with layout's fetch — no extra request
const { data: site } = await useFetch<PublicSiteInfo>('/api/public/site', { headers: useRequestHeaders(['host']) })
const canonicalBase = computed(() => site.value?.canonicalBase ?? '')
const siteName = computed(() => site.value?.name ?? '')
const siteSeo = computed(() => site.value?.seo)

// Clear gate state when the path changes (navigating to a different page)
watch(() => props.slugPath, () => { gated.value = null })

const isHome = computed(() => page.value?.path === '/' || page.value?.slug === 'home')
const pageTitle = computed(() => page.value?.seoTitle || page.value?.title || '')
const pageDesc = computed(() => page.value?.seoDescription || page.value?.excerpt || siteSeo.value?.description || '')
// One canonical URL per item: an explicit override, else the item's own public path
// (translations → /{locale}/{source slug}, homepage → /) — never the raw `about-es` slug
// or a locale-prefixed fallback URL serving the original.
const pageUrl = computed(() => {
  if (page.value?.canonicalUrl) return page.value.canonicalUrl
  const path = page.value?.path ?? `/${page.value?.slug ?? props.slugPath}`
  return canonicalBase.value ? `${canonicalBase.value}${path}` : ''
})

// Social scrapers and search engines need an absolute image URL; media served through
// the Worker (/_nuxflow/media/...) is stored site-relative, so resolve it against this
// request's own origin. Already-absolute URLs pass through unchanged. Falls back to the
// site's default share image (Admin → SEO).
const requestOrigin = useRequestURL().origin
const shareImage = computed(() => absolutize(page.value?.ogImage, requestOrigin) || siteSeo.value?.ogImage || undefined)
const isArticle = computed(() => page.value?.type?.slug === 'post')

useSeoMeta({
  title: pageTitle,
  description: pageDesc,
  robots: computed(() => page.value?.robots ?? undefined),
  ogTitle: pageTitle,
  ogDescription: pageDesc,
  ogImage: shareImage,
  ogType: computed(() => (isArticle.value ? 'article' : 'website')),
  ogUrl: pageUrl,
  ogSiteName: siteName,
  ogLocale: computed(() => ogLocale(page.value?.locale)),
  articlePublishedTime: computed(() => (isArticle.value ? toIsoDate(page.value?.publishedAt) : undefined)),
  articleModifiedTime: computed(() => (isArticle.value ? toIsoDate(page.value?.updatedAt) : undefined)),
  articleAuthor: computed(() => (isArticle.value && page.value?.author?.name ? [page.value.author.name] : undefined)),
  twitterCard: computed(() => (shareImage.value ? 'summary_large_image' : 'summary')),
  twitterTitle: pageTitle,
  twitterDescription: pageDesc,
  twitterImage: shareImage,
})

useHead({
  htmlAttrs: {
    lang: computed(() => page.value?.locale || site.value?.locale || 'en'),
  },
  link: computed(() => {
    if (!page.value) return []
    const links: HeadLink[] = []
    if (pageUrl.value) links.push({ rel: 'canonical' as const, href: pageUrl.value })
    // hreflang: every translation of this page (itself included) plus x-default → original.
    const alternates = page.value.alternates ?? []
    if (alternates.length > 1 && canonicalBase.value) {
      for (const a of alternates) links.push({ rel: 'alternate' as const, hreflang: a.locale, href: `${canonicalBase.value}${a.path}` })
      links.push({ rel: 'alternate' as const, hreflang: 'x-default', href: `${canonicalBase.value}${alternates[0]!.path}` })
    }
    // Markdown alternate for AI agents (server/middleware/06.markdown.ts).
    if (siteSeo.value?.markdownEnabled && page.value.path) {
      links.push({ rel: 'alternate' as const, type: 'text/markdown', href: `${page.value.path === '/' ? '/index' : page.value.path}.md` })
    }
    return links
  }),
  script: computed(() => {
    if (!page.value || !pageUrl.value) return []
    return buildPageJsonLd({
      title: pageTitle.value,
      description: pageDesc.value,
      url: pageUrl.value,
      image: shareImage.value,
      locale: page.value.locale ?? undefined,
      publishedAt: page.value.publishedAt,
      updatedAt: page.value.updatedAt,
      author: page.value.author,
      type: page.value.type,
      event: page.value.event,
      terms: page.value.terms ?? [],
      content: page.value.content,
      isHome: isHome.value,
    }, {
      name: siteName.value,
      base: canonicalBase.value,
      logoUrl: absolutize(site.value?.logoUrl, requestOrigin),
    }).map(schema => ({ type: 'application/ld+json', innerHTML: JSON.stringify(schema) }))
  }),
})

// The item's terms grouped per taxonomy, hierarchical ones (categories) first.
const termGroups = computed(() => {
  const groups = new Map<string, { slug: string; name: string; isHierarchical: boolean; terms: PublicTerm[] }>()
  for (const t of page.value?.terms ?? []) {
    const g = groups.get(t.taxonomySlug) ?? { slug: t.taxonomySlug, name: t.taxonomyName, isHierarchical: t.isHierarchical, terms: [] }
    g.terms.push(t)
    groups.set(t.taxonomySlug, g)
  }
  return [...groups.values()].sort((a, b) => Number(b.isHierarchical) - Number(a.isHierarchical) || a.name.localeCompare(b.name))
})

const isCanvasPage = computed(() => {
  const c = page.value?.content
  return typeof c === 'object' && c !== null && (c as { type: string }).type === 'canvas'
})

// "Listen to this article" — generates audio on demand (see api/public/listen/[slug].post.ts)
// rather than pre-fetching on every page load, since most visitors never click it and each
// click costs a real Workers AI TTS call.
const listenAudioUrl = ref<string | null>(null)
const listenLoading = ref(false)
const listenError = ref(false)

async function listenToArticle() {
  if (listenAudioUrl.value || listenLoading.value || !page.value) return
  listenLoading.value = true
  listenError.value = false
  try {
    const res = await fetch(`/api/public/listen/${page.value.slug}`, { method: 'POST' })
    if (!res.ok) throw new Error(`Request failed (${res.status})`)
    const blob = await res.blob()
    listenAudioUrl.value = URL.createObjectURL(blob)
  } catch {
    listenError.value = true
  } finally {
    listenLoading.value = false
  }
}

onBeforeUnmount(() => {
  if (listenAudioUrl.value) URL.revokeObjectURL(listenAudioUrl.value)
})

const formattedDate = computed(() => {
  if (!page.value?.publishedAt) return null
  // timeZone: 'UTC' pins this to the same calendar date on both the Worker (which runs
  // in UTC) and the visitor's browser (which may be in any timezone) — without it, a
  // publish date near a local midnight boundary can format to a different day on each
  // side, producing a real SSR hydration mismatch on every affected page load.
  return new Date(page.value.publishedAt).toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
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
        <!-- Featured image — likely the page's LCP element, so eager not lazy -->
        <NuxImage
          v-if="page.ogImage"
          :src="page.ogImage"
          :alt="page.title"
          :width="1200"
          :height="512"
          fit="cover"
          loading="eager"
          class="w-full h-64 object-cover rounded-2xl mb-8"
        />

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
          <time v-if="formattedDate" :datetime="toIsoDate(page.publishedAt)">{{ formattedDate }}</time>
        </div>

        <!-- Listen to this article (AI text-to-speech) -->
        <div class="mb-8">
          <audio v-if="listenAudioUrl" :src="listenAudioUrl" controls class="w-full max-w-sm" />
          <UButton
            v-else
            size="sm"
            variant="soft"
            :icon="listenLoading ? undefined : 'i-lucide-headphones'"
            :loading="listenLoading"
            @click="listenToArticle"
          >
            Listen to this article
          </UButton>
          <p v-if="listenError" class="text-xs text-red-500 mt-1">Couldn't generate audio for this article.</p>
        </div>

        <NuxBlock :content="page.content" />

        <!-- Categories & tags -->
        <div v-if="termGroups.length" class="mt-10 space-y-2 text-sm">
          <div v-for="group in termGroups" :key="group.slug" class="flex flex-wrap items-center gap-2">
            <span class="text-gray-500">{{ group.name }}:</span>
            <NuxtLink
              v-for="t in group.terms"
              :key="t.termSlug"
              :to="t.path"
              rel="tag"
              class="rounded-full bg-gray-100 dark:bg-gray-800 px-2.5 py-0.5 text-gray-700 dark:text-gray-300 hover:text-primary-500 transition-colors"
            >
              {{ t.termName }}
            </NuxtLink>
          </div>
        </div>

        <!-- Social share -->
        <PublicShareButtons :title="page.title" class="mt-10 pt-8 border-t border-gray-100 dark:border-gray-800" />

        <CommentSection v-if="page.hasComments" :item-id="page.id" />
      </div>
    </template>

    <div v-else-if="error && error.statusCode !== 402" class="min-h-[60vh] flex items-center justify-center">
      <div class="text-center">
        <p class="text-6xl font-bold text-gray-200 dark:text-gray-800">{{ error.statusCode }}</p>
        <p class="mt-2 text-gray-500">
          {{ error.statusCode === 404 ? 'Page not found' : error.statusCode === 410 ? 'This page has been removed' : 'Something went wrong' }}
        </p>
        <UButton to="/" variant="link" class="mt-4">Go home</UButton>
      </div>
    </div>
  </div>
</template>
