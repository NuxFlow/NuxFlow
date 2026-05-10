<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

type Subscriber = { id: string; name: string; email: string; tier: string; status: string; renewsAt: string | null }
const { data, pending } = await useFetch<{ subscribers: Subscriber[] }>('/api/v1/memberships/subscribers')

type Color = 'green' | 'red' | 'yellow' | 'primary' | 'neutral'
function statusColor(status: string): Color {
  if (status === 'active') return 'green'
  if (status === 'cancelled') return 'red'
  return 'yellow'
}

const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'email', header: 'Email' },
  { accessorKey: 'tier', header: 'Tier' },
  { accessorKey: 'status', header: 'Status' },
  { accessorKey: 'renewsAt', header: 'Renews' },
]
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <UButton to="/admin/memberships" variant="ghost" icon="i-lucide-arrow-left" size="sm" />
        <h1 class="text-xl font-bold text-gray-900 dark:text-white">Subscribers</h1>
      </div>
    </div>

    <UCard>
      <UTable
        :loading="pending"
        :columns="columns"
        :data="data?.subscribers ?? []"
        :empty-state="{ icon: 'i-lucide-users', label: 'No subscribers yet.' }"
      >
        <template #status-cell="{ row }">
          <UBadge :color="statusColor(row.original.status)" variant="subtle">
            {{ row.original.status }}
          </UBadge>
        </template>
      </UTable>
    </UCard>
  </div>
</template>
