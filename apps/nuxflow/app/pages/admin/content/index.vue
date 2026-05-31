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
const deleteConfirmInput = ref('')

const isDeleteOpen = computed({
  get: () => !!deleteId.value,
  set: (v) => {
    if (!v) {
      deleteId.value = null
      deleteConfirmInput.value = ''
    }
  },
})

function confirmDelete(id: string) {
  deleteId.value = id
  deleteConfirmInput.value = ''
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
    <UModal v-model:open="isDeleteOpen" title="Delete content?">
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-gray-500 dark:text-gray-400">
            Are you sure you want to permanently delete this content? All associated settings, translations, and comments may also be deleted.
          </p>
          <div class="p-3 bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30 rounded-lg flex items-start gap-2.5">
            <UIcon name="i-lucide-alert-triangle" class="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <div>
              <p class="text-xs font-semibold text-red-800 dark:text-red-300">Warning: This action cannot be undone.</p>
              <p class="text-[11px] text-red-700/80 dark:text-red-400/80 mt-0.5">Once deleted, you will not be able to recover this item or any of its history.</p>
            </div>
          </div>
          <UFormField label="Type 'DELETE' to confirm:">
            <UInput v-model="deleteConfirmInput" placeholder="DELETE" class="w-full font-mono uppercase" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <UButton variant="outline" color="neutral" @click="isDeleteOpen = false">Cancel</UButton>
        <UButton
          variant="solid"
          class="!bg-red-600 hover:!bg-red-700 !text-white font-semibold shadow-sm transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          :loading="deleting"
          :disabled="deleteConfirmInput !== 'DELETE'"
          @click="doDelete"
        >
          Delete permanently
        </UButton>
      </template>
    </UModal>
  </div>
</template>
