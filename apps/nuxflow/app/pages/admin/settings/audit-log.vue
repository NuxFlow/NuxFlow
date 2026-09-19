<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

type AuditLog = { id: string; action: string; resource: string; resourceId: string | null; userId: string; createdAt: string }

const PAGE_SIZE = 200
const page = ref(1)
const accumulated = ref<AuditLog[]>([])
const hasMore = ref(false)
const loadingMore = ref(false)

const { data } = await useFetch<{ logs: AuditLog[] }>('/api/v1/audit-log', {
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
    const res = await $fetch<{ logs: AuditLog[] }>('/api/v1/audit-log', {
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
    <h1 class="text-xl font-bold text-gray-900 dark:text-white">Audit log</h1>

    <UCard>
      <UTable :data="logs" :columns="columns">
        <template #action-cell="{ row }">
          <UBadge :color="actionColor[row.original.action] ?? 'neutral'" variant="soft" size="xs" class="capitalize">
            {{ row.original.action }}
          </UBadge>
        </template>
        <template #resourceId-cell="{ row }">
          <code v-if="row.original.resourceId" class="text-xs text-gray-400">{{ row.original.resourceId.slice(0, 12) }}…</code>
        </template>
        <template #createdAt-cell="{ row }">
          <span class="text-xs text-gray-400">{{ new Date(row.original.createdAt).toLocaleString() }}</span>
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
