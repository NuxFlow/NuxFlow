<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })
useHead({ title: 'Navigation' })

type MenuRow = {
  id: string
  name: string
  location: string | null
  items: unknown[]
  updatedAt: string
}

const { data, refresh } = await useAsyncData('admin-menus', () =>
  $fetch<{ menus: MenuRow[] }>('/api/v1/menus'), { server: false })

const menus = computed(() => data.value?.menus ?? [])

const LOCATION_LABELS: Record<string, string> = {
  header: 'Header',
  footer: 'Footer',
  sidebar: 'Sidebar',
}

const toast = useToast()

// ── Create ────────────────────────────────────────────────────────────────────
const showCreate = ref(false)
const creating = ref(false)
const newName = ref('')
const newLocation = ref<'header' | 'footer' | 'sidebar' | null>(null)

const locationOptions = [
  { label: 'Header', value: 'header' },
  { label: 'Footer', value: 'footer' },
  { label: 'Sidebar', value: 'sidebar' },
]

async function createMenu() {
  if (!newName.value.trim()) return
  creating.value = true
  try {
    const result = await $fetch<{ id: string }>('/api/v1/menus', {
      method: 'POST',
      body: { name: newName.value.trim(), location: newLocation.value },
    })
    showCreate.value = false
    newName.value = ''
    newLocation.value = null
    await navigateTo(`/admin/menus/${result.id}`)
  } catch {
    toast.add({ title: 'Failed to create menu', color: 'red' })
  } finally {
    creating.value = false
  }
}

// ── Delete ────────────────────────────────────────────────────────────────────
const deleteId = ref<string | null>(null)
const deleting = ref(false)
const isDeleteOpen = computed({
  get: () => !!deleteId.value,
  set: (v) => { if (!v) deleteId.value = null },
})

async function doDelete() {
  if (!deleteId.value) return
  deleting.value = true
  try {
    await $fetch(`/api/v1/menus/${deleteId.value}`, { method: 'DELETE' })
    deleteId.value = null
    await refresh()
    toast.add({ title: 'Menu deleted', color: 'green' })
  } catch {
    toast.add({ title: 'Failed to delete', color: 'red' })
  } finally {
    deleting.value = false
  }
}

onMounted(() => { if (!data.value) refresh() })
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-bold text-gray-900 dark:text-white">Navigation</h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Manage menus for your site header, footer, and sidebar</p>
      </div>
      <UButton icon="i-lucide-plus" @click="showCreate = true">New menu</UButton>
    </div>

    <!-- Empty state -->
    <div v-if="menus.length === 0" class="text-center py-16 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
      <UIcon name="i-lucide-navigation" class="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
      <p class="font-medium text-gray-900 dark:text-white">No menus yet</p>
      <p class="text-sm text-gray-500 mt-1 mb-4">Create a menu and assign it to a location on your site.</p>
      <UButton variant="outline" icon="i-lucide-plus" @click="showCreate = true">Create your first menu</UButton>
    </div>

    <!-- Menu cards -->
    <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      <NuxtLink
        v-for="menu in menus"
        :key="menu.id"
        :to="`/admin/menus/${menu.id}`"
        class="group bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 hover:border-primary-400 hover:shadow-sm transition-all"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <UIcon name="i-lucide-menu" class="w-4 h-4 text-gray-400 shrink-0" />
              <span class="font-semibold text-gray-900 dark:text-white truncate group-hover:text-primary-600 transition-colors">
                {{ menu.name }}
              </span>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <UBadge v-if="menu.location" variant="soft" size="xs" color="primary">
                {{ LOCATION_LABELS[menu.location] ?? menu.location }}
              </UBadge>
              <span class="text-xs text-gray-400">
                {{ (menu.items as unknown[]).length }} item{{ (menu.items as unknown[]).length === 1 ? '' : 's' }}
              </span>
            </div>
          </div>
          <UButton
            variant="ghost"
            size="xs"
            icon="i-lucide-trash-2"
            color="red"
            class="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            @click.prevent="deleteId = menu.id"
          />
        </div>
      </NuxtLink>
    </div>

    <!-- Create modal -->
    <UModal v-model:open="showCreate" title="New menu">
      <template #body>
        <div class="space-y-4">
          <UFormField label="Menu name">
            <UInput v-model="newName" placeholder="e.g. Main Navigation" autofocus @keyup.enter="createMenu" />
          </UFormField>
          <UFormField label="Location" hint="Where this menu appears on your site">
            <USelect
              v-model="newLocation"
              :items="locationOptions"
              placeholder="No location assigned"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <UButton variant="outline" @click="showCreate = false">Cancel</UButton>
        <UButton :loading="creating" :disabled="!newName.trim()" @click="createMenu">Create menu</UButton>
      </template>
    </UModal>

    <!-- Delete confirmation -->
    <UModal v-model:open="isDeleteOpen" title="Delete menu?" description="This action cannot be undone.">
      <template #footer>
        <UButton variant="outline" @click="isDeleteOpen = false">Cancel</UButton>
        <UButton color="red" :loading="deleting" @click="doDelete">Delete</UButton>
      </template>
    </UModal>
  </div>
</template>
