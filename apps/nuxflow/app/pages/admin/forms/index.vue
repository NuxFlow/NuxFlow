<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

type FormRow = { id: string; name: string; status: string; updatedAt: string }
const { data } = await useFetch<{ forms: FormRow[] }>('/api/v1/forms')
const items = computed(() => data.value?.forms ?? [])

type Color = 'green' | 'gray' | 'red' | 'primary' | 'neutral'
const statusColor: Record<string, Color> = { active: 'green', draft: 'gray', closed: 'red' }

const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'status', header: 'Status' },
  { accessorKey: 'updatedAt', header: 'Updated' },
  { id: 'actions', header: '' },
]
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-bold text-gray-900 dark:text-white">Forms</h1>
      <UButton to="/admin/forms/new/edit" icon="i-lucide-plus">New form</UButton>
    </div>

    <UCard>
      <UTable :data="items" :columns="columns">
        <template #name-cell="{ row }">
          <NuxtLink :to="`/admin/forms/${row.original.id}/edit`" class="font-medium text-gray-900 dark:text-white hover:text-primary-500">
            {{ row.original.name }}
          </NuxtLink>
        </template>
        <template #status-cell="{ row }">
          <UBadge :color="statusColor[row.original.status] ?? 'neutral'" variant="soft" size="xs" class="capitalize">{{ row.original.status }}</UBadge>
        </template>
        <template #updatedAt-cell="{ row }">
          <span class="text-sm text-gray-400">{{ new Date(row.original.updatedAt).toLocaleDateString() }}</span>
        </template>
        <template #actions-cell="{ row }">
          <div class="flex gap-1 justify-end">
            <UButton :to="`/admin/forms/${row.original.id}/submissions`" variant="ghost" size="xs" icon="i-lucide-inbox" />
            <UButton :to="`/admin/forms/${row.original.id}/edit`" variant="ghost" size="xs" icon="i-lucide-pencil" />
          </div>
        </template>
      </UTable>
    </UCard>
  </div>
</template>
