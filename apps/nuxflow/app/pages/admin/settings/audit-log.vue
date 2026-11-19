<script setup lang="ts">
import type { AuditLogEntry } from '#shared/lib/site-admin-types'
definePageMeta({ layout: 'admin', middleware: ['auth'] })

const PAGE_SIZE = 200
const page = ref(1)
const accumulated = ref<AuditLogEntry[]>([])
const hasMore = ref(false)
const loadingMore = ref(false)

const { data } = await useFetch<{ logs: AuditLogEntry[] }>('/api/v1/audit-log', {
  query: { page: '1', limit: String(PAGE_SIZE) },
})

watch(data, (val) => {
  accumulated.value = val?.logs ?? []
  page.value = 1
  hasMore.value = (val?.logs?.length ?? 0) === PAGE_SIZE
}, { immediate: true })

const logs = computed(() => accumulated.value)

async function loadMore() {
  loadingMore.value = true
  try {
    const next = page.value + 1
    const res = await $fetch<{ logs: AuditLogEntry[] }>('/api/v1/audit-log', {
      query: { page: String(next), limit: String(PAGE_SIZE) },
    })
    accumulated.value = [...accumulated.value, ...res.logs]
    page.value = next
    hasMore.value = res.logs.length === PAGE_SIZE
  } finally {
    loadingMore.value = false
  }
}

type Color = 'success' | 'info' | 'error' | 'neutral' | 'primary'
const actionColor: Record<string, Color> = {
  create: 'success', update: 'info', delete: 'error', activate: 'success',
}

// `ai_assisted_update` etc.: a change AI suggested and this user reviewed and applied.
function baseAction(action: string) {
  return action.replace(/^ai_assisted_/, '')
}
function aiAssistText(a: NonNullable<AuditLogEntry['aiAssist']>) {
  return [a.instruction && `Asked: "${a.instruction}"`, a.summary, 'Suggested by AI, reviewed and applied by this user.'].filter(Boolean).join(' — ')
}

const columns = [
  { accessorKey: 'action', header: 'Action' },
  { accessorKey: 'resource', header: 'Resource' },
  { accessorKey: 'resourceId', header: 'ID' },
  { accessorKey: 'userId', header: 'User' },
  { accessorKey: 'createdAt', header: 'When' },
]
</script>

<template>
  <div class="space-y-4">
    <UButton to="/admin/settings" icon="i-lucide-arrow-left" variant="link" color="neutral" size="sm" class="px-0">Settings</UButton>
    <h1 class="text-xl font-bold text-gray-900 dark:text-white">Audit log</h1>

    <UCard>
      <UTable :data="logs" :columns="columns">
        <template #action-cell="{ row }">
          <div class="flex items-center gap-1.5">
            <UBadge :color="actionColor[baseAction(row.original.action)] ?? 'neutral'" variant="soft" size="xs" class="capitalize">
              {{ baseAction(row.original.action) }}
            </UBadge>
            <UTooltip v-if="row.original.aiAssist" :text="aiAssistText(row.original.aiAssist)">
              <UBadge color="primary" variant="outline" size="xs" icon="i-lucide-sparkles">AI-assisted</UBadge>
            </UTooltip>
          </div>
        </template>
        <template #resourceId-cell="{ row }">
          <code v-if="row.original.resourceId" class="text-xs text-gray-400">{{ row.original.resourceId.slice(0, 12) }}…</code>
        </template>
        <template #createdAt-cell="{ row }">
          <span class="text-xs text-gray-400">{{ formatLocalDateTime(row.original.createdAt) }}</span>
        </template>
      </UTable>
      <div v-if="hasMore" class="flex justify-center pt-3">
        <UButton variant="outline" color="neutral" size="sm" :loading="loadingMore" @click="loadMore">
          Load more
        </UButton>
      </div>
    </UCard>
  </div>
</template>
