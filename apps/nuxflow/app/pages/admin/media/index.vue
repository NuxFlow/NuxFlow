<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

interface ExifInfo {
  make?: string; model?: string; exposureTime?: string
  fNumber?: number; iso?: number; dateTimeOriginal?: string; focalLength?: number
}
type MediaFile = {
  id: string; originalName: string; mimeType: string; size: number
  url: string; altText: string | null; caption: string | null
  folderId: string | null; width: number | null; height: number | null
  focalX: number | null; focalY: number | null
  metadata?: { exif?: ExifInfo } | null
  createdAt: string
}
type Folder = { id: string; name: string; fileCount: number }

// ── Data ──────────────────────────────────────────────────────────────────────
const selectedFolderId = ref<string | null | undefined>(undefined) // undefined = all

interface FolderPayload {
  folders?: Folder[]
  unfolderedCount?: number
}

const { data: folderData, refresh: refreshFolders } = await useFetch<FolderPayload>('/api/v1/media/folders')
const folders = computed<Folder[]>(() => folderData.value?.folders ?? [])
const unfolderedCount = computed(() => folderData.value?.unfolderedCount ?? 0)

const mediaUrl = computed(() => {
  if (selectedFolderId.value === undefined) return '/api/v1/media'
  return `/api/v1/media?folderId=${selectedFolderId.value === null ? 'null' : selectedFolderId.value}`
})
const { data, refresh: refreshMedia } = await useFetch<{ files: MediaFile[] }>(mediaUrl)
const files = computed<MediaFile[]>(() => data.value?.files ?? [])

async function refresh() {
  await Promise.all([refreshFolders(), refreshMedia()])
}

// ── Upload ────────────────────────────────────────────────────────────────────
const uploading = ref(false)
const fileInput = ref<HTMLInputElement>()

// ── AI image generation ───────────────────────────────────────────────────────
const showAiImageModal = ref(false)

function onAiImageGenerated(url: string) {
  showAiImageModal.value = false
  refresh()
  toast.add({ title: 'Image saved to media library', color: 'success', description: url.slice(0, 60) })
}

// ── Bulk alt text ─────────────────────────────────────────────────────────────
const bulkAltLoading = ref(false)
const bulkAltResult = ref<{ processed?: number; total?: number; processing?: boolean } | null>(null)
const toast = useToast()

async function runBulkAltText() {
  bulkAltLoading.value = true
  bulkAltResult.value = null
  try {
    const res = await $fetch<{ processed?: number; total?: number; processing?: boolean }>('/api/v1/ai/bulk-alt-text', {
      method: 'POST',
      body: {},
    })
    bulkAltResult.value = res
    if (res.processing) {
      toast.add({ title: `Generating alt text for ${res.total} images in background…`, color: 'info' })
    } else if (res.processed !== undefined) {
      toast.add({ title: `Alt text generated for ${res.processed} image${res.processed !== 1 ? 's' : ''}`, color: 'success' })
      await refresh()
    }
  } catch {
    toast.add({ title: 'Failed to generate alt text', color: 'error' })
  } finally {
    bulkAltLoading.value = false
  }
}

async function handleUpload(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files?.length) return
  uploading.value = true
  try {
    for (const file of Array.from(input.files)) {
      const fd = new FormData()
      fd.append('file', file)
      const result = await $fetch<{ id: string }>('/api/v1/media/upload', { method: 'POST', body: fd })
      if (selectedFolderId.value !== undefined && selectedFolderId.value !== null) {
        await $fetch(`/api/v1/media/${result.id}`, {
          method: 'PATCH',
          body: { folderId: selectedFolderId.value },
        })
      }
    }
    await refresh()
  } finally {
    uploading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

async function onDrop(e: DragEvent) {
  e.preventDefault()
  const dropped = Array.from(e.dataTransfer?.files ?? [])
  if (!dropped.length) return
  uploading.value = true
  try {
    for (const file of dropped) {
      const fd = new FormData()
      fd.append('file', file)
      const result = await $fetch<{ id: string }>('/api/v1/media/upload', { method: 'POST', body: fd })
      if (selectedFolderId.value !== undefined && selectedFolderId.value !== null) {
        await $fetch(`/api/v1/media/${result.id}`, {
          method: 'PATCH',
          body: { folderId: selectedFolderId.value },
        })
      }
    }
    await refresh()
  } finally {
    uploading.value = false
  }
}

// ── Folders ───────────────────────────────────────────────────────────────────
const creatingFolder = ref(false)
const newFolderName = ref('')
const newFolderInput = ref<HTMLInputElement>()

async function createFolder() {
  const name = newFolderName.value.trim()
  if (!name) return
  await $fetch('/api/v1/media/folders', { method: 'POST', body: { name } })
  newFolderName.value = ''
  creatingFolder.value = false
  await refreshFolders()
}

function startCreatingFolder() {
  creatingFolder.value = true
  nextTick(() => newFolderInput.value?.focus())
}

async function deleteFolder(id: string) {
  if (!confirm('Delete this folder? Files inside will be moved to All files.')) return
  await $fetch(`/api/v1/media/folders/${id}`, { method: 'DELETE' })
  if (selectedFolderId.value === id) selectedFolderId.value = undefined
  await refresh()
}

// ── Detail panel ──────────────────────────────────────────────────────────────
const showDetail = ref(false)
const detail = ref<MediaFile | null>(null)
const detailAltText = ref('')
const detailCaption = ref('')
const detailFolderId = ref<string | null>(null)
const detailFocalX = ref<number | null>(null)
const detailFocalY = ref<number | null>(null)
const savingDetail = ref(false)
const deletingDetail = ref(false)
const copied = ref(false)
const detailAiLoading = ref(false)

async function generateDetailAltText() {
  if (!detail.value) return
  detailAiLoading.value = true
  try {
    const res = await $fetch<{ altText: string }>('/api/v1/ai/alt-text', {
      method: 'POST',
      body: { mediaId: detail.value.id },
    })
    detailAltText.value = res.altText
  } catch {
    // AI not configured — fail silently
  } finally {
    detailAiLoading.value = false
  }
}

function openDetail(file: MediaFile) {
  detail.value = file
  detailAltText.value = file.altText ?? ''
  detailCaption.value = file.caption ?? ''
  detailFolderId.value = file.folderId ?? null
  detailFocalX.value = file.focalX ?? null
  detailFocalY.value = file.focalY ?? null
  showDetail.value = true
  copied.value = false
}

async function saveDetail() {
  if (!detail.value) return
  savingDetail.value = true
  try {
    await $fetch(`/api/v1/media/${detail.value.id}`, {
      method: 'PATCH',
      body: {
        altText: detailAltText.value || null,
        caption: detailCaption.value || null,
        folderId: detailFolderId.value,
        focalX: detailFocalX.value,
        focalY: detailFocalY.value,
      },
    })
    await refresh()
    showDetail.value = false
  } finally {
    savingDetail.value = false
  }
}

async function deleteFile() {
  if (!detail.value) return
  if (!confirm(`Delete "${detail.value.originalName}"? This cannot be undone.`)) return
  deletingDetail.value = true
  try {
    await $fetch(`/api/v1/media/${detail.value.id}`, { method: 'DELETE' })
    showDetail.value = false
    await refresh()
  } finally {
    deletingDetail.value = false
  }
}

function copyUrl(url: string) {
  window.navigator.clipboard.writeText(url)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function isImage(mime: string) { return mime.startsWith('image/') }

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const folderOptions = computed(() => [
  { label: 'No folder', value: null },
  ...folders.value.map(f => ({ label: f.name, value: f.id })),
])

const previewImg = ref<HTMLImageElement | null>(null)

function handleImageClick(event: MouseEvent) {
  const img = previewImg.value
  if (!img) return
  const rect = img.getBoundingClientRect()
  const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width))
  const y = Math.max(0, Math.min(event.clientY - rect.top, rect.height))
  detailFocalX.value = Math.round((x / rect.width) * 100)
  detailFocalY.value = Math.round((y / rect.height) * 100)
}

const detailExif = computed<ExifInfo | null>(() => {
  const meta = detail.value?.metadata
  return (meta && typeof meta === 'object' && meta.exif) ? (meta.exif as ExifInfo) : null
})

function resetFocalPoint() {
  detailFocalX.value = null
  detailFocalY.value = null
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-bold text-gray-900 dark:text-white">Media library</h1>
      <div class="flex items-center gap-2">
        <UButton
          icon="i-lucide-image-plus"
          variant="outline"
          size="sm"
          title="Generate an image with AI"
          @click="showAiImageModal = true"
        >
          AI Image
        </UButton>
        <UButton
          icon="i-lucide-sparkles"
          variant="outline"
          size="sm"
          :loading="bulkAltLoading"
          title="Generate alt text for all images missing it"
          @click="runBulkAltText"
        >
          Auto alt text
        </UButton>
        <UButton icon="i-lucide-upload" :loading="uploading" @click="fileInput?.click()">
          Upload
        </UButton>
      </div>
      <input ref="fileInput" type="file" multiple class="sr-only" @change="handleUpload">
    </div>

    <div class="flex gap-4 items-start">
      <!-- Folder sidebar -->
      <aside class="w-44 shrink-0 space-y-0.5">
        <button
          class="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors"
          :class="selectedFolderId === undefined ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'"
          @click="selectedFolderId = undefined"
        >
          <span class="flex items-center gap-2">
            <UIcon name="i-lucide-images" class="w-4 h-4" />
            All files
          </span>
          <span class="text-xs opacity-60">{{ files.length }}</span>
        </button>

        <button
          class="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors"
          :class="selectedFolderId === null ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'"
          @click="selectedFolderId = null"
        >
          <span class="flex items-center gap-2">
            <UIcon name="i-lucide-inbox" class="w-4 h-4" />
            Unorganised
          </span>
          <span class="text-xs opacity-60">{{ unfolderedCount }}</span>
        </button>

        <UDivider class="my-2" />

        <div
          v-for="folder in folders"
          :key="folder.id"
          class="group w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer"
          :class="selectedFolderId === folder.id ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'"
          @click="selectedFolderId = folder.id"
        >
          <span class="flex items-center gap-2 truncate min-w-0">
            <UIcon name="i-lucide-folder" class="w-4 h-4 shrink-0" />
            <span class="truncate">{{ folder.name }}</span>
          </span>
          <span class="flex items-center gap-1 shrink-0">
            <span class="text-xs opacity-60">{{ folder.fileCount }}</span>
            <UButton
              icon="i-lucide-trash-2"
              size="xs"
              variant="ghost"
              color="error"
              class="opacity-0 group-hover:opacity-100 -mr-1"
              @click.stop="deleteFolder(folder.id)"
            />
          </span>
        </div>

        <div v-if="creatingFolder" class="px-1 pt-1">
          <UInput
            ref="newFolderInput"
            v-model="newFolderName"
            size="sm"
            placeholder="Folder name"
            autofocus
            @keyup.enter="createFolder"
            @keyup.escape="creatingFolder = false; newFolderName = ''"
          />
          <div class="flex gap-1 mt-1">
            <UButton size="xs" @click="createFolder">Add</UButton>
            <UButton size="xs" variant="ghost" @click="creatingFolder = false; newFolderName = ''">Cancel</UButton>
          </div>
        </div>
        <button
          v-else
          class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          @click="startCreatingFolder"
        >
          <UIcon name="i-lucide-folder-plus" class="w-4 h-4" />
          New folder
        </button>
      </aside>

      <!-- Main content -->
      <div class="flex-1 min-w-0 space-y-4">
        <!-- Drop zone -->
        <div
          class="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-6 text-center transition-colors hover:border-primary-400 cursor-pointer"
          @dragover.prevent
          @drop="onDrop"
          @click="fileInput?.click()"
        >
          <UIcon name="i-lucide-upload-cloud" class="w-7 h-7 text-gray-300 mx-auto mb-1" />
          <p class="text-sm text-gray-400">Drop files here or <span class="text-primary-500">browse</span></p>
          <p class="text-xs text-gray-300 mt-0.5">Max 20 MB per file</p>
        </div>

        <!-- Grid -->
        <div v-if="files.length" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          <div
            v-for="file in files"
            :key="file.id"
            class="group relative aspect-square rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 cursor-pointer"
            @click="openDetail(file)"
          >
            <img
              v-if="isImage(file.mimeType)"
              :src="file.url"
              :alt="file.altText || file.originalName"
              class="w-full h-full object-cover"
            >
            <div v-else class="w-full h-full flex flex-col items-center justify-center gap-1 p-2">
              <UIcon name="i-lucide-file" class="w-8 h-8 text-gray-400" />
              <span class="text-xs text-gray-400 text-center truncate w-full">{{ file.originalName }}</span>
            </div>
            <div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-2">
              <span class="text-white text-xs text-center line-clamp-2 leading-tight">{{ file.originalName }}</span>
              <div class="flex gap-1">
                <UButton
                  size="xs"
                  variant="solid"
                  color="neutral"
                  icon="i-lucide-copy"
                  @click.stop="copyUrl(file.url)"
                />
              </div>
            </div>
          </div>
        </div>

        <div v-else class="text-center py-12 text-gray-400">
          <UIcon name="i-lucide-image" class="w-10 h-10 mx-auto mb-2 opacity-50" />
          <p class="text-sm">{{ selectedFolderId !== undefined ? 'No files in this folder' : 'No media uploaded yet' }}</p>
        </div>
      </div>
    </div>

    <!-- File detail modal -->
    <UModal v-model:open="showDetail" :title="detail?.originalName ?? ''" size="lg">
      <template #body>
        <div v-if="detail" class="space-y-4">
          <div class="flex gap-4">
            <!-- Preview with Focal Point Selector -->
            <div
              class="relative w-48 h-48 shrink-0 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center group"
              :class="isImage(detail.mimeType) ? 'cursor-crosshair' : ''"
            >
              <img
                v-if="isImage(detail.mimeType)"
                ref="previewImg"
                :src="detail.url"
                :alt="detail.altText || detail.originalName"
                class="w-full h-full object-cover pointer-events-auto"
                :style="{ objectPosition: `${detailFocalX ?? 50}% ${detailFocalY ?? 50}%` }"
                @click="handleImageClick"
              >
              <!-- Focal point crosshair — positioned in container, which matches object-cover coords 1:1 -->
              <div
                v-if="isImage(detail.mimeType) && detailFocalX !== null && detailFocalY !== null"
                class="absolute w-5 h-5 border-2 border-white rounded-full -translate-x-1/2 -translate-y-1/2 pointer-events-none shadow-lg ring-1 ring-primary-500"
                :style="{ left: detailFocalX + '%', top: detailFocalY + '%' }"
              >
                <div class="absolute inset-0 flex items-center justify-center">
                  <div class="w-1 h-1 bg-primary-500 rounded-full" />
                </div>
              </div>
              <UIcon v-if="!isImage(detail.mimeType)" name="i-lucide-file" class="w-10 h-10 text-gray-400" />
            </div>
            <!-- Metadata -->
            <div class="flex-1 space-y-1 text-sm min-w-0">
              <p class="text-gray-500 dark:text-gray-400 truncate">{{ detail.originalName }}</p>
              <p class="text-gray-400 text-xs">{{ detail.mimeType }} · {{ formatBytes(detail.size) }}</p>
              <p v-if="detail.width && detail.height" class="text-gray-400 text-xs">{{ detail.width }} × {{ detail.height }} px</p>
              <p class="text-gray-400 text-xs">{{ new Date(detail.createdAt).toLocaleDateString() }}</p>
              <UButton
                size="xs"
                variant="outline"
                :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
                :color="copied ? 'success' : 'neutral'"
                class="mt-2"
                @click="copyUrl(detail.url)"
              >
                {{ copied ? 'Copied!' : 'Copy URL' }}
              </UButton>
              <div v-if="isImage(detail.mimeType)" class="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 px-2.5 py-1 rounded mt-2 border border-gray-100 dark:border-gray-800">
                <span v-if="detailFocalX !== null && detailFocalY !== null">Focal: {{ detailFocalX }}%, {{ detailFocalY }}%</span>
                <span v-else class="italic text-gray-400">Click preview to set focal point</span>
                <UButton v-if="detailFocalX !== null || detailFocalY !== null" size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" class="h-5 p-1" @click="resetFocalPoint" />
              </div>
              <!-- EXIF data -->
              <div v-if="detailExif" class="mt-2 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 px-2.5 py-1.5 rounded border border-gray-100 dark:border-gray-800 space-y-0.5">
                <p v-if="detailExif.make || detailExif.model" class="font-medium text-gray-600 dark:text-gray-300">
                  {{ [detailExif.make, detailExif.model].filter(Boolean).join(' ') }}
                </p>
                <div class="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span v-if="detailExif.fNumber">ƒ/{{ detailExif.fNumber }}</span>
                  <span v-if="detailExif.exposureTime">{{ detailExif.exposureTime }}s</span>
                  <span v-if="detailExif.iso">ISO {{ detailExif.iso }}</span>
                  <span v-if="detailExif.focalLength">{{ detailExif.focalLength }}mm</span>
                </div>
                <p v-if="detailExif.dateTimeOriginal" class="text-gray-400">{{ detailExif.dateTimeOriginal?.replace('T', ' ') }}</p>
              </div>
            </div>
          </div>

          <UFormField label="Alt text" hint="Describes the image for screen readers and SEO">
            <div class="flex gap-2">
              <UInput v-model="detailAltText" class="flex-1" placeholder="A descriptive alt text…" />
              <UButton
                v-if="detail?.mimeType?.startsWith('image/')"
                size="sm"
                variant="ghost"
                icon="i-lucide-sparkles"
                :loading="detailAiLoading"
                title="Generate alt text with AI"
                @click="generateDetailAltText"
              />
            </div>
          </UFormField>

          <UFormField label="Caption">
            <UInput v-model="detailCaption" placeholder="Optional caption shown below the image…" />
          </UFormField>

          <UFormField label="Folder">
            <USelect
              v-model="detailFolderId"
              :items="folderOptions"
              value-key="value"
              class="w-full"
            />
          </UFormField>
        </div>
      </template>

      <template #footer>
        <div class="flex justify-between w-full">
          <UButton
            color="error"
            variant="ghost"
            icon="i-lucide-trash-2"
            :loading="deletingDetail"
            @click="deleteFile"
          >
            Delete file
          </UButton>
          <div class="flex gap-2">
            <UButton variant="ghost" @click="showDetail = false">Cancel</UButton>
            <UButton :loading="savingDetail" @click="saveDetail">Save</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- AI image generation modal -->
    <UModal v-model:open="showAiImageModal" title="Generate image with AI">
      <template #body>
        <MediaAiGenerateImageModal
          @generated="(url: string, mediaId?: string) => onAiImageGenerated(url)"
          @close="showAiImageModal = false"
        />
      </template>
    </UModal>
  </div>
</template>
