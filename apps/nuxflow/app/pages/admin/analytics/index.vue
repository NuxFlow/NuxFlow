<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })
useHead({ title: 'Analytics' })

interface Report {
  days: 7 | 30 | 90
  views: number
  previousViews: number | null
  series: { day: string; views: number }[]
  pages: { path: string; views: number }[]
  referrers: { host: string; views: number }[]
  countries: { code: string; views: number }[]
  devices: { device: string; views: number }[]
}
interface AnalyticsResponse {
  recording: boolean
  readable: boolean
  report: Report | null
  error: string | null
}

const RANGES = [
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
] as const

const days = ref<7 | 30 | 90>(30)
const { data, error, pending, refresh } = await useFetch<AnalyticsResponse>('/api/v1/analytics', { query: { days } })
const access = useAdminAccessState()
const isSuperAdmin = computed(() => access.value?.isSuperAdmin ?? false)
const report = computed(() => data.value?.report ?? null)

const fmt = (n: number) => n.toLocaleString()
const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })

const change = computed(() => {
  const r = report.value
  if (!r || r.previousViews === null) return null
  if (r.previousViews === 0) return r.views > 0 ? { text: 'New this period', up: true } : null
  const pct = Math.round(((r.views - r.previousViews) / r.previousViews) * 100)
  return { text: `${pct > 0 ? '+' : ''}${pct}% on the previous ${r.days} days`, up: pct >= 0 }
})
const busiest = computed(() => {
  const s = report.value?.series ?? []
  return s.reduce<{ day: string; views: number } | null>((best, d) => (d.views > (best?.views ?? 0) ? d : best), null)
})
const perDay = computed(() => (report.value ? Math.round(report.value.views / report.value.days) : 0))

// ── Views per day ────────────────────────────────────────────────────────────
const CHART_W = 600
const CHART_H = 160
const BAR_GAP = 2
const bars = computed(() => {
  const series = report.value?.series ?? []
  const max = Math.max(1, ...series.map(d => d.views))
  const width = (CHART_W - BAR_GAP * (series.length - 1)) / Math.max(1, series.length)
  return series.map((d, i) => {
    const h = d.views ? Math.max(2, (d.views / max) * CHART_H) : 0
    return { x: i * (width + BAR_GAP), y: CHART_H - h, w: width, h, ...d }
  })
})
const hovered = ref<number | null>(null)
const axisLabels = computed(() => {
  const s = report.value?.series ?? []
  if (!s.length) return []
  return [s[0]!, s[Math.floor(s.length / 2)]!, s.at(-1)!].map(d => dayLabel(d.day))
})

// ── Breakdowns ───────────────────────────────────────────────────────────────
const regionNames = import.meta.client && 'DisplayNames' in Intl ? new Intl.DisplayNames(undefined, { type: 'region' }) : null
function countryName(code: string): string {
  if (code === 'XX' || !code) return 'Unknown'
  if (code === 'T1') return 'Tor network'
  try {
    return regionNames?.of(code) ?? code
  } catch {
    return code
  }
}
function flag(code: string): string {
  if (!/^[A-Z]{2}$/.test(code) || code === 'XX' || code === 'T1') return ''
  return String.fromCodePoint(...[...code].map(c => 0x1F1E6 + c.charCodeAt(0) - 65))
}
const DEVICE_LABELS: Record<string, string> = { desktop: 'Desktop', mobile: 'Phone', tablet: 'Tablet' }

interface Row { label: string; views: number; to?: string; prefix?: string }
const lists = computed<{ title: string; empty: string; rows: Row[] }[]>(() => {
  const r = report.value
  if (!r) return []
  return [
    { title: 'Top pages', empty: 'No page views yet.', rows: r.pages.map(p => ({ label: p.path, views: p.views, to: p.path })) },
    { title: 'Where visitors came from', empty: 'No visits yet.', rows: r.referrers.map(x => ({ label: x.host || 'Direct, or not shared', views: x.views })) },
    { title: 'Countries', empty: 'No visits yet.', rows: r.countries.map(c => ({ label: countryName(c.code), views: c.views, prefix: flag(c.code) })) },
    { title: 'Devices', empty: 'No visits yet.', rows: r.devices.map(d => ({ label: DEVICE_LABELS[d.device] ?? d.device, views: d.views })) },
  ]
})
const share = (rows: Row[], views: number) => `${Math.round((views / Math.max(1, ...rows.map(r => r.views))) * 100)}%`
</script>

<template>
  <div class="max-w-6xl mx-auto space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Analytics</h1>
        <p class="text-sm text-gray-500 mt-0.5">Page views on this site — no cookies, nothing stored about your visitors</p>
      </div>
      <div class="flex items-center gap-2">
        <UFieldGroup>
          <UButton
            v-for="r in RANGES"
            :key="r.value"
            size="sm"
            :variant="days === r.value ? 'solid' : 'outline'"
            :color="days === r.value ? 'primary' : 'neutral'"
            @click="days = r.value"
          >
            {{ r.label }}
          </UButton>
        </UFieldGroup>
        <UButton variant="ghost" size="sm" icon="i-lucide-refresh-cw" :loading="pending" aria-label="Refresh" @click="() => refresh()" />
      </div>
    </div>

    <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-circle-alert" :description="getErrorMessage(error, 'Could not load analytics')" />

    <template v-else-if="data">
      <!-- Not set up -->
      <UCard v-if="!data.readable">
        <div class="space-y-3 text-sm">
          <h2 class="font-semibold text-gray-900 dark:text-white">
            {{ data.recording ? 'Visits are being recorded, but can\'t be shown yet' : 'Visitor analytics aren\'t switched on' }}
          </h2>
          <template v-if="isSuperAdmin">
            <p class="text-gray-500">Two one-off steps for this install, then every site gets its own Analytics page:</p>
            <ol class="list-decimal pl-5 space-y-2 text-gray-600 dark:text-gray-300">
              <li :class="{ 'line-through text-gray-400': data.recording }">
                In <code>wrangler.toml</code>, uncomment the <code>[[analytics_engine_datasets]]</code> block (binding <code>AE</code>) and deploy.
                That starts recording.
              </li>
              <li>
                In <NuxtLink to="/admin/super/platform" class="text-primary-500 hover:underline">Super Admin → Platform</NuxtLink>, under
                <strong>Visitor analytics</strong>, add an API token and your account ID. That lets NuxFlow read the numbers back.
              </li>
            </ol>
          </template>
          <p v-else class="text-gray-500">
            Ask whoever runs this NuxFlow install to switch on visitor analytics. Nothing needs changing on your site.
          </p>
        </div>
      </UCard>

      <template v-else>
        <UAlert
          v-if="!data.recording"
          color="warning"
          variant="soft"
          icon="i-lucide-triangle-alert"
          title="New visits aren't being recorded"
          description="The AE binding isn't in this deployment's wrangler.toml, so only views recorded before it was removed are shown."
        />
        <UAlert v-if="data.error" color="error" variant="soft" icon="i-lucide-circle-alert" :description="data.error" />

        <template v-if="report">
          <div class="grid gap-4 sm:grid-cols-3">
            <UCard>
              <p class="text-xs font-medium text-gray-500">Page views, last {{ report.days }} days</p>
              <p class="mt-1 text-3xl font-bold tabular-nums text-gray-900 dark:text-white">{{ fmt(report.views) }}</p>
              <p v-if="change" class="mt-1 text-xs flex items-center gap-1" :class="change.up ? 'text-green-600 dark:text-green-400' : 'text-gray-500'">
                <UIcon :name="change.up ? 'i-lucide-trending-up' : 'i-lucide-trending-down'" class="size-3.5" />
                {{ change.text }}
              </p>
            </UCard>
            <UCard>
              <p class="text-xs font-medium text-gray-500">Average per day</p>
              <p class="mt-1 text-3xl font-bold tabular-nums text-gray-900 dark:text-white">{{ fmt(perDay) }}</p>
            </UCard>
            <UCard>
              <p class="text-xs font-medium text-gray-500">Busiest day</p>
              <p class="mt-1 text-3xl font-bold tabular-nums text-gray-900 dark:text-white">{{ busiest ? dayLabel(busiest.day) : '—' }}</p>
              <p v-if="busiest" class="mt-1 text-xs text-gray-500">{{ fmt(busiest.views) }} views</p>
            </UCard>
          </div>

          <UCard>
            <figure class="space-y-2">
              <figcaption class="flex items-baseline justify-between text-sm">
                <span class="font-medium text-gray-900 dark:text-white">Page views per day</span>
                <span class="text-xs tabular-nums text-gray-500 min-h-4">
                  <template v-if="hovered !== null && bars[hovered]">{{ dayLabel(bars[hovered]!.day) }}: {{ fmt(bars[hovered]!.views) }} views</template>
                </span>
              </figcaption>
              <svg
                :viewBox="`0 0 ${CHART_W} ${CHART_H}`"
                preserveAspectRatio="none"
                class="w-full h-40 text-primary"
                role="img"
                :aria-label="`Page views per day, ${axisLabels[0]} to ${axisLabels[2]}`"
                @mouseleave="hovered = null"
              >
                <line :x1="0" :x2="CHART_W" :y1="CHART_H - 0.5" :y2="CHART_H - 0.5" class="stroke-gray-200 dark:stroke-gray-700" vector-effect="non-scaling-stroke" />
                <g v-for="(b, i) in bars" :key="b.day" @mouseenter="hovered = i">
                  <!-- Hit target: the whole day's column, not just the bar. -->
                  <rect :x="b.x" y="0" :width="b.w + BAR_GAP" :height="CHART_H" fill="transparent" />
                  <rect
                    v-if="b.h"
                    :x="b.x" :y="b.y" :width="b.w" :height="b.h" rx="2"
                    fill="currentColor"
                    :opacity="hovered !== null && hovered !== i ? 0.45 : 1"
                  />
                  <title>{{ dayLabel(b.day) }}: {{ fmt(b.views) }} views</title>
                </g>
              </svg>
              <div class="flex justify-between text-xs text-gray-400 tabular-nums">
                <span v-for="(l, i) in axisLabels" :key="i">{{ l }}</span>
              </div>
            </figure>
          </UCard>

          <div class="grid gap-4 md:grid-cols-2">
            <UCard v-for="list in lists" :key="list.title">
              <template #header>
                <h2 class="text-sm font-semibold text-gray-900 dark:text-white">{{ list.title }}</h2>
              </template>
              <p v-if="!list.rows.length" class="text-sm text-gray-400">{{ list.empty }}</p>
              <table v-else class="w-full text-sm">
                <thead class="sr-only">
                  <tr><th>{{ list.title }}</th><th>Views</th></tr>
                </thead>
                <tbody>
                  <tr v-for="row in list.rows" :key="row.label">
                    <td class="py-1.5 pr-3 min-w-0">
                      <div class="truncate text-gray-700 dark:text-gray-300">
                        <span v-if="row.prefix" class="mr-1.5" aria-hidden="true">{{ row.prefix }}</span>
                        <NuxtLink v-if="row.to" :to="row.to" target="_blank" class="hover:underline">{{ row.label }}</NuxtLink>
                        <template v-else>{{ row.label }}</template>
                      </div>
                      <div class="mt-1 h-1 rounded-full bg-gray-100 dark:bg-gray-800">
                        <div class="h-1 rounded-full bg-primary" :style="{ width: share(list.rows, row.views) }" />
                      </div>
                    </td>
                    <td class="py-1.5 text-right tabular-nums text-gray-900 dark:text-white align-top w-16">{{ fmt(row.views) }}</td>
                  </tr>
                </tbody>
              </table>
            </UCard>
          </div>

          <p class="text-xs text-gray-400">
            Counted when a page finishes loading in a visitor's browser. Bots, sign-in and admin pages, and missing pages aren't counted,
            and neither are visitors who block scripts. Days are UTC. New visits show within a few minutes, and Cloudflare keeps them for 3 months.
            On very busy sites Cloudflare samples, so large numbers are close estimates.
          </p>
        </template>
      </template>
    </template>
  </div>
</template>
