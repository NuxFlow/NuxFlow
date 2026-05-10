<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

const { data, refresh } = await useFetch('/api/v1/media')
const files = computed(() => data.value?.files ?? [])

const uploading = ref(false)
const fileInput = ref<HTMLInputElement>()

function isImage(mime: string) { return mime.startsWith('image/') }
function copyUrl(url: string) { window.navigator.clipboard.writeText(url) }

async function handleUpload(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files?.length) return

  uploading.value = true
  try {
    for (const file of Array.from(input.files)) {
      const fd = new FormData()
      fd.append('file', file)
      await $fetch('/api/v1/media/upload', { method: 'POST', body: fd })
    }
    await refresh()
  } finally {
    uploading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

async function onDrop(e: DragEvent) {
  e.preventDefault()
  const files = Array.from(e.dataTransfer?.files ?? [])
  if (!files.length) return
  uploading.value = true
  try {
    for (const file of files) {
      const fd = new FormData()
      fd.append('file', file)
      await $fetch('/api/v1/media/upload', { method: 'POST', body: fd })
    }
    await refresh()
  } finally {
    uploading.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-bold text-gray-900 dark:text-white">Media library</h1>
      <UButton icon="i-lucide-upload" :loading="uploading" @click="fileInput?.click()">
        Upload
      </UButton>
      <input ref="fileInput" type="file" multiple class="sr-only" @change="handleUpload" >
    </div>

    <!-- Drop zone -->
    <div
      class="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-8 text-center transition-colors hover:border-primary-400"
      @dragover.prevent
      @drop="onDrop"
    >
      <UIcon name="i-lucide-upload-cloud" class="w-8 h-8 text-gray-300 mx-auto mb-2" />
      <p class="text-sm text-gray-400">Drop files here or <button class="text-primary-500 hover:underline" @click="fileInput?.click()">browse</button></p>
      <p class="text-xs text-gray-300 mt-1">Max 20 MB per file</p>
    </div>

    <!-- Grid -->
    <div v-if="files.length" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
      <div
        v-for="file in files"
        :key="file.id"
        class="group relative aspect-square rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
      >
        <img
          v-if="isImage(file.mimeType)"
          :src="file.url"
          :alt="file.altText || file.originalName"
          class="w-full h-full object-cover"
        >
        <div v-else class="w-full h-full flex items-center justify-center">
          <UIcon name="i-lucide-file" class="w-8 h-8 text-gray-400" />
        </div>
        <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <UButton size="xs" variant="solid" color="neutral" icon="i-lucide-copy" @click="copyUrl(file.url)" />
        </div>
      </div>
    </div>

    <div v-else class="text-center py-12 text-gray-400">
      <UIcon name="i-lucide-image" class="w-10 h-10 mx-auto mb-2 opacity-50" />
      <p class="text-sm">No media uploaded yet</p>
    </div>
  </div>
</template>
