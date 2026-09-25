<script setup lang="ts">
// Plain-language "where do my files go?" status for Settings → Media, plus the one-click
// move for anything still stored in the database (server/utils/media-migration.ts).
// Re-checks after every settings save, since saving a provider is what makes the move
// possible.

interface MigrationStatus {
  provider: string
  servedByWorker: boolean
  canMigrate: boolean
  pendingMedia: number
  pendingMediaBytes: number
  pendingInline: number
}
interface BatchResult {
  results: { id: string; ok: boolean; error?: string }[]
  nextCursor: string | null
  done: boolean
}

const props = defineProps<{ saving: boolean }>()

const { data: status, refresh } = await useFetch<MigrationStatus>('/api/v1/media/migration', { server: false })

watch(() => props.saving, (now, before) => {
  if (before && !now) refresh()
})

const PROVIDER_LABELS: Record<string, string> = {
  cloudflare: 'Cloudflare Images',
  r2: 'Cloudflare R2',
  s3: 'S3-compatible storage',
  bunny: 'Bunny.net',
}

const connected = computed(() => status.value?.canMigrate === true)
const providerLabel = computed(() => PROVIDER_LABELS[status.value?.provider ?? ''] ?? status.value?.provider ?? '')
const pendingTotal = computed(() => (status.value?.pendingMedia ?? 0) + (status.value?.pendingInline ?? 0))

const running = ref(false)
const processed = ref(0)
const plannedTotal = ref(0)
const movedCount = ref(0)
const failures = ref<{ id: string; error?: string }[]>([])
const finished = ref(false)
const runError = ref('')

async function moveToStorage() {
  running.value = true
  finished.value = false
  runError.value = ''
  failures.value = []
  processed.value = 0
  movedCount.value = 0
  plannedTotal.value = Math.max(pendingTotal.value, 1)
  try {
    // Library files first (which also rewrites every page using them), then any images
    // embedded straight into pages or settings.
    // Each request does a bounded amount of work and says whether its phase is done — a
    // file used on many pages can take several requests, resuming where the last stopped.
    for (const phase of ['media', 'inline'] as const) {
      let cursor: string | null = null
      let done = false
      while (!done) {
        const batch: BatchResult = await $fetch<BatchResult>('/api/v1/media/migration', {
          method: 'POST',
          body: { phase, cursor },
        })
        processed.value += phase === 'media' ? batch.results.length : (batch.nextCursor !== cursor ? 1 : 0)
        movedCount.value += batch.results.filter(r => r.ok).length
        failures.value.push(...batch.results.filter(r => !r.ok).map(r => ({ id: r.id, error: r.error })))
        cursor = batch.nextCursor
        done = batch.done
      }
    }
    finished.value = true
  } catch (e: unknown) {
    runError.value = getErrorMessage(e, 'The move stopped partway through. Nothing already moved is affected — run it again to continue.')
  } finally {
    running.value = false
    await refresh()
  }
}

const progressPercent = computed(() => Math.min(100, Math.round((processed.value / plannedTotal.value) * 100)))

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<template>
  <UCard v-if="status">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon :name="connected ? 'i-lucide-hard-drive' : 'i-lucide-hard-drive-download'" class="w-4 h-4 text-primary-500" />
        <p class="text-sm font-semibold text-gray-900 dark:text-white">Where your files are stored</p>
      </div>
    </template>

    <div class="space-y-4">
      <div v-if="connected" class="flex items-start gap-2 text-sm">
        <UIcon name="i-lucide-circle-check" class="w-4 h-4 mt-0.5 text-green-500 shrink-0" />
        <p class="text-gray-700 dark:text-gray-300">
          New uploads go to <strong>{{ providerLabel }}</strong><template v-if="status.servedByWorker">, served from this site's own address</template>.
          <span v-if="status.servedByWorker" class="block text-xs text-gray-500 mt-1">
            Optional: add a public URL for the bucket in the R2 section below so images load straight from R2.
          </span>
        </p>
      </div>
      <UAlert
        v-else
        icon="i-lucide-triangle-alert"
        color="warning"
        variant="soft"
        title="No file storage connected yet"
        description="Uploads are being kept inside the database, which is fine for trying NuxFlow out but limited to 512 KB per file. The simplest fix: add the MEDIA_BUCKET R2 binding to wrangler.toml (see wrangler.toml.example) and redeploy — nothing else to fill in. Or set up one of the providers below."
      />

      <div v-if="pendingTotal > 0 || finished" class="rounded-lg border border-gray-200 dark:border-gray-800 p-4 space-y-3">
        <template v-if="pendingTotal > 0">
          <p class="text-sm text-gray-700 dark:text-gray-300">
            <strong>{{ status.pendingMedia }}</strong> file{{ status.pendingMedia === 1 ? '' : 's' }}
            <template v-if="status.pendingMediaBytes">({{ formatBytes(status.pendingMediaBytes) }})</template>
            in your media library<template v-if="status.pendingInline">, and images embedded in <strong>{{ status.pendingInline }}</strong> page{{ status.pendingInline === 1 ? '' : 's' }} or setting{{ status.pendingInline === 1 ? '' : 's' }},</template>
            are still stored inside the database.
          </p>
          <p v-if="connected" class="text-xs text-gray-500">
            Moving them to {{ providerLabel }} frees up database space. Every page, draft, and setting using them is updated to the new copy automatically,
            and each file is only removed from the database after its new copy is confirmed working.
          </p>
          <p v-else class="text-xs text-gray-500">Connect storage first, then you can move them in one click.</p>
        </template>

        <div v-if="running" class="space-y-1">
          <UProgress :model-value="progressPercent" />
          <p class="text-xs text-gray-500">Moving… {{ movedCount }} moved so far. You can leave this page open while it works.</p>
        </div>

        <UAlert
          v-if="finished && !running"
          :color="failures.length ? 'warning' : 'success'"
          variant="soft"
          :icon="failures.length ? 'i-lucide-triangle-alert' : 'i-lucide-circle-check'"
          :title="failures.length ? `Moved ${movedCount}, ${failures.length} couldn't be moved` : `Moved ${movedCount} file${movedCount === 1 ? '' : 's'} to ${providerLabel}`"
        >
          <template v-if="failures.length" #description>
            <p class="text-xs">These were left exactly as they were:</p>
            <ul class="text-xs list-disc pl-5 mt-1">
              <li v-for="f in failures.slice(0, 10)" :key="f.id">{{ f.error }}</li>
            </ul>
          </template>
        </UAlert>
        <UAlert v-if="runError" color="error" variant="soft" icon="i-lucide-circle-x" :description="runError" />

        <UButton
          v-if="pendingTotal > 0"
          :disabled="!connected"
          :loading="running"
          icon="i-lucide-arrow-right-left"
          @click="moveToStorage"
        >
          Move to {{ connected ? providerLabel : 'storage' }}
        </UButton>
      </div>
    </div>
  </UCard>
</template>
