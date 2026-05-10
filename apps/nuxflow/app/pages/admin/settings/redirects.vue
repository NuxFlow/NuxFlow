<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

type Redirect = { id: string; from: string; to: string; statusCode: number }
const { data, refresh } = await useFetch<{ redirects: Redirect[] }>('/api/v1/redirects')
const items = computed(() => data.value?.redirects ?? [])

const form = reactive({ from: '', to: '', statusCode: 301 as 301 | 302 })
const creating = ref(false)

async function create() {
  creating.value = true
  try {
    await $fetch('/api/v1/redirects', { method: 'POST', body: form })
    form.from = ''
    form.to = ''
    await refresh()
  } finally {
    creating.value = false
  }
}

async function remove(id: string) {
  await $fetch(`/api/v1/redirects/${id}`, { method: 'DELETE' })
  await refresh()
}

const columns = [
  { accessorKey: 'from', header: 'From' },
  { accessorKey: 'to', header: 'To' },
  { accessorKey: 'statusCode', header: 'Type' },
  { id: 'actions', header: '' },
]
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-xl font-bold text-gray-900 dark:text-white">Redirects</h1>

    <!-- Create form -->
    <UCard>
      <template #header><p class="text-sm font-semibold">Add redirect</p></template>
      <div class="flex items-end gap-3">
        <UFormField label="From" class="flex-1">
          <UInput v-model="form.from" placeholder="/old-page" />
        </UFormField>
        <UIcon name="i-lucide-arrow-right" class="w-4 h-4 text-gray-400 mb-2 shrink-0" />
        <UFormField label="To" class="flex-1">
          <UInput v-model="form.to" placeholder="/new-page" />
        </UFormField>
        <UFormField label="Type">
          <USelect v-model="form.statusCode" :items="[{ label: '301 Permanent', value: 301 }, { label: '302 Temporary', value: 302 }]" />
        </UFormField>
        <UButton :loading="creating" :disabled="!form.from || !form.to" @click="create">Add</UButton>
      </div>
    </UCard>

    <!-- List -->
    <UCard>
      <UTable :data="items" :columns="columns">
        <template #from-cell="{ row }">
          <code class="text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">{{ row.original.from }}</code>
        </template>
        <template #to-cell="{ row }">
          <code class="text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">{{ row.original.to }}</code>
        </template>
        <template #statusCode-cell="{ row }">
          <UBadge :color="row.original.statusCode === 301 ? 'blue' : 'gray'" variant="soft" size="xs">{{ row.original.statusCode }}</UBadge>
        </template>
        <template #actions-cell="{ row }">
          <UButton variant="ghost" size="xs" icon="i-lucide-trash-2" color="red" @click="remove(row.original.id)" />
        </template>
      </UTable>
    </UCard>
  </div>
</template>
