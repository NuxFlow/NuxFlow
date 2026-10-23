<script setup lang="ts">
// Super Admin → Database: the shared Vectorize index behind smart search and related
// content — which embedding model it uses (decided by the index's size, embeddings.ts)
// and how far the automatic re-embedding (search-index-rebuild.ts) has got.
interface RebuildState {
  status: 'running' | 'done'
  processed: number
  startedAt: string
  finishedAt?: string
  lastError?: string
}
type SearchIndexStatus =
  | { available: false }
  | {
      available: true
      dimensions: number | null
      model: string | null
      multilingual: boolean
      vectorCount: number | null
      indexablePages: number
      rebuild: RebuildState | null
    }

const { run, isRunning } = useAdminAction()
const { data: status, refresh } = await useFetch<SearchIndexStatus>('/api/v1/admin/search-index')

// While a rebuild runs, check back every 20 s (the task does a batch a minute).
let timer: ReturnType<typeof setInterval> | undefined
watch(() => status.value?.available && status.value.rebuild?.status === 'running', (running) => {
  clearInterval(timer)
  if (running) timer = setInterval(() => { void refresh() }, 20_000)
}, { immediate: true })
onBeforeUnmount(() => clearInterval(timer))

const progress = computed(() => {
  const s = status.value
  if (!s?.available || !s.rebuild || !s.indexablePages) return 0
  return Math.min(100, Math.round((s.rebuild.processed / s.indexablePages) * 100))
})

async function rebuild() {
  const next = await run(() => $fetch<SearchIndexStatus>('/api/v1/admin/search-index/rebuild', { method: 'POST' }), {
    successTitle: 'Rebuild started — it runs in the background, a batch every minute',
    errorTitle: "Couldn't start the rebuild",
    key: 'rebuild',
  })
  if (next) status.value = next
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-lg bg-violet-50 dark:bg-violet-900/30 flex items-center justify-center">
          <UIcon name="i-lucide-sparkles" class="w-5 h-5 text-violet-600 dark:text-violet-400" />
        </div>
        <div>
          <p class="font-semibold text-sm text-gray-900 dark:text-white">Smart search index</p>
          <p class="text-xs text-gray-400">Vectorize — AI search and related content, every site on this Worker</p>
        </div>
      </div>
    </template>

    <p v-if="!status?.available" class="text-sm text-gray-500">
      Not set up — there's no Vectorize index bound to this Worker. Keyword search works without it. See the installation guide's "Vectorize semantic search" section.
    </p>

    <div v-else class="space-y-4">
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        <div>
          <p class="text-xs text-gray-400">Languages</p>
          <p class="font-medium">{{ status.multilingual ? 'All languages' : status.model ? 'English only' : 'Unsupported index' }}</p>
        </div>
        <div>
          <p class="text-xs text-gray-400">Model</p>
          <p class="font-medium font-mono text-xs">{{ status.model ?? '—' }}</p>
        </div>
        <div>
          <p class="text-xs text-gray-400">Pages in the index</p>
          <p class="font-medium">{{ status.vectorCount ?? '—' }} of {{ status.indexablePages }}</p>
        </div>
      </div>

      <UAlert
        v-if="!status.model"
        color="error"
        variant="soft"
        icon="i-lucide-alert-triangle"
        title="This index has a size no model here makes"
        :description="`It has ${status.dimensions} dimensions; NuxFlow needs 1024 (all languages) or 768 (English only). Create a new index — see below.`"
      />

      <UAlert
        v-else-if="!status.multilingual"
        color="info"
        variant="soft"
        icon="i-lucide-languages"
        title="Search only understands English well"
      >
        <template #description>
          <p>To search every language, create a new index and point this Worker at it:</p>
          <pre class="mt-2 text-xs bg-gray-100 dark:bg-gray-900 rounded p-2 overflow-x-auto">wrangler vectorize create nuxflow-content-m3 --dimensions=1024 --metric=cosine</pre>
          <p class="mt-2">Then set <code>index_name = "nuxflow-content-m3"</code> in the <code>[[vectorize]]</code> block of wrangler.toml (and every pool's config) and deploy. Every page is re-indexed automatically afterwards.</p>
        </template>
      </UAlert>

      <div v-if="status.rebuild?.status === 'running'" class="space-y-1.5">
        <p class="text-sm text-gray-600 dark:text-gray-300 flex items-center gap-2">
          <UIcon name="i-lucide-loader-2" class="animate-spin" />
          Re-indexing: {{ status.rebuild.processed }} of {{ status.indexablePages }} pages
        </p>
        <div class="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
          <div class="h-full bg-primary-400 rounded-full transition-all" :style="{ width: `${progress}%` }" />
        </div>
        <p v-if="status.rebuild.lastError" class="text-xs text-red-500">Last batch failed, retrying next minute: {{ status.rebuild.lastError }}</p>
      </div>
      <p v-else-if="status.rebuild?.status === 'done'" class="text-xs text-gray-500">
        Last rebuilt {{ formatLocalDateTime(status.rebuild.finishedAt ?? status.rebuild.startedAt) }} ({{ status.rebuild.processed }} pages).
      </p>
    </div>

    <template v-if="status?.available && status.model" #footer>
      <div class="flex justify-end">
        <UButton variant="outline" icon="i-lucide-refresh-cw" :loading="isRunning('rebuild')" @click="rebuild">
          Rebuild index
        </UButton>
      </div>
    </template>
  </UCard>
</template>
