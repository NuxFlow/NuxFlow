<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

type ApiKey = { id: string; name: string; scopes: string[]; lastUsedAt: string | null }
const { data, refresh } = await useFetch<{ apiKeys: ApiKey[] }>('/api/v1/api-keys')
const keys = computed(() => data.value?.apiKeys ?? [])

const creating = ref(false)
const newKey = ref('')
const form = reactive({ name: '', scopes: ['read:content'] })

async function create() {
  creating.value = true
  try {
    const res = await $fetch<{ id: string; key: string }>('/api/v1/api-keys', { method: 'POST', body: form })
    newKey.value = res.key
    await refresh()
  } finally {
    creating.value = false
  }
}

function copyNewKey() { window.navigator.clipboard.writeText(newKey.value) }

async function revoke(id: string) {
  await $fetch(`/api/v1/api-keys/${id}`, { method: 'DELETE' })
  await refresh()
}

const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'scopes', header: 'Scopes' },
  { accessorKey: 'lastUsedAt', header: 'Last used' },
  { id: 'actions', header: '' },
]
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-xl font-bold text-gray-900 dark:text-white">API Keys</h1>

    <!-- New key shown once -->
    <UAlert
      v-if="newKey"
      color="green"
      variant="soft"
      icon="i-lucide-key"
      title="API key created — copy it now, it won't be shown again"
    >
      <template #description>
        <code class="text-xs break-all">{{ newKey }}</code>
        <UButton size="xs" variant="ghost" icon="i-lucide-copy" class="ml-2" @click="copyNewKey" />
      </template>
    </UAlert>

    <!-- Create form -->
    <UCard>
      <template #header><p class="text-sm font-semibold">Create API key</p></template>
      <div class="flex items-end gap-3">
        <UFormField label="Key name" class="flex-1">
          <UInput v-model="form.name" placeholder="My app" />
        </UFormField>
        <UButton :loading="creating" :disabled="!form.name" @click="create">Create</UButton>
      </div>
    </UCard>

    <!-- List -->
    <UCard>
      <UTable :data="keys" :columns="columns">
        <template #scopes-cell="{ row }">
          <div class="flex flex-wrap gap-1">
            <UBadge v-for="s in row.original.scopes" :key="s" variant="soft" size="xs">{{ s }}</UBadge>
          </div>
        </template>
        <template #lastUsedAt-cell="{ row }">
          <span class="text-sm text-gray-400">{{ row.original.lastUsedAt ? new Date(row.original.lastUsedAt).toLocaleDateString() : 'Never' }}</span>
        </template>
        <template #actions-cell="{ row }">
          <UButton variant="ghost" size="xs" icon="i-lucide-trash-2" color="red" @click="revoke(row.original.id)" />
        </template>
      </UTable>
    </UCard>
  </div>
</template>
