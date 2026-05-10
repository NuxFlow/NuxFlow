<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

const route = useRoute()
const typeSlug = computed(() => (route.query.type as string) || 'page')

useHead({ title: computed(() => typeSlug.value.charAt(0).toUpperCase() + typeSlug.value.slice(1) + 's') })

type ContentRow = { id: string; title: string; slug: string; status: string; authorId: string; updatedAt: string }
const { data: items, refresh } = await useFetch<{ items: ContentRow[] }>(() => `/api/v1/content?type=${typeSlug.value}`)

type Color = 'green' | 'gray' | 'blue' | 'yellow' | 'orange' | 'red' | 'primary' | 'neutral'
const statusColor: Record<string, Color> = {
  published: 'green',
  draft: 'gray',
  scheduled: 'blue',
  archived: 'yellow',
  review: 'orange',
}

const columns = [
  { accessorKey: 'title', header: 'Title' },
  { accessorKey: 'status', header: 'Status' },
  { accessorKey: 'updatedAt', header: 'Updated' },
  { id: 'actions', header: '' },
]

const toast = useToast()
const deleteId = ref<string | null>(null)
const deleting = ref(false)
const isDeleteOpen = computed({
  get: () => !!deleteId.value,
  set: (v) => { if (!v) deleteId.value = null },
})

function confirmDelete(id: string) {
  deleteId.value = id
}

async function doDelete() {
  if (!deleteId.value) return
  deleting.value = true
  try {
    await $fetch(`/api/v1/content/${deleteId.value}`, { method: 'DELETE' })
    deleteId.value = null
    await refresh()
    toast.add({ title: 'Content deleted', color: 'green' })
  } catch {
    toast.add({ title: 'Failed to delete', color: 'red' })
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-bold text-gray-900 dark:text-white capitalize">{{ typeSlug }}s</h1>
      <UButton :to="`/admin/content/new?type=${typeSlug}`" icon="i-lucide-plus">
        New {{ typeSlug }}
      </UButton>
    </div>

    <UCard>
      <UTable :data="items?.items ?? []" :columns="columns">
        <template #title-cell="{ row }">
          <NuxtLink
            :to="`/admin/content/${row.original.id}`"
            class="font-medium text-gray-900 dark:text-white hover:text-primary-500"
          >
            {{ row.original.title }}
          </NuxtLink>
        </template>

        <template #status-cell="{ row }">
          <UBadge :color="statusColor[row.original.status] ?? 'neutral'" variant="soft" size="xs" class="capitalize">
            {{ row.original.status }}
          </UBadge>
        </template>

        <template #updatedAt-cell="{ row }">
          <span class="text-sm text-gray-400">
            {{ new Date(row.original.updatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) }}
          </span>
        </template>

        <template #actions-cell="{ row }">
          <div class="flex items-center gap-1 justify-end">
            <UButton :to="`/admin/content/${row.original.id}`" variant="ghost" size="xs" icon="i-lucide-pencil" />
            <UButton variant="ghost" size="xs" icon="i-lucide-trash-2" color="red" @click="confirmDelete(row.original.id)" />
          </div>
        </template>
      </UTable>
    </UCard>

    <!-- Delete confirmation modal -->
    <UModal v-model:open="isDeleteOpen" title="Delete content?" description="This action cannot be undone.">
      <template #footer>
        <UButton variant="outline" @click="isDeleteOpen = false">Cancel</UButton>
        <UButton color="red" :loading="deleting" @click="doDelete">Delete</UButton>
      </template>
    </UModal>
  </div>
</template>
