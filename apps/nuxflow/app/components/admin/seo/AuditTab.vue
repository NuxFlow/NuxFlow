<script setup lang="ts">
interface AuditIssue { code: string; severity: 'error' | 'warning' | 'info'; message: string }
interface AuditItem { id: string; title: string; path: string; typeName: string | null; issues: AuditIssue[] }
interface SiteCheck { id: string; severity: 'error' | 'warning' | 'info' | 'ok'; message: string }
interface AuditResponse {
  summary: { total: number; indexed: number; withIssues: number; counts: Record<string, number>; truncated: boolean }
  site: SiteCheck[]
  items: AuditItem[]
}

const { data, pending, refresh } = await useFetch<AuditResponse>('/api/v1/seo/audit')

const filter = ref<'problems' | 'all'>('problems')
const visibleItems = computed(() => {
  const items = data.value?.items ?? []
  return filter.value === 'problems' ? items.filter(i => i.issues.some(x => x.severity !== 'info')) : items
})

const SEVERITY_STYLE: Record<string, { icon: string; cls: string }> = {
  error: { icon: 'i-lucide-circle-x', cls: 'text-red-500' },
  warning: { icon: 'i-lucide-triangle-alert', cls: 'text-amber-500' },
  info: { icon: 'i-lucide-info', cls: 'text-gray-400' },
  ok: { icon: 'i-lucide-circle-check', cls: 'text-green-500' },
}

const COUNT_LABELS: Record<string, string> = {
  missing_description: 'Missing description',
  description_too_short: 'Short description',
  description_too_long: 'Long description',
  title_too_long: 'Long title',
  duplicate_title: 'Duplicate title',
  duplicate_description: 'Duplicate description',
  missing_image: 'No share image',
  inline_image: 'Inline (database) image',
  noindex: 'Noindexed',
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="text-sm font-semibold text-gray-900 dark:text-white">SEO audit</p>
          <p v-if="data" class="text-xs text-gray-400 mt-0.5">
            {{ data.summary.total }} published item{{ data.summary.total === 1 ? '' : 's' }} · {{ data.summary.indexed }} indexable · {{ data.summary.withIssues }} with problems
            <span v-if="data.summary.truncated">(newest {{ data.summary.total }} checked)</span>
          </p>
        </div>
        <UButton size="sm" variant="ghost" icon="i-lucide-refresh-cw" :loading="pending" @click="refresh()">Re-run</UButton>
      </div>
    </template>

    <div v-if="data" class="space-y-5">
      <ul class="space-y-1.5">
        <li v-for="c in data.site" :key="c.id" class="flex items-start gap-2 text-sm">
          <UIcon :name="SEVERITY_STYLE[c.severity]!.icon" class="w-4 h-4 mt-0.5 shrink-0" :class="SEVERITY_STYLE[c.severity]!.cls" />
          <span class="text-gray-700 dark:text-gray-300">{{ c.message }}</span>
        </li>
      </ul>

      <div v-if="Object.keys(data.summary.counts).length" class="flex flex-wrap gap-2">
        <template v-for="(n, code) in data.summary.counts" :key="code">
          <UBadge v-if="COUNT_LABELS[code]" color="neutral" variant="soft">{{ COUNT_LABELS[code] }}: {{ n }}</UBadge>
        </template>
      </div>
    </div>
  </UCard>

  <UCard v-if="data">
    <template #header>
      <div class="flex items-center justify-between gap-3">
        <p class="text-sm font-semibold text-gray-900 dark:text-white">Pages</p>
        <USelect
          v-model="filter"
          :items="[{ label: 'With problems', value: 'problems' }, { label: 'All flagged (incl. info)', value: 'all' }]"
          size="sm"
          class="w-48"
        />
      </div>
    </template>

    <div v-if="!visibleItems.length" class="text-center py-10 text-gray-400">
      <UIcon name="i-lucide-party-popper" class="w-8 h-8 mx-auto mb-2 opacity-40" />
      <p class="text-sm">No problems found</p>
    </div>
    <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
      <li v-for="item in visibleItems" :key="item.id" class="py-3">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <NuxtLink :to="`/admin/content/${item.id}`" class="text-sm font-medium text-gray-900 dark:text-white hover:text-primary-500 truncate block">
              {{ item.title }}
            </NuxtLink>
            <p class="text-xs text-gray-400 font-mono truncate">{{ item.path }}<span v-if="item.typeName" class="font-sans"> · {{ item.typeName }}</span></p>
          </div>
          <UButton size="xs" variant="ghost" icon="i-lucide-pencil" :to="`/admin/content/${item.id}`" aria-label="Edit" />
        </div>
        <ul class="mt-1.5 space-y-0.5">
          <li v-for="issue in item.issues" :key="issue.code" class="flex items-start gap-1.5 text-xs">
            <UIcon :name="SEVERITY_STYLE[issue.severity]!.icon" class="w-3.5 h-3.5 mt-0.5 shrink-0" :class="SEVERITY_STYLE[issue.severity]!.cls" />
            <span class="text-gray-600 dark:text-gray-400">{{ issue.message }}</span>
          </li>
        </ul>
      </li>
    </ul>
  </UCard>
</template>
