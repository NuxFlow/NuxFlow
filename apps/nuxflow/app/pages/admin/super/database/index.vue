<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })
useHead({ title: 'Database' })

interface SiteSizeStats {
  siteId: string
  siteName: string
  siteDomain: string
  contentItemCount: number
  contentBytes: number
  revisionCount: number
  revisionBytes: number
  mediaCount: number
  mediaBytes: number
  localFallbackMediaCount: number
  approxTotalBytes: number
}
interface D1Stats {
  approxDatabaseSizeBytes: number
  paidPlanSizeCapBytes: number
  sites: SiteSizeStats[]
}

const { data: stats, pending: statsPending, error: statsError, refresh: refreshStats } = await useFetch<D1Stats>('/api/v1/admin/db-stats')

const capUsagePercent = computed(() => {
  if (!stats.value || !stats.value.paidPlanSizeCapBytes) return 0
  return Math.min(100, (stats.value.approxDatabaseSizeBytes / stats.value.paidPlanSizeCapBytes) * 100)
})
const capUsageColor = computed(() => {
  if (capUsagePercent.value >= 85) return 'error'
  if (capUsagePercent.value >= 60) return 'warning'
  return 'success'
})

const sitesWithLocalFallback = computed(() => (stats.value?.sites ?? []).filter(s => s.localFallbackMediaCount > 0))

const sizeColumns = [
  { accessorKey: 'siteName', header: 'Site' },
  { accessorKey: 'content', header: 'Content' },
  { accessorKey: 'revisions', header: 'Revisions' },
  { accessorKey: 'media', header: 'Media' },
  { accessorKey: 'approxTotalBytes', header: 'Approx. size' },
]

const downloading = ref(false)
const downloadError = ref('')
const lastExport = ref<{ tableCount: number; rowCount: number; at: string } | null>(null)

async function downloadExport() {
  downloading.value = true
  downloadError.value = ''
  try {
    const res = await fetch('/api/v1/admin/db-export')
    if (!res.ok) {
      const data = await res.json().catch(() => null) as { message?: string } | null
      throw new Error(data?.message ?? `Export failed (${res.status})`)
    }

    // The export streams straight to this response as it's generated (see
    // db-export.get.ts) rather than being buffered and returned all at once — a large
    // database used to crash the Worker's own memory limit that way. That means table/row
    // counts aren't known until the stream finishes, so they can't be response headers
    // (those are sent before the body); they, and any mid-stream failure, come back as a
    // trailing SQL comment instead. A mid-stream failure still returns HTTP 200 (the
    // status line was already committed before the failure happened), so it has to be
    // detected from the body text, not res.ok.
    const blob = await res.blob()
    const text = await blob.text()

    const failed = text.match(/-- EXPORT FAILED: (.+)/)
    if (failed) throw new Error(failed[1])

    // A response with neither the completion trailer nor an EXPORT FAILED marker means
    // the connection or the server process died mid-stream before either could be
    // written (e.g. the Worker's own isolate memory limit killed it outright — see
    // d1-export.ts) — the file the browser just saved is truncated, so this must not be
    // reported as a successful export.
    const summary = text.match(/-- Exported (\d+) tables?, (\d+) rows?/)
    if (!summary) {
      throw new Error('Export response was incomplete — the connection dropped or the server ran out of memory mid-export before finishing. The downloaded file is truncated; do not restore it. Try again, or use `wrangler d1 export` from the CLI instead.')
    }
    const tableCount = Number(summary[1])
    const rowCount = Number(summary[2])

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `nuxflow-d1-export-${new Date().toISOString().slice(0, 10)}.sql`
    a.click()
    URL.revokeObjectURL(url)

    lastExport.value = { tableCount, rowCount, at: new Date().toLocaleString() }
  } catch (e: unknown) {
    downloadError.value = e instanceof Error ? e.message : 'Export failed. Try again.'
  } finally {
    downloading.value = false
  }
}
</script>

<template>
  <div class="max-w-4xl mx-auto space-y-6">
    <div>
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Database</h1>
      <p class="text-sm text-gray-500 mt-0.5">Instance-wide D1 size, per-site breakdown, and a raw SQL export</p>
    </div>

    <!-- Database size -->
    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
              <UIcon name="i-lucide-gauge" class="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p class="font-semibold text-sm text-gray-900 dark:text-white">Approximate database size</p>
              <p class="text-xs text-gray-400">Every site sharing this D1 instance</p>
            </div>
          </div>
          <UButton icon="i-lucide-refresh-cw" variant="ghost" size="xs" :loading="statsPending" @click="refreshStats()" />
        </div>
      </template>

      <div v-if="statsError" class="text-sm text-red-500">Failed to load database stats.</div>
      <div v-else-if="stats" class="space-y-4">
        <div class="flex items-baseline justify-between">
          <span class="text-2xl font-bold text-gray-900 dark:text-white">{{ formatBytes(stats.approxDatabaseSizeBytes) }}</span>
          <span class="text-xs text-gray-400">of {{ formatBytes(stats.paidPlanSizeCapBytes) }} paid-plan cap per database</span>
        </div>
        <UProgress :model-value="capUsagePercent" :color="capUsageColor" size="sm" />
        <p v-if="capUsagePercent >= 60" class="text-xs" :class="capUsagePercent >= 85 ? 'text-red-500' : 'text-amber-500'">
          {{ capUsagePercent >= 85 ? 'Approaching the 10 GB cap — plan a new Worker+D1 pool for new tenants soon.' : 'Past halfway to the 10 GB cap — worth planning ahead for a second pool.' }}
        </p>
        <p class="text-xs text-gray-400">
          D1 doesn't expose real on-disk size to a Worker — this sums content, revisions, and media column sizes only (the actual database is somewhat larger). Use it as an early-warning trend, not an exact figure.
        </p>
      </div>

      <!-- Local media fallback warning -->
      <UAlert
        v-if="sitesWithLocalFallback.length"
        class="mt-4"
        icon="i-lucide-triangle-alert"
        color="warning"
        variant="soft"
        :title="`${sitesWithLocalFallback.length} site${sitesWithLocalFallback.length === 1 ? '' : 's'} storing media directly in D1`"
      >
        <template #description>
          <span class="text-gray-800 dark:text-gray-200">
            No real media provider is configured for: <strong>{{ sitesWithLocalFallback.map(s => s.siteDomain).join(', ') }}</strong>.
            Uploads are falling back to base64-in-D1 (512 KB/file cap) instead of R2/Cloudflare Images/S3/Bunny — the single biggest avoidable contributor to database size. Configure a provider in that site's Settings → Media.
          </span>
        </template>
      </UAlert>

      <!-- Per-site breakdown -->
      <div v-if="stats?.sites.length" class="mt-4 overflow-x-auto">
        <UTable :data="stats.sites" :columns="sizeColumns">
          <template #siteName-cell="{ row }">
            <div>
              <p class="font-medium text-gray-900 dark:text-white text-sm">{{ row.original.siteName }}</p>
              <p class="text-xs text-gray-400">{{ row.original.siteDomain }}</p>
            </div>
          </template>
          <template #content-cell="{ row }">
            <span class="text-sm text-gray-600 dark:text-gray-300">{{ row.original.contentItemCount }} items · {{ formatBytes(row.original.contentBytes) }}</span>
          </template>
          <template #revisions-cell="{ row }">
            <span class="text-sm text-gray-600 dark:text-gray-300">{{ row.original.revisionCount }} · {{ formatBytes(row.original.revisionBytes) }}</span>
          </template>
          <template #media-cell="{ row }">
            <span class="text-sm text-gray-600 dark:text-gray-300">
              {{ row.original.mediaCount }} · {{ formatBytes(row.original.mediaBytes) }}
              <UBadge v-if="row.original.localFallbackMediaCount" color="warning" variant="subtle" size="xs" class="ml-1">local fallback</UBadge>
            </span>
          </template>
          <template #approxTotalBytes-cell="{ row }">
            <span class="text-sm font-medium text-gray-900 dark:text-white">{{ formatBytes(row.original.approxTotalBytes) }}</span>
          </template>
        </UTable>
        <p class="text-xs text-gray-400 mt-2">
          Approximate — sums content/revision/media column sizes only, not every table or row overhead. Use it to compare sites against each other, not as an exact size audit.
        </p>
      </div>
    </UCard>

    <!-- SQL export -->
    <UCard>
      <template #header>
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-lg bg-purple-50 dark:bg-purple-900/30 flex items-center justify-center">
            <UIcon name="i-lucide-database" class="w-5 h-5 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <p class="font-semibold text-sm text-gray-900 dark:text-white">Export whole database</p>
            <p class="text-xs text-gray-400">Every site's data, in one restorable .sql file</p>
          </div>
        </div>
      </template>

      <div class="space-y-4">
        <UAlert icon="i-lucide-info" color="primary" variant="soft">
          <template #title>
            <span class="text-primary-900 dark:text-primary-200 font-semibold">What this is</span>
          </template>
          <template #description>
            <span class="text-gray-800 dark:text-gray-200">
              A plain SQL dump of every table in this D1 database — schema and data for
              <strong>all sites</strong>, not just the one you're currently viewing. This is the
              database-level equivalent of the offline backups you'd take of a VPS's own database;
              it's separate from the per-site .zip backup under Admin → Import & Backup, which only
              covers the current site and is meant for moving/restoring content, not full disaster recovery.
            </span>
          </template>
        </UAlert>

        <div class="grid grid-cols-1 gap-2 text-sm">
          <div class="flex items-start gap-2 text-gray-800 dark:text-gray-200">
            <UIcon name="i-lucide-check" class="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
            <span>Sensitive settings (API keys, OAuth secrets) stay encrypted in this file — unlike the per-site .zip backup, nothing is decrypted to plaintext here.</span>
          </div>
          <div class="flex items-start gap-2 text-gray-800 dark:text-gray-200">
            <UIcon name="i-lucide-check" class="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
            <span>Self-contained — restoring it recreates the exact schema (tables, indexes, triggers) alongside the data.</span>
          </div>
        </div>

        <UAlert icon="i-lucide-terminal" color="neutral" variant="soft">
          <template #title>
            <span class="font-semibold">Restoring this file</span>
          </template>
          <template #description>
            <span class="text-gray-800 dark:text-gray-200">
              NuxFlow doesn't restore raw SQL from the admin UI — use Cloudflare's own tooling:
            </span>
            <pre class="mt-2 text-xs bg-gray-900 text-gray-100 rounded-lg p-3 overflow-x-auto">wrangler d1 execute &lt;database-name&gt; --remote --file=nuxflow-d1-export-....sql</pre>
          </template>
        </UAlert>

        <UAlert icon="i-lucide-shield-alert" color="warning" variant="soft">
          <template #title>
            <span class="font-semibold">Every site's data, in one file</span>
          </template>
          <template #description>
            <span class="text-gray-800 dark:text-gray-200">
              This is why the option only exists here, for super admins — a regular site admin's own backup (Admin → Import & Backup) never includes other tenants' rows. Store this file as securely as you would a full database credential.
            </span>
          </template>
        </UAlert>

        <UAlert v-if="downloadError" icon="i-lucide-circle-x" color="error" variant="soft" :description="downloadError" />

        <UAlert
          v-if="lastExport"
          icon="i-lucide-circle-check"
          color="success"
          variant="soft"
          title="Export downloaded"
          :description="`${lastExport.tableCount} tables, ${lastExport.rowCount} rows — ${lastExport.at}`"
        />
      </div>

      <template #footer>
        <div class="flex justify-end">
          <UButton icon="i-lucide-download" :loading="downloading" @click="downloadExport">
            Download .sql export
          </UButton>
        </div>
      </template>
    </UCard>
  </div>
</template>
