<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

type AuditLog = { id: string; action: string; resource: string; resourceId: string | null; userId: string; createdAt: string }
const { data } = await useFetch<{ logs: AuditLog[] }>('/api/v1/audit-log')
const logs = computed(() => data.value?.logs ?? [])

type Color = 'green' | 'blue' | 'red' | 'gray' | 'primary' | 'neutral'
const actionColor: Record<string, Color> = {
  create: 'green', update: 'blue', delete: 'red', activate: 'green',
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
          <UBadge :color="actionColor[row.original.action] ?? 'gray'" variant="soft" size="xs" class="capitalize">
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
    </UCard>
  </div>
</template>
