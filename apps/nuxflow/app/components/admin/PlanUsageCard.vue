<script setup lang="ts">
// The site's hosting plan and how much of each limit it uses — shown to admins only, and
// only when the site's plan sets limits (the built-in unlimited plan shows nothing).

interface PlanLimitUsage {
  key: string
  label: string
  kind: 'hard' | 'soft'
  monthly: boolean
  unit: 'bytes' | 'count'
  used: number
  max: number
}
interface SitePlanSummary {
  plan: { id: string; name: string; description: string } | null
  limits: PlanLimitUsage[]
}

const access = await fetchAdminAccess()
const isAdmin = roleAtLeast(access?.role, 'admin') || Boolean(access?.isSuperAdmin)

const { data } = await useFetch<SitePlanSummary>('/api/v1/site-plan', {
  immediate: isAdmin,
  headers: useRequestHeaders(['cookie', 'host']),
})

const limits = computed(() => data.value?.limits ?? [])

function format(value: number, unit: PlanLimitUsage['unit']): string {
  return unit === 'bytes' ? formatBytes(value) : value.toLocaleString()
}

// The bar is only drawn when max > 0.
function percent(l: PlanLimitUsage): number {
  return Math.min(100, Math.round((l.used / l.max) * 100))
}

/** Hard limits that are full stop working; soft ones only inform. A limit of 0 is "not included", not full. */
function state(l: PlanLimitUsage): { label: string; icon: string; tone: string } | null {
  if (l.max === 0) return null
  const pct = (l.used / l.max) * 100
  if (pct >= 100) {
    return l.kind === 'hard'
      ? { label: l.monthly ? 'Used up until the 1st' : 'Full', icon: 'i-lucide-octagon-alert', tone: 'text-red-600 dark:text-red-400' }
      : { label: 'Over the plan', icon: 'i-lucide-info', tone: 'text-amber-600 dark:text-amber-400' }
  }
  if (pct >= 80) return { label: 'Nearly full', icon: 'i-lucide-triangle-alert', tone: 'text-amber-600 dark:text-amber-400' }
  return null
}

function barClass(l: PlanLimitUsage): string {
  const pct = (l.used / l.max) * 100
  if (pct >= 100 && l.kind === 'hard') return 'bg-red-500'
  if (pct >= 80) return 'bg-amber-500'
  return 'bg-primary'
}
</script>

<template>
  <UCard v-if="isAdmin && data?.plan && limits.length">
    <template #header>
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <p class="text-sm font-semibold text-gray-900 dark:text-white">Your plan: {{ data.plan.name }}</p>
        <p class="text-xs text-gray-500">Monthly allowances reset on the 1st (UTC)</p>
      </div>
    </template>
    <ul class="grid gap-4 sm:grid-cols-2">
      <li v-for="l in limits" :key="l.key" class="space-y-1.5">
        <div class="flex items-baseline justify-between gap-2 text-sm">
          <span class="text-gray-700 dark:text-gray-300">{{ l.label }}</span>
          <span v-if="l.max === 0" class="text-gray-500">Not included in your plan</span>
          <span v-else class="tabular-nums text-gray-900 dark:text-white">{{ format(l.used, l.unit) }} <span class="text-gray-500">of {{ format(l.max, l.unit) }}</span></span>
        </div>
        <div
          v-if="l.max > 0"
          class="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden"
          role="meter"
          :aria-label="l.label"
          :aria-valuenow="l.used"
          aria-valuemin="0"
          :aria-valuemax="l.max"
          :aria-valuetext="`${format(l.used, l.unit)} of ${format(l.max, l.unit)}`"
        >
          <div class="h-full rounded-full" :class="barClass(l)" :style="{ width: `${percent(l)}%` }" />
        </div>
        <p v-if="state(l)" class="flex items-center gap-1 text-xs" :class="state(l)!.tone">
          <UIcon :name="state(l)!.icon" class="size-3.5" />
          {{ state(l)!.label }}
        </p>
      </li>
    </ul>
  </UCard>
</template>
