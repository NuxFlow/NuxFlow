<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

type SiteRow = { id: string; name: string; domain: string; status: string; locale?: string; createdAt: string }
const { data, refresh } = await useFetch<{ sites: SiteRow[] }>('/api/v1/admin/sites')
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

// Modal & Form States
const isEditOpen = ref(false)
const selectedSite = ref<SiteRow | null>(null)
const editForm = reactive({
  id: '',
  name: '',
  domain: '',
  status: 'active' as 'active' | 'maintenance' | 'suspended',
  locale: 'en',
})

const isDeleteOpen = ref(false)
const deleteConfirmText = ref('')
const deleting = ref(false)

const saving = ref(false)
const saveError = ref('')

function openEdit(site: SiteRow) {
  selectedSite.value = site
  editForm.id = site.id
  editForm.name = site.name
  editForm.domain = site.domain
  editForm.status = site.status as 'active' | 'maintenance' | 'suspended'
  editForm.locale = site.locale || 'en'
  saveError.value = ''
  isEditOpen.value = true
}

function openDelete(site: SiteRow) {
  selectedSite.value = site
  deleteConfirmText.value = ''
  isDeleteOpen.value = true
}

async function saveSite() {
  saving.value = true
  saveError.value = ''
  try {
    await $fetch(`/api/v1/admin/sites/${editForm.id}`, {
      method: 'PATCH',
      body: {
        name: editForm.name,
        domain: editForm.domain,
        status: editForm.status,
        locale: editForm.locale,
      },
    })
    isEditOpen.value = false
    await refresh()
  } catch (e: unknown) {
    const err = e as { data?: { message?: string }; message?: string }
    saveError.value = err.data?.message || err.message || 'Failed to save site'
  } finally {
    saving.value = false
  }
}

async function deleteSite() {
  if (!selectedSite.value) return
  deleting.value = true
  try {
    await $fetch(`/api/v1/admin/sites/${selectedSite.value.id}`, {
      method: 'DELETE',
    })
    isDeleteOpen.value = false
    await refresh()
  } catch (e: unknown) {
    const err = e as { data?: { message?: string }; message?: string }
    alert(err.data?.message || err.message || 'Failed to delete site')
  } finally {
    deleting.value = false
  }
}
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
        <template #actions-cell="{ row }">
          <div class="flex items-center gap-1.5">
            <UButton variant="ghost" size="xs" icon="i-lucide-pencil" @click="openEdit(row.original)" />
            <UButton variant="ghost" color="red" size="xs" icon="i-lucide-trash" @click="openDelete(row.original)" />
          </div>
        </template>
      </UTable>
    </UCard>

    <!-- Edit Site Modal -->
    <UModal v-model:open="isEditOpen" title="Edit Site">
      <template #body>
        <div class="space-y-4">
          <UFormField label="Site name" required>
            <UInput v-model="editForm.name" />
          </UFormField>
          <UFormField label="Domain" required>
            <UInput v-model="editForm.domain" />
          </UFormField>
          <UFormField label="Default locale">
            <UInput v-model="editForm.locale" />
          </UFormField>
          <UFormField label="Status">
            <USelect
              v-model="editForm.status"
              :items="[
                { label: 'Active', value: 'active' },
                { label: 'Maintenance', value: 'maintenance' },
                { label: 'Suspended', value: 'suspended' }
              ]"
            />
          </UFormField>
          <UAlert v-if="saveError" color="red" variant="soft" :description="saveError" />
        </div>
      </template>
      <template #footer>
        <UButton variant="ghost" @click="isEditOpen = false">Cancel</UButton>
        <UButton :loading="saving" :disabled="!editForm.name || !editForm.domain" @click="saveSite">Save changes</UButton>
      </template>
    </UModal>

    <!-- Delete Site Modal -->
    <UModal v-model:open="isDeleteOpen" title="Delete Site">
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-gray-500">
            Are you absolutely sure you want to delete <strong class="text-gray-900 dark:text-white">{{ selectedSite?.name }}</strong>?
          </p>
          <p class="text-sm text-red-500 font-medium">
            Warning: This action is permanent and will delete all site pages, settings, media, and local users.
          </p>
          <div class="space-y-2">
            <label class="text-xs text-gray-400">Type the domain <strong class="text-gray-700 dark:text-gray-300">{{ selectedSite?.domain }}</strong> to confirm:</label>
            <UInput v-model="deleteConfirmText" :placeholder="selectedSite?.domain" />
          </div>
        </div>
      </template>
      <template #footer>
        <UButton variant="ghost" @click="isDeleteOpen = false">Cancel</UButton>
        <UButton
          color="red"
          variant="solid"
          class="!bg-red-600 hover:!bg-red-700 !text-white font-semibold shadow-sm transition-colors cursor-pointer"
          :loading="deleting"
          :disabled="deleteConfirmText !== selectedSite?.domain"
          @click="deleteSite"
        >
          Delete permanently
        </UButton>
      </template>
    </UModal>
  </div>
</template>
