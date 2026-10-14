<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })
useHead({ title: 'Usage' })

type MetricKey = 'views' | 'renders' | 'api' | 'ai_calls' | 'emails'
  | 'storage_bytes' | 'content_items' | 'team_members' | 'site_members' | 'plugins'

interface SiteUsage {
  id: string
  name: string
  domain: string
  status: string
  isPrimary: boolean
  usage: Record<MetricKey, number>
  snapshotDay: string | null
}
interface UsageResponse {
  month: string
  from: string
  to: string
  sites: SiteUsage[]
}
interface TrendResponse {
  site: { id: string; name: string; domain: string }
  days: string[]
  series: Record<MetricKey, (number | null)[]>
}

const METRICS: { key: MetricKey; label: string; hint: string; bytes?: boolean }[] = [
  { key: 'views', label: 'Views', hint: 'Public page requests, cached or not' },
  { key: 'renders', label: 'Renders', hint: 'Pages built by the server — the best stand-in for CPU time' },
  { key: 'api', label: 'API', hint: 'Requests to the site’s /api routes' },
  { key: 'ai_calls', label: 'AI calls', hint: 'Text, image, transcription and speech' },
  { key: 'emails', label: 'Emails', hint: 'Recipients a provider accepted' },
  { key: 'storage_bytes', label: 'Storage', hint: 'Media library size (nightly)', bytes: true },
  { key: 'content_items', label: 'Pages', hint: 'Pages, posts and other content (nightly)' },
  { key: 'team_members', label: 'Team', hint: 'Author role and above (nightly)' },
  { key: 'site_members', label: 'Members', hint: 'Member and viewer roles (nightly)' },
  { key: 'plugins', label: 'Plugins', hint: 'Installed plugins (nightly)' },
]
const EVENT_METRICS = METRICS.slice(0, 5)

const month = ref(new Date().toISOString().slice(0, 7))
const { data, pending, error, refresh } = await useFetch<UsageResponse>('/api/v1/admin/usage', { query: { month } })

const sortKey = ref<MetricKey | 'name'>('views')
const sortDesc = ref(true)
function sortBy(key: MetricKey | 'name') {
  if (sortKey.value === key) sortDesc.value = !sortDesc.value
  else { sortKey.value = key; sortDesc.value = key !== 'name' }
}

const rows = computed(() => {
  const list = [...(data.value?.sites ?? [])]
  const dir = sortDesc.value ? -1 : 1
  return list.sort((a, b) => sortKey.value === 'name'
    ? dir * a.name.localeCompare(b.name)
    : dir * (a.usage[sortKey.value] - b.usage[sortKey.value]))
})

const totals = computed(() => Object.fromEntries(EVENT_METRICS.map(m => [
  m.key, (data.value?.sites ?? []).reduce((sum, s) => sum + s.usage[m.key], 0),
])) as Record<MetricKey, number>)

function format(value: number | null | undefined, bytes?: boolean): string {
  if (value === null || value === undefined) return '—'
  return bytes ? formatBytes(value) : value.toLocaleString()
}

// Nightly totals show — until the first snapshot has been taken for the site.
function cell(site: SiteUsage, metric: typeof METRICS[number]): string {
  if (!site.snapshotDay && !EVENT_METRICS.includes(metric)) return '—'
  return format(site.usage[metric.key], metric.bytes)
}

// ── One site's 30-day trend ──────────────────────────────────────────────────
const selectedSiteId = ref<string | null>(null)
const trend = ref<TrendResponse | null>(null)
const trendError = ref<string | null>(null)
const trendLoading = ref(false)

async function showTrend(siteId: string) {
  if (selectedSiteId.value === siteId) {
    selectedSiteId.value = null
    return
  }
  selectedSiteId.value = siteId
  trend.value = null
  trendError.value = null
  trendLoading.value = true
  try {
    const url: string = `/api/v1/admin/usage/${siteId}`
    trend.value = await $fetch<TrendResponse>(url, { query: { days: 30 } })
  } catch (err) {
    trendError.value = getErrorMessage(err, 'Could not load this site’s trend')
  } finally {
    trendLoading.value = false
  }
}

const CHART_W = 300
const CHART_H = 64
const BAR_GAP = 2
function bars(values: (number | null)[]) {
  const max = Math.max(1, ...values.map(v => v ?? 0))
  const width = (CHART_W - BAR_GAP * (values.length - 1)) / values.length
  return values.map((v, i) => {
    const h = v ? Math.max(2, (v / max) * CHART_H) : 0
    return { x: i * (width + BAR_GAP), y: CHART_H - h, w: width, h, value: v ?? 0 }
  })
}
const hovered = ref<{ metric: MetricKey; index: number } | null>(null)
</script>

<template>
  <div class="max-w-6xl mx-auto space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Usage</h1>
        <p class="text-sm text-gray-500 mt-0.5">What each site uses, per calendar month (UTC)</p>
      </div>
      <div class="flex items-center gap-2">
        <UInput v-model="month" type="month" aria-label="Month" />
        <UButton variant="ghost" icon="i-lucide-refresh-cw" :loading="pending" @click="() => refresh()">Refresh</UButton>
      </div>
    </div>

    <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-circle-alert" :description="getErrorMessage(error, 'Could not load usage')" />

    <template v-else-if="data">
      <div class="grid gap-4 grid-cols-2 sm:grid-cols-5">
        <UCard v-for="m in EVENT_METRICS" :key="m.key">
          <p class="text-xs text-gray-500">{{ m.label }}</p>
          <p class="text-2xl font-semibold text-gray-900 dark:text-white mt-1">{{ format(totals[m.key]) }}</p>
        </UCard>
      </div>

      <UCard>
        <template #header>
          <p class="text-sm font-semibold text-gray-900 dark:text-white">By site</p>
          <p class="text-xs text-gray-500 mt-0.5">Select a site to see its last 30 days. Select a column heading to sort.</p>
        </template>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-xs text-gray-500 border-b border-gray-100 dark:border-gray-800">
                <th class="py-2 pr-3 font-medium">
                  <button type="button" class="inline-flex items-center gap-1 hover:text-gray-900 dark:hover:text-white" @click="sortBy('name')">
                    Site
                    <UIcon v-if="sortKey === 'name'" :name="sortDesc ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up'" class="size-3" />
                  </button>
                </th>
                <th v-for="m in METRICS" :key="m.key" class="py-2 px-2 font-medium text-right whitespace-nowrap" :title="m.hint" :aria-sort="sortKey === m.key ? (sortDesc ? 'descending' : 'ascending') : 'none'">
                  <button type="button" class="inline-flex items-center gap-1 hover:text-gray-900 dark:hover:text-white" @click="sortBy(m.key)">
                    {{ m.label }}
                    <UIcon v-if="sortKey === m.key" :name="sortDesc ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up'" class="size-3" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <template v-for="site in rows" :key="site.id">
                <tr class="border-b border-gray-50 dark:border-gray-900" :class="selectedSiteId === site.id ? 'bg-gray-50 dark:bg-gray-900' : ''">
                  <td class="py-2 pr-3">
                    <button type="button" class="text-left" :aria-expanded="selectedSiteId === site.id" @click="showTrend(site.id)">
                      <span class="font-medium text-gray-900 dark:text-white hover:underline">{{ site.name }}</span>
                      <UBadge v-if="site.isPrimary" size="sm" variant="subtle" class="ml-1">Primary</UBadge>
                      <UBadge v-if="site.status !== 'active'" size="sm" color="warning" variant="subtle" class="ml-1">{{ site.status }}</UBadge>
                      <span class="block text-xs text-gray-400">{{ site.domain }}</span>
                    </button>
                  </td>
                  <td v-for="m in METRICS" :key="m.key" class="py-2 px-2 text-right tabular-nums text-gray-700 dark:text-gray-300">
                    {{ cell(site, m) }}
                  </td>
                </tr>
                <tr v-if="selectedSiteId === site.id">
                  <td :colspan="METRICS.length + 1" class="py-4 px-1">
                    <p v-if="trendLoading" class="text-sm text-gray-400">Loading…</p>
                    <p v-else-if="trendError" class="text-sm text-red-600 dark:text-red-400">{{ trendError }}</p>
                    <div v-else-if="trend" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <figure v-for="m in EVENT_METRICS" :key="m.key" class="space-y-1">
                        <figcaption class="flex items-baseline justify-between text-xs">
                          <span class="font-medium text-gray-700 dark:text-gray-300">{{ m.label }}, last 30 days</span>
                          <span class="tabular-nums text-gray-500">
                            <template v-if="hovered?.metric === m.key">
                              {{ trend.days[hovered.index] }}: {{ format(trend.series[m.key][hovered.index]) }}
                            </template>
                            <template v-else>{{ format(trend.series[m.key].reduce<number>((s, v) => s + (v ?? 0), 0)) }} total</template>
                          </span>
                        </figcaption>
                        <svg
                          :viewBox="`0 0 ${CHART_W} ${CHART_H}`"
                          class="w-full h-16 text-primary"
                          role="img"
                          :aria-label="`${m.label} per day for ${trend.site.name}, ${trend.days[0]} to ${trend.days.at(-1)}`"
                          @mouseleave="hovered = null"
                        >
                          <line :x1="0" :x2="CHART_W" :y1="CHART_H - 0.5" :y2="CHART_H - 0.5" class="stroke-gray-200 dark:stroke-gray-700" />
                          <g v-for="(b, i) in bars(trend.series[m.key])" :key="i" @mouseenter="hovered = { metric: m.key, index: i }">
                            <!-- Hit target: the whole day's column, not just the bar. -->
                            <rect :x="b.x" y="0" :width="b.w + BAR_GAP" :height="CHART_H" fill="transparent" />
                            <rect
                              v-if="b.h"
                              :x="b.x" :y="b.y" :width="b.w" :height="b.h" rx="1.5"
                              fill="currentColor"
                              :opacity="hovered && (hovered.metric !== m.key || hovered.index !== i) ? 0.45 : 1"
                            />
                            <title>{{ trend.days[i] }}: {{ format(b.value) }}</title>
                          </g>
                        </svg>
                      </figure>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </UCard>

      <p class="text-xs text-gray-400">
        Views, renders, API requests, AI calls and emails are counted as they happen and can lag by about a minute.
        Storage, pages, team, members and plugins are totals taken each night at 3 AM UTC
        (— means no total has been taken yet). CPU time can't be measured from inside the Worker; renders are the stand-in.
      </p>
    </template>
  </div>
</template>
