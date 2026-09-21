<script setup lang="ts">
const toast = useToast()

interface Redirect {
  id: string
  from: string
  to: string
  statusCode: number
  createdAt: string
}

const { data: redirectData, refresh: refreshRedirects } = await useFetch<{ redirects: Redirect[] }>('/api/v1/redirects')
const redirects = computed(() => redirectData.value?.redirects ?? [])

const addForm = reactive({ from: '', to: '', statusCode: 301 as 301 | 302 })
const addError = ref('')
const adding = ref(false)

const statusOptions = [
  { label: '301 — Permanent', value: 301 },
  { label: '302 — Temporary', value: 302 },
]

async function addRedirect() {
  addError.value = ''
  if (!addForm.from.startsWith('/')) {
    addError.value = '"From" path must start with /'
    return
  }
  if (!addForm.to) {
    addError.value = '"To" is required'
    return
  }
  adding.value = true
  try {
    await $fetch('/api/v1/redirects', {
      method: 'POST',
      body: { from: addForm.from, to: addForm.to, statusCode: addForm.statusCode },
    })
    addForm.from = ''
    addForm.to = ''
    addForm.statusCode = 301
    await refreshRedirects()
    toast.add({ title: 'Redirect added', color: 'success' })
  } catch {
    addError.value = 'Failed to add redirect. Check for duplicates.'
  } finally {
    adding.value = false
  }
}

const deletingId = ref<string | null>(null)

async function deleteRedirect(id: string) {
  deletingId.value = id
  try {
    await $fetch(`/api/v1/redirects/${id}`, { method: 'DELETE' })
    await refreshRedirects()
    toast.add({ title: 'Redirect deleted', color: 'success' })
  } catch {
    toast.add({ title: 'Failed to delete redirect', color: 'error' })
  } finally {
    deletingId.value = null
  }
}

const columns = [
  { accessorKey: 'from', header: 'From' },
  { accessorKey: 'to', header: 'To' },
  { accessorKey: 'statusCode', header: 'Type' },
  { id: 'actions', header: '' },
]
</script>

<template>
  <div class="space-y-4">
    <!-- Add form -->
    <UCard>
      <template #header>
        <p class="text-sm font-semibold text-gray-900 dark:text-white">Add redirect</p>
        <p class="text-xs text-gray-400 mt-0.5">Redirects are checked before page content is served</p>
      </template>
      <div class="space-y-3">
        <div class="grid grid-cols-5 gap-3 items-end">
          <UFormField label="From path" class="col-span-2">
            <UInput v-model="addForm.from" placeholder="/old-page" class="w-full font-mono text-sm" />
          </UFormField>
          <UFormField label="To" class="col-span-2">
            <UInput v-model="addForm.to" placeholder="/new-page or https://example.com" class="w-full font-mono text-sm" />
          </UFormField>
          <UFormField label="Type">
            <USelect v-model="addForm.statusCode" :items="statusOptions" class="w-full" />
          </UFormField>
        </div>
        <UAlert v-if="addError" color="error" variant="soft" :description="addError" />
      </div>
      <template #footer>
        <div class="flex justify-end">
          <UButton :loading="adding" icon="i-lucide-plus" @click="addRedirect">Add redirect</UButton>
        </div>
      </template>
    </UCard>

    <!-- Redirect list -->
    <UCard>
      <template #header>
        <p class="text-sm font-semibold text-gray-900 dark:text-white">Active redirects</p>
        <p class="text-xs text-gray-400 mt-0.5">{{ redirects.length }} redirect{{ redirects.length === 1 ? '' : 's' }}</p>
      </template>

      <div v-if="!redirects.length" class="text-center py-10 text-gray-400">
        <UIcon name="i-lucide-arrow-right-left" class="w-8 h-8 mx-auto mb-2 opacity-40" />
        <p class="text-sm">No redirects yet</p>
      </div>

      <UTable
        v-else
        :data="redirects"
        :columns="columns"
      >
        <template #from-cell="{ row }">
          <code class="text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">{{ row.original.from }}</code>
        </template>
        <template #to-cell="{ row }">
          <code class="text-xs text-primary-600 dark:text-primary-400">{{ row.original.to }}</code>
        </template>
        <template #statusCode-cell="{ row }">
          <UBadge
            :color="row.original.statusCode === 301 ? 'info' : 'warning'"
            variant="soft"
            size="sm"
          >
            {{ row.original.statusCode }} {{ row.original.statusCode === 301 ? 'Permanent' : 'Temporary' }}
          </UBadge>
        </template>
        <template #actions-cell="{ row }">
          <div class="flex justify-end">
            <UButton
              variant="ghost"
              color="error"
              size="xs"
              icon="i-lucide-trash-2"
              :loading="deletingId === row.original.id"
              @click="deleteRedirect(row.original.id)"
            />
          </div>
        </template>
      </UTable>
    </UCard>
  </div>
</template>
