<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import type { SpacingValue } from '../types'
import { spacingToCss } from '../utils/spacing'
import NuxImage from './NuxImage.vue'
import { useCanvasHost, type CanvasPostFilter, type CanvasPostItem, type CanvasPostsQuery } from '../host'

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
  /** The type's custom fields on each card (Admin → Content types). */
  showDetails?: boolean
  /** Filter and sort controls for the type's "Use as a filter" fields. */
  showFilters?: boolean
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
  showDetails: true,
  showFilters: false,
  bgColor: '',
  textColor: '',
  padding: undefined,
})

const containerStyle = computed(() => ({
  backgroundColor: props.bgColor || 'transparent',
  color: props.textColor || 'inherit',
  padding: spacingToCss(props.padding, '60px 24px'),
}))

type PostItem = CanvasPostItem
const host = useCanvasHost()

const posts = ref<PostItem[]>([])
const loading = ref(true)
const failed = ref(false)

// ── Filters (server/utils/field-filters.ts in NuxFlow) ──────────────────────
// Each control writes its `f.<key>` query value here; empty values are left out.
const filterDefs = ref<CanvasPostFilter[]>([])
const filterValues = ref<Record<string, string>>({})
const sort = ref('')
const filtersOn = computed(() => props.showFilters && Boolean(props.contentType?.trim()))
const numberFilters = computed(() => filterDefs.value.filter(f => f.type === 'number'))

function setFilter(name: string, value: string) {
  const rest = Object.fromEntries(Object.entries(filterValues.value).filter(([k]) => k !== name))
  filterValues.value = value.trim() ? { ...rest, [name]: value.trim() } : rest
}
function toggleChoice(key: string, option: string, on: boolean) {
  const current = (filterValues.value[`f.${key}`] ?? '').split(',').filter(Boolean)
  setFilter(`f.${key}`, (on ? [...current, option] : current.filter(o => o !== option)).join(','))
}
function isChosen(key: string, option: string): boolean {
  return (filterValues.value[`f.${key}`] ?? '').split(',').includes(option)
}
function clearFilters() {
  filterValues.value = {}
  sort.value = ''
}
const hasActiveFilters = computed(() => Object.keys(filterValues.value).length > 0 || Boolean(sort.value))

async function loadFilters() {
  filterDefs.value = []
  if (!filtersOn.value || !host.listPostFilters) return
  try {
    filterDefs.value = await host.listPostFilters(props.contentType!.trim())
  } catch (err) {
    console.error('Failed to load filters:', err)
  }
}

const query = computed(() => {
  const q: CanvasPostsQuery = { limit: Math.min(Math.max(props.limit || 6, 1), 50) }
  if (props.contentType?.trim()) q.type = props.contentType.trim()
  if (props.taxonomy?.trim() && props.term?.trim()) {
    q.taxonomy = props.taxonomy.trim()
    q.term = props.term.trim()
  }
  if (filtersOn.value) {
    if (Object.keys(filterValues.value).length) q.filters = { ...filterValues.value }
    if (sort.value) q.sort = sort.value
  }
  return q
})

async function load() {
  loading.value = true
  failed.value = false
  try {
    posts.value = await host.listPosts(query.value)
  } catch (err) {
    console.error('Failed to load posts:', err)
    failed.value = true
    posts.value = []
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  load()
  loadFilters()
})
watch(() => [props.showFilters, props.contentType], loadFilters)
// Re-query live while the block's filters are edited in the Canvas editor.
watch(() => JSON.stringify(query.value), load)

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

      <form
        v-if="filtersOn && (filterDefs.length || numberFilters.length)"
        role="search"
        aria-label="Filter the list"
        class="canvas-posts-filters mb-8 flex flex-wrap items-end gap-4 rounded-xl border border-current/15 p-4 text-sm"
        @submit.prevent
      >
        <template v-for="f in filterDefs" :key="f.key">
          <fieldset v-if="f.type === 'number'" class="flex items-end gap-2">
            <legend class="mb-1 font-medium">{{ f.label }}<span v-if="f.suffix" class="opacity-60"> ({{ f.suffix }})</span></legend>
            <label class="sr-only" :for="`posts-${f.key}-min`">{{ f.label }} from</label>
            <input
              :id="`posts-${f.key}-min`"
              type="number"
              inputmode="decimal"
              :placeholder="`${f.prefix ?? ''}Min`"
              :value="filterValues[`f.${f.key}.min`] ?? ''"
              class="w-28 rounded-md border border-current/20 bg-transparent px-2 py-1.5"
              @change="setFilter(`f.${f.key}.min`, ($event.target as HTMLInputElement).value)"
            >
            <span aria-hidden="true" class="pb-1.5 opacity-60">–</span>
            <label class="sr-only" :for="`posts-${f.key}-max`">{{ f.label }} up to</label>
            <input
              :id="`posts-${f.key}-max`"
              type="number"
              inputmode="decimal"
              :placeholder="`${f.prefix ?? ''}Max`"
              :value="filterValues[`f.${f.key}.max`] ?? ''"
              class="w-28 rounded-md border border-current/20 bg-transparent px-2 py-1.5"
              @change="setFilter(`f.${f.key}.max`, ($event.target as HTMLInputElement).value)"
            >
          </fieldset>
          <label v-else-if="f.type === 'boolean'" class="flex items-center gap-2 pb-1.5">
            <input
              type="checkbox"
              :checked="filterValues[`f.${f.key}`] === '1'"
              @change="setFilter(`f.${f.key}`, ($event.target as HTMLInputElement).checked ? '1' : '')"
            >
            {{ f.label }}
          </label>
          <label v-else-if="f.type === 'select'" class="flex flex-col gap-1">
            <span class="font-medium">{{ f.label }}</span>
            <select
              :value="filterValues[`f.${f.key}`] ?? ''"
              class="rounded-md border border-current/20 bg-transparent px-2 py-1.5"
              @change="setFilter(`f.${f.key}`, ($event.target as HTMLSelectElement).value)"
            >
              <option value="">Any</option>
              <option v-for="o in f.options ?? []" :key="o" :value="o">{{ o }}</option>
            </select>
          </label>
          <fieldset v-else-if="f.type === 'multiselect'" class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <legend class="mb-1 font-medium">{{ f.label }}</legend>
            <label v-for="o in f.options ?? []" :key="o" class="flex items-center gap-1.5">
              <input type="checkbox" :checked="isChosen(f.key, o)" @change="toggleChoice(f.key, o, ($event.target as HTMLInputElement).checked)">
              {{ o }}
            </label>
          </fieldset>
        </template>
        <label v-if="numberFilters.length" class="flex flex-col gap-1">
          <span class="font-medium">Sort by</span>
          <select v-model="sort" class="rounded-md border border-current/20 bg-transparent px-2 py-1.5">
            <option value="">Newest first</option>
            <template v-for="f in numberFilters" :key="f.key">
              <option :value="`f.${f.key}`">{{ f.label }}: low to high</option>
              <option :value="`-f.${f.key}`">{{ f.label }}: high to low</option>
            </template>
          </select>
        </label>
        <button v-if="hasActiveFilters" type="button" class="pb-1.5 underline opacity-80 hover:opacity-100" @click="clearFilters">Clear</button>
      </form>

      <div v-if="loading" class="flex justify-center py-12">
        <div class="animate-spin rounded-full h-8 w-8 border-2 border-primary-500 border-t-transparent" />
      </div>

      <p v-else-if="failed || posts.length === 0" class="text-center py-12 text-sm opacity-60">
        {{ failed ? 'Posts could not be loaded.' : hasActiveFilters ? 'Nothing matches those filters.' : 'Nothing has been published here yet.' }}
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
            <dl v-if="showDetails && post.details?.length" class="canvas-posts-details mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <div v-for="d in post.details" :key="d.key" class="flex gap-1">
                <dt class="opacity-60">{{ d.label }}:</dt>
                <dd class="font-medium">{{ d.text }}</dd>
              </div>
            </dl>
            <p v-if="showExcerpt && post.excerpt" class="mt-2 text-sm opacity-75 line-clamp-3">{{ post.excerpt }}</p>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>
