<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import type { SpacingValue } from '../types'
import { spacingToCss } from '../utils/spacing'
import NuxImage from './NuxImage.vue'

const props = withDefaults(defineProps<{
  title?: string
  description?: string
  /** Content type slug to list (e.g. `post`); empty = every type. */
  contentType?: string
  /** Optional taxonomy filter — both must be set (e.g. `category` + `news`). */
  taxonomy?: string
  term?: string
  limit?: number
  layout?: 'list' | 'grid'
  showImage?: boolean
  showExcerpt?: boolean
  showDate?: boolean
  bgColor?: string
  textColor?: string
  padding?: SpacingValue
}>(), {
  title: 'Latest posts',
  description: '',
  contentType: 'post',
  taxonomy: '',
  term: '',
  limit: 6,
  layout: 'grid',
  showImage: true,
  showExcerpt: true,
  showDate: true,
  bgColor: '',
  textColor: '',
  padding: undefined,
})

const containerStyle = computed(() => ({
  backgroundColor: props.bgColor || 'transparent',
  color: props.textColor || 'inherit',
  padding: spacingToCss(props.padding, '60px 24px'),
}))

// Shape returned by GET /api/public/posts — kept local since this package has no shared
// type module with the app (same reason CanvasBlockCalendar declares its own).
interface PostItem {
  id: string
  title: string
  path: string
  excerpt: string | null
  ogImage: string | null
  publishedAt: string | null
}

const posts = ref<PostItem[]>([])
const loading = ref(true)
const failed = ref(false)

const query = computed(() => {
  const q = new URLSearchParams({ limit: String(Math.min(Math.max(props.limit || 6, 1), 50)) })
  if (props.contentType?.trim()) q.set('type', props.contentType.trim())
  if (props.taxonomy?.trim() && props.term?.trim()) {
    q.set('taxonomy', props.taxonomy.trim())
    q.set('term', props.term.trim())
  }
  return q.toString()
})

async function load() {
  loading.value = true
  failed.value = false
  try {
    const res = await fetch(`/api/public/posts?${query.value}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as { posts?: PostItem[] }
    posts.value = data.posts ?? []
  } catch (err) {
    console.error('Failed to load posts:', err)
    failed.value = true
    posts.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)
// Re-query live while the block's filters are edited in the Canvas editor.
watch(query, load)

// timeZone: 'UTC' keeps the date identical wherever it renders.
function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
}
</script>

<template>
  <section class="canvas-posts w-full" :style="containerStyle">
    <div class="mx-auto max-w-5xl px-6">
      <div v-if="title || description" class="text-center mb-10 space-y-3">
        <h2 v-if="title" class="text-3xl font-extrabold tracking-tight leading-tight md:text-4xl">{{ title }}</h2>
        <p v-if="description" class="text-lg opacity-70 max-w-2xl mx-auto whitespace-pre-wrap">{{ description }}</p>
      </div>

      <div v-if="loading" class="flex justify-center py-12">
        <div class="animate-spin rounded-full h-8 w-8 border-2 border-primary-500 border-t-transparent" />
      </div>

      <p v-else-if="failed || posts.length === 0" class="text-center py-12 text-sm opacity-60">
        {{ failed ? 'Posts could not be loaded.' : 'Nothing has been published here yet.' }}
      </p>

      <div
        v-else
        class="canvas-posts-list"
        :class="layout === 'grid' ? 'grid gap-6 sm:grid-cols-2 lg:grid-cols-3' : 'space-y-6'"
      >
        <article
          v-for="post in posts"
          :key="post.id"
          class="canvas-posts-item group"
          :class="layout === 'list' ? 'flex gap-4 items-start' : 'flex flex-col'"
        >
          <a
            v-if="showImage && post.ogImage"
            :href="post.path"
            tabindex="-1"
            aria-hidden="true"
            :class="layout === 'list' ? 'shrink-0 order-2' : 'mb-3'"
          >
            <NuxImage
              :src="post.ogImage"
              alt=""
              :width="layout === 'list' ? 160 : 480"
              :height="layout === 'list' ? 112 : 270"
              fit="cover"
              loading="lazy"
              :class="layout === 'list' ? 'w-32 h-24 sm:w-40 sm:h-28 object-cover rounded-lg' : 'w-full aspect-video object-cover rounded-xl'"
            />
          </a>
          <div class="min-w-0 flex-1">
            <a :href="post.path">
              <h3 class="text-lg font-semibold leading-snug group-hover:text-primary-500 transition-colors">{{ post.title }}</h3>
            </a>
            <p v-if="showDate && post.publishedAt" class="mt-1 text-xs opacity-60">{{ formatDate(post.publishedAt) }}</p>
            <p v-if="showExcerpt && post.excerpt" class="mt-2 text-sm opacity-75 line-clamp-3">{{ post.excerpt }}</p>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>
