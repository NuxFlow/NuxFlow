<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })
useHead({ title: 'Import & Backup' })

type Tab = 'wordpress' | 'restore' | 'backup'
const activeTab = ref<Tab>('backup')

const tabs: { value: Tab; label: string; icon: string }[] = [
  { value: 'backup', label: 'Backup', icon: 'i-lucide-download' },
  { value: 'restore', label: 'Restore', icon: 'i-lucide-upload' },
  { value: 'wordpress', label: 'WordPress import', icon: 'i-lucide-arrow-right-left' },
]
</script>

<template>
  <div class="max-w-2xl mx-auto space-y-6">
    <div>
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Import & Backup</h1>
      <p class="text-sm text-gray-500 mt-0.5">Back up your site data, restore from a backup, or import from WordPress</p>
    </div>

    <!-- Tabs -->
    <div class="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl w-fit">
      <button
        v-for="tab in tabs"
        :key="tab.value"
        class="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
        :class="activeTab === tab.value
          ? 'bg-white dark:bg-gray-900 shadow-sm text-gray-900 dark:text-white'
          : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'"
        @click="activeTab = tab.value"
      >
        <UIcon :name="tab.icon" class="w-3.5 h-3.5" />
        {{ tab.label }}
      </button>
    </div>

    <AdminImportImportBackupTab v-if="activeTab === 'backup'" />
    <AdminImportImportRestoreTab v-else-if="activeTab === 'restore'" />
    <AdminImportImportWordpressTab v-else-if="activeTab === 'wordpress'" />
  </div>
</template>
