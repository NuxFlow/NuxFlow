<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

type SiteRow = { id: string; name: string; domain: string; status: string; createdAt: string }
const { data } = await useFetch<{ sites: SiteRow[] }>('/api/v1/admin/sites')
const items = computed(() => data.value?.sites ?? [])

type Color = 'green' | 'yellow' | 'red' | 'primary' | 'neutral'
const statusColor: Record<string, Color> = { active: 'green', maintenance: 'yellow', suspended: 'red' }

const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'domain', header: 'Domain' },
  { accessorKey: 'status', header: 'Status' },
  { accessorKey: 'createdAt', header: 'Created' },
  { id: 'actions', header: '' },
]
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-bold text-gray-900 dark:text-white">All sites</h1>
      <UButton to="/admin/super/sites/new" icon="i-lucide-plus">New site</UButton>
    </div>

    <UCard>
      <UTable :data="items" :columns="columns">
        <template #domain-cell="{ row }">
          <a :href="`https://${row.original.domain}`" target="_blank" class="text-primary-500 hover:underline text-sm">{{ row.original.domain }}</a>
        </template>
        <template #status-cell="{ row }">
          <UBadge :color="statusColor[row.original.status] ?? 'neutral'" variant="soft" size="xs" class="capitalize">{{ row.original.status }}</UBadge>
        </template>
        <template #createdAt-cell="{ row }">
          <span class="text-sm text-gray-400">{{ new Date(row.original.createdAt).toLocaleDateString() }}</span>
        </template>
        <template #actions-cell>
          <UButton variant="ghost" size="xs" icon="i-lucide-pencil" />
        </template>
      </UTable>
    </UCard>
  </div>
</template>
