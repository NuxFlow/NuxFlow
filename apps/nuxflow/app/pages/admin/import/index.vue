<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })
useHead({ title: 'Import' })

const file = ref<File | null>(null)
const importing = ref(false)
const result = ref<{ imported: number; skipped: number; categories: number; tags: number } | null>(null)
const error = ref('')

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  file.value = input.files?.[0] ?? null
  result.value = null
  error.value = ''
}

async function runImport() {
  if (!file.value) return
  importing.value = true
  error.value = ''
  result.value = null
  try {
    const formData = new FormData()
    formData.append('file', file.value)
    const res = await $fetch<{ imported: number; skipped: number; categories: number; tags: number }>(
      '/api/v1/import/wordpress',
      { method: 'POST', body: formData },
    )
    result.value = res
  } catch (e: unknown) {
    const msg = e && typeof e === 'object' && 'data' in e
      ? (e as { data?: { message?: string } }).data?.message
      : undefined
    error.value = msg ?? 'Import failed. Check the file format and try again.'
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <div class="max-w-2xl mx-auto space-y-6">
    <div>
      <h1 class="text-2xl font-bold">Import</h1>
      <p class="text-sm text-gray-500 mt-0.5">Import content from another platform</p>
    </div>

    <UCard>
      <template #header>
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
            <UIcon name="i-lucide-wordpress" class="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <p class="font-semibold text-sm">WordPress</p>
            <p class="text-xs text-gray-400">Import posts, pages, categories, and tags from a WordPress WXR export file</p>
          </div>
        </div>
      </template>

      <div class="space-y-4">
        <UAlert
          icon="i-lucide-info"
          color="blue"
          variant="soft"
          title="What gets imported"
          description="Posts and pages (with content), categories, tags, and publish status. Media files are not re-uploaded — image references in content will still point to your old WordPress URL."
        />

        <UFormField label="WordPress export file (.xml)">
          <div
            class="relative flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl px-6 py-8 hover:border-primary-400 transition-colors cursor-pointer"
            @click="($refs.fileInput as HTMLInputElement).click()"
          >
            <UIcon name="i-lucide-upload-cloud" class="w-8 h-8 text-gray-400" />
            <p class="text-sm text-gray-500">
              <span v-if="file" class="font-medium text-gray-900 dark:text-white">{{ file.name }}</span>
              <span v-else>Click to select your WordPress export file</span>
            </p>
            <p v-if="!file" class="text-xs text-gray-400">Export from WordPress: Tools → Export → All content</p>
            <input ref="fileInput" type="file" accept=".xml" class="sr-only" @change="onFileChange">
          </div>
        </UFormField>

        <UAlert v-if="error" icon="i-lucide-circle-x" color="red" variant="soft" :description="error" />

        <UAlert
          v-if="result"
          icon="i-lucide-circle-check"
          color="green"
          variant="soft"
          title="Import complete"
          :description="`Imported ${result.imported} items (${result.skipped} skipped as duplicates), ${result.categories} categories, ${result.tags} tags.`"
        />
      </div>

      <template #footer>
        <div class="flex items-center justify-between">
          <p class="text-xs text-gray-400">Duplicate slugs are skipped automatically</p>
          <UButton
            :loading="importing"
            :disabled="!file"
            icon="i-lucide-upload"
            @click="runImport"
          >
            Import
          </UButton>
        </div>
      </template>
    </UCard>
  </div>
</template>
