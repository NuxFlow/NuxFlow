<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })
useHead({ title: 'Import & Backup' })

type Tab = 'wordpress' | 'restore' | 'backup'
const activeTab = ref<Tab>('backup')

// ── Backup ────────────────────────────────────────────────────────────────────
const downloading = ref(false)
async function downloadBackup() {
  downloading.value = true
  try {
    const res = await fetch('/api/v1/backup')
    if (!res.ok) throw new Error('Failed')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `nuxflow-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  } finally {
    downloading.value = false
  }
}

// ── Restore ───────────────────────────────────────────────────────────────────
const restoreFile = ref<File | null>(null)
const restoreWhat = ref(['content', 'taxonomies', 'menus', 'forms'])
const restoreConflict = ref<'skip' | 'overwrite'>('skip')
const restoring = ref(false)
const restoreResult = ref<{
  result: {
    content: { created: number; skipped: number }
    taxonomies: { created: number }
    terms: { created: number }
    menus: { created: number }
    forms: { created: number }
    settings: { updated: number }
  }
  media: { uploaded: number; skipped: number }
} | null>(null)
const restoreError = ref('')

const restoreWhatOptions = [
  { value: 'content', label: 'Content (pages & posts)' },
  { value: 'taxonomies', label: 'Categories & Tags' },
  { value: 'menus', label: 'Menus' },
  { value: 'forms', label: 'Forms' },
  { value: 'settings', label: 'Site settings' },
]

function onRestoreFile(e: Event) {
  const input = e.target as HTMLInputElement
  restoreFile.value = input.files?.[0] ?? null
  restoreResult.value = null
  restoreError.value = ''
}

async function runRestore() {
  if (!restoreFile.value) return
  restoring.value = true
  restoreError.value = ''
  restoreResult.value = null
  try {
    const formData = new FormData()
    formData.append('file', restoreFile.value)
    const params = new URLSearchParams({
      what: restoreWhat.value.join(','),
      conflictMode: restoreConflict.value,
    })
    const res = await $fetch<typeof restoreResult.value>(`/api/v1/restore?${params}`, {
      method: 'POST',
      body: formData,
    })
    restoreResult.value = res
  } catch (e: unknown) {
    const msg = e && typeof e === 'object' && 'data' in e
      ? (e as { data?: { message?: string } }).data?.message
      : undefined
    restoreError.value = msg ?? 'Restore failed. Check the file and try again.'
  } finally {
    restoring.value = false
  }
}

// ── WordPress import ──────────────────────────────────────────────────────────
const wpFile = ref<File | null>(null)
const wpImporting = ref(false)
const wpResult = ref<{ imported: number; skipped: number; categories: number; tags: number } | null>(null)
const wpError = ref('')

function onWpFile(e: Event) {
  const input = e.target as HTMLInputElement
  wpFile.value = input.files?.[0] ?? null
  wpResult.value = null
  wpError.value = ''
}

async function runWpImport() {
  if (!wpFile.value) return
  wpImporting.value = true
  wpError.value = ''
  wpResult.value = null
  try {
    const formData = new FormData()
    formData.append('file', wpFile.value)
    const res = await $fetch<typeof wpResult.value>('/api/v1/import/wordpress', { method: 'POST', body: formData })
    wpResult.value = res
  } catch (e: unknown) {
    const msg = e && typeof e === 'object' && 'data' in e
      ? (e as { data?: { message?: string } }).data?.message
      : undefined
    wpError.value = msg ?? 'Import failed. Check the file format and try again.'
  } finally {
    wpImporting.value = false
  }
}

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

    <!-- Backup tab -->
    <UCard v-if="activeTab === 'backup'">
      <template #header>
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-lg bg-green-50 dark:bg-green-900/30 flex items-center justify-center">
            <UIcon name="i-lucide-database-backup" class="w-5 h-5 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <p class="font-semibold text-sm text-gray-900 dark:text-white">Download backup</p>
            <p class="text-xs text-gray-400">Export your full site as a portable JSON file</p>
          </div>
        </div>
      </template>

      <div class="space-y-4">
        <UAlert
          icon="i-lucide-info"
          color="blue"
          variant="soft"
        >
          <template #title>
            <span class="text-blue-900 dark:text-blue-200 font-semibold">What's included</span>
          </template>
          <template #description>
            <span class="text-gray-800 dark:text-gray-200">
              A self-contained .zip file with all site data and media files. Restoring it on any NuxFlow site will re-upload your images to that site's configured media provider. Limit: 100 MB of media.
            </span>
          </template>
        </UAlert>

        <div class="grid grid-cols-2 gap-3 text-sm">
          <div v-for="item in ['Content & pages', 'Categories & tags', 'Menus', 'Forms', 'Site settings', 'Content types', 'Media files']" :key="item" class="flex items-center gap-2 text-gray-800 dark:text-gray-200 font-medium">
            <UIcon name="i-lucide-check" class="w-4 h-4 text-green-500 shrink-0" />
            {{ item }}
          </div>
        </div>
      </div>

      <template #footer>
        <div class="flex justify-end">
          <UButton icon="i-lucide-download" :loading="downloading" @click="downloadBackup">
            Download backup
          </UButton>
        </div>
      </template>
    </UCard>

    <!-- Restore tab -->
    <UCard v-else-if="activeTab === 'restore'">
      <template #header>
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-lg bg-orange-50 dark:bg-orange-900/30 flex items-center justify-center">
            <UIcon name="i-lucide-history" class="w-5 h-5 text-orange-600 dark:text-orange-400" />
          </div>
          <div>
            <p class="font-semibold text-sm text-gray-900 dark:text-white">Restore from backup</p>
            <p class="text-xs text-gray-400">Import a .json backup file exported from NuxFlow</p>
          </div>
        </div>
      </template>

      <div class="space-y-5">
        <UFormField label="Backup file (.json)">
          <div
            class="relative flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl px-6 py-8 hover:border-primary-400 transition-colors cursor-pointer"
            @click="($refs.restoreFileInput as HTMLInputElement).click()"
          >
            <UIcon name="i-lucide-file-json" class="w-8 h-8 text-gray-400" />
            <p class="text-sm text-gray-500">
              <span v-if="restoreFile" class="font-medium text-gray-900 dark:text-white">{{ restoreFile.name }}</span>
              <span v-else>Click to select a NuxFlow backup file</span>
            </p>
            <p v-if="!restoreFile" class="text-xs text-gray-400">.zip (with images) or .json (content only)</p>
            <input ref="restoreFileInput" type="file" accept=".zip,.json" class="sr-only" @change="onRestoreFile">
          </div>
        </UFormField>

        <UFormField label="What to restore">
          <div class="space-y-2">
            <label
              v-for="opt in restoreWhatOptions"
              :key="opt.value"
              class="flex items-center gap-2 text-sm cursor-pointer text-gray-700 dark:text-gray-300"
            >
              <input
                v-model="restoreWhat"
                type="checkbox"
                :value="opt.value"
                class="rounded text-primary-500"
              >
              {{ opt.label }}
            </label>
          </div>
        </UFormField>

        <UFormField label="Conflict handling" hint="What to do when a slug already exists">
          <div class="flex gap-4">
            <label class="flex items-center gap-2 text-sm cursor-pointer text-gray-700 dark:text-gray-300">
              <input v-model="restoreConflict" type="radio" value="skip" class="text-primary-500">
              Skip (keep existing)
            </label>
            <label class="flex items-center gap-2 text-sm cursor-pointer text-gray-700 dark:text-gray-300">
              <input v-model="restoreConflict" type="radio" value="overwrite" class="text-primary-500">
              Overwrite
            </label>
          </div>
        </UFormField>

        <UAlert v-if="restoreError" icon="i-lucide-circle-x" color="red" variant="soft" :description="restoreError" />

        <UAlert
          v-if="restoreResult"
          icon="i-lucide-circle-check"
          color="green"
          variant="soft"
          title="Restore complete"
        >
          <template #description>
            <ul class="text-sm space-y-0.5 mt-1">
              <li>Content: {{ restoreResult.result.content.created }} created, {{ restoreResult.result.content.skipped }} skipped</li>
              <li>Taxonomies: {{ restoreResult.result.taxonomies.created }} created, {{ restoreResult.result.terms.created }} terms</li>
              <li>Menus: {{ restoreResult.result.menus.created }} created</li>
              <li>Forms: {{ restoreResult.result.forms.created }} created</li>
              <li v-if="restoreResult.result.settings.updated">Settings: {{ restoreResult.result.settings.updated }} updated</li>
              <li v-if="restoreResult.media.uploaded">Media: {{ restoreResult.media.uploaded }} images uploaded<span v-if="restoreResult.media.skipped">, {{ restoreResult.media.skipped }} skipped</span></li>
            </ul>
          </template>
        </UAlert>
      </div>

      <template #footer>
        <div class="flex items-center justify-between">
          <p class="text-xs text-gray-400">NuxFlow .zip (full) or .json (content only) backup files</p>
          <UButton
            color="orange"
            :loading="restoring"
            :disabled="!restoreFile || restoreWhat.length === 0"
            icon="i-lucide-history"
            @click="runRestore"
          >
            Restore
          </UButton>
        </div>
      </template>
    </UCard>

    <!-- WordPress import tab -->
    <UCard v-else-if="activeTab === 'wordpress'">
      <template #header>
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
            <UIcon name="i-lucide-arrow-right-left" class="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <p class="font-semibold text-sm text-gray-900 dark:text-white">WordPress</p>
            <p class="text-xs text-gray-400">Import posts, pages, categories, and tags from a WordPress WXR export</p>
          </div>
        </div>
      </template>

      <div class="space-y-4">
        <UAlert
          icon="i-lucide-info"
          color="blue"
          variant="soft"
        >
          <template #title>
            <span class="text-blue-900 dark:text-blue-200 font-semibold">What gets imported</span>
          </template>
          <template #description>
            <span class="text-gray-800 dark:text-gray-200">
              Posts and pages (with content), categories, tags, and publish status. Media files are not re-uploaded — image references will still point to your old WordPress URL.
            </span>
          </template>
        </UAlert>

        <UFormField label="WordPress export file (.xml)">
          <div
            class="relative flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl px-6 py-8 hover:border-primary-400 transition-colors cursor-pointer"
            @click="($refs.wpFileInput as HTMLInputElement).click()"
          >
            <UIcon name="i-lucide-upload-cloud" class="w-8 h-8 text-gray-400" />
            <p class="text-sm text-gray-500">
              <span v-if="wpFile" class="font-medium text-gray-900 dark:text-white">{{ wpFile.name }}</span>
              <span v-else>Click to select your WordPress export file</span>
            </p>
            <p v-if="!wpFile" class="text-xs text-gray-400">Export from WordPress: Tools → Export → All content</p>
            <input ref="wpFileInput" type="file" accept=".xml" class="sr-only" @change="onWpFile">
          </div>
        </UFormField>

        <UAlert v-if="wpError" icon="i-lucide-circle-x" color="red" variant="soft" :description="wpError" />

        <UAlert
          v-if="wpResult"
          icon="i-lucide-circle-check"
          color="green"
          variant="soft"
          title="Import complete"
          :description="`Imported ${wpResult.imported} items (${wpResult.skipped} skipped as duplicates), ${wpResult.categories} categories, ${wpResult.tags} tags.`"
        />
      </div>

      <template #footer>
        <div class="flex items-center justify-between">
          <p class="text-xs text-gray-400">Duplicate slugs are skipped automatically</p>
          <UButton
            :loading="wpImporting"
            :disabled="!wpFile"
            icon="i-lucide-upload"
            @click="runWpImport"
          >
            Import
          </UButton>
        </div>
      </template>
    </UCard>
  </div>
</template>
