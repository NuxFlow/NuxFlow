<script setup lang="ts">
import type { MediaDetailForm } from '~/components/admin/media/MediaDetailPanel.vue'

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

const MEDIA_PAGE_SIZE = 60
const mediaPage = ref(1)
const files = ref<MediaFile[]>([])
const hasMoreMedia = ref(false)
const loadingMoreMedia = ref(false)

function folderQuery(): Record<string, string> {
  const q: Record<string, string> = { limit: String(MEDIA_PAGE_SIZE) }
  if (selectedFolderId.value !== undefined) q.folderId = selectedFolderId.value === null ? 'null' : selectedFolderId.value
  return q
}

const { data, refresh: refreshMedia } = await useFetch<{ files: MediaFile[] }>('/api/v1/media', {
  query: computed(() => folderQuery()),
  watch: [selectedFolderId],
})

watch(data, (val) => {
  files.value = val?.files ?? []
  mediaPage.value = 1
  hasMoreMedia.value = (val?.files?.length ?? 0) === MEDIA_PAGE_SIZE
}, { immediate: true })

async function loadMoreMedia() {
  loadingMoreMedia.value = true
  try {
    const next = mediaPage.value + 1
    const res = await $fetch<{ files: MediaFile[] }>('/api/v1/media', {
      query: { ...folderQuery(), page: String(next) },
    })
    files.value = [...files.value, ...res.files]
    mediaPage.value = next
    hasMoreMedia.value = res.files.length === MEDIA_PAGE_SIZE
  } finally {
    loadingMoreMedia.value = false
  }
}

async function refresh() {
  await Promise.all([refreshFolders(), refreshMedia()])
}

// ── Upload ────────────────────────────────────────────────────────────────────
const { loading: uploading, run: runUpload } = useAdminAction()
const fileInput = ref<HTMLInputElement>()

// ── AI image generation ───────────────────────────────────────────────────────
const showAiImageModal = ref(false)

function onAiImageGenerated(url: string) {
  showAiImageModal.value = false
  refresh()
  toast.add({ title: 'Image saved to media library', color: 'success', description: url.slice(0, 60) })
}

// ── Bulk alt text ─────────────────────────────────────────────────────────────
// The endpoint handles a small batch per request, inline (see bulk-alt-text.post.ts for why
// it no longer runs in the background), so this just calls it in a loop while it reports
// more images waiting, updating the library as each batch lands. Images that fail are sent
// back as `skipIds` so they aren't retried on every batch. Bounded by BULK_ALT_MAX_BATCHES
// so a server-side bug that always reports `hasMore` can't spin into an unbounded loop of
// AI-provider calls.
const BULK_ALT_MAX_BATCHES = 200 // x 5 images = up to 1000 images per click
type BulkAltTextResponse = { processed: number; skipped: number; updated: Array<{ id: string; altText: string }>; failed: string[]; hasMore: boolean }
const bulkAltLoading = ref(false)
const bulkAltProgress = ref({ done: 0, failed: 0 })
let bulkAltCancelled = false
const toast = useToast()

onBeforeUnmount(() => { bulkAltCancelled = true })

async function runBulkAltText() {
  bulkAltLoading.value = true
  bulkAltCancelled = false
  bulkAltProgress.value = { done: 0, failed: 0 }
  const skipIds: string[] = []
  try {
    for (let batch = 0; batch < BULK_ALT_MAX_BATCHES && !bulkAltCancelled; batch++) {
      const res = await $fetch<BulkAltTextResponse>('/api/v1/ai/bulk-alt-text', {
        method: 'POST',
        body: { skipIds },
      })
      skipIds.push(...res.failed)
      bulkAltProgress.value = { done: bulkAltProgress.value.done + res.processed, failed: bulkAltProgress.value.failed + res.skipped }
      for (const { id, altText } of res.updated) {
        const file = files.value.find(f => f.id === id)
        if (file) file.altText = altText
      }
      if (!res.hasMore) break
    }
    const { done, failed } = bulkAltProgress.value
    if (!done && !failed) {
      toast.add({ title: 'Every image already has alt text', color: 'info' })
    }
    else {
      toast.add({
        title: `Alt text generated for ${done} image${done !== 1 ? 's' : ''}`,
        description: failed ? `${failed} image${failed !== 1 ? 's' : ''} couldn't be processed — check the AI provider settings, or try those again later.` : undefined,
        color: failed ? 'warning' : 'success',
      })
    }
  }
  catch (e: unknown) {
    toast.add({ title: 'Failed to generate alt text', description: getErrorMessage(e, ''), color: 'error' })
  }
  finally {
    bulkAltLoading.value = false
    await refresh()
  }
}

async function uploadFiles(fileList: File[]) {
  await runUpload(async () => {
    for (const file of fileList) {
      const fd = new FormData()
      fd.append('file', file)
      const result = await $fetch<{ id: string }>('/api/v1/media/upload', { method: 'POST', body: fd })
      if (selectedFolderId.value !== undefined && selectedFolderId.value !== null) {
        await $fetch<unknown>(`/api/v1/media/${result.id}`, {
          method: 'PATCH',
          body: { folderId: selectedFolderId.value },
        })
      }
    }
    await refresh()
  }, { errorTitle: 'Failed to upload file' })
}

async function handleUpload(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files?.length) return
  await uploadFiles(Array.from(input.files))
  if (fileInput.value) fileInput.value.value = ''
}

async function onDrop(e: DragEvent) {
  e.preventDefault()
  const dropped = Array.from(e.dataTransfer?.files ?? [])
  if (!dropped.length) return
  await uploadFiles(dropped)
}

// ── Folders ───────────────────────────────────────────────────────────────────
const creatingFolder = ref(false)
const newFolderName = ref('')
const folderSidebar = ref<{ focusInput: () => void } | null>(null)
const { run: runCreateFolder } = useAdminAction()
const { run: runDeleteFolder } = useAdminAction()

async function createFolder() {
  const name = newFolderName.value.trim()
  if (!name) return
  await runCreateFolder(async () => {
    await $fetch<unknown>('/api/v1/media/folders', { method: 'POST', body: { name } })
    newFolderName.value = ''
    creatingFolder.value = false
    await refreshFolders()
  }, { errorTitle: 'Failed to create folder' })
}

function startCreatingFolder() {
  creatingFolder.value = true
  nextTick(() => folderSidebar.value?.focusInput())
}

function cancelCreatingFolder() {
  creatingFolder.value = false
  newFolderName.value = ''
}

async function deleteFolder(id: string) {
  const ok = await useConfirm().confirm({
    title: 'Delete this folder?',
    description: 'Files inside will be moved to All files.',
    confirmLabel: 'Delete',
  })
  if (!ok) return
  await runDeleteFolder(async () => {
    await $fetch<unknown>(`/api/v1/media/folders/${id}`, { method: 'DELETE' })
    if (selectedFolderId.value === id) selectedFolderId.value = undefined
    await refresh()
  }, { errorTitle: 'Failed to delete folder' })
}

// ── Detail panel ──────────────────────────────────────────────────────────────
const showDetail = ref(false)
const detail = ref<MediaFile | null>(null)
const detailForm = ref<MediaDetailForm>({ altText: '', caption: '', folderId: null, focalX: null, focalY: null })
const { loading: savingDetail, run: runSaveDetail } = useAdminAction()
const { loading: deletingDetail, run: runDeleteFile } = useAdminAction()
const detailAiLoading = ref(false)
const detailLoading = ref(false)

async function generateDetailAltText() {
  if (!detail.value) return
  detailAiLoading.value = true
  try {
    const res = await $fetch<{ altText: string }>('/api/v1/ai/alt-text', {
      method: 'POST',
      body: { mediaId: detail.value.id },
    })
    detailForm.value = { ...detailForm.value, altText: res.altText }
  } catch (e: unknown) {
    toast.add({ title: "Couldn't generate alt text", description: getErrorMessage(e, 'Check the AI provider in Settings → AI.'), color: 'error' })
  } finally {
    detailAiLoading.value = false
  }
}

async function openDetail(file: MediaFile) {
  detail.value = file
  detailForm.value = {
    altText: file.altText ?? '',
    caption: file.caption ?? '',
    folderId: file.folderId ?? null,
    focalX: file.focalX ?? null,
    focalY: file.focalY ?? null,
  }
  showDetail.value = true

  // The list projection (`GET /api/v1/media`) deliberately excludes `metadata` (EXIF) to
  // keep the grid payload small — fetch the full row here so the detail modal can show it.
  detailLoading.value = true
  try {
    const full = await $fetch<MediaFile>(`/api/v1/media/${file.id}`)
    // Guard against the user opening a different file before this resolves.
    if (detail.value?.id === file.id) {
      detail.value = full
    }
  } catch {
    // Keep the list-projection fallback already applied above — worst case, EXIF
    // just doesn't show for this file.
  } finally {
    detailLoading.value = false
  }
}

async function saveDetail() {
  if (!detail.value) return
  const target = detail.value
  const form = detailForm.value
  await runSaveDetail(async () => {
    await $fetch<unknown>(`/api/v1/media/${target.id}`, {
      method: 'PATCH',
      body: {
        altText: form.altText || null,
        caption: form.caption || null,
        folderId: form.folderId,
        focalX: form.focalX,
        focalY: form.focalY,
      },
    })
    await refresh()
    showDetail.value = false
  }, { errorTitle: 'Failed to save changes' })
}

async function deleteFile() {
  if (!detail.value) return
  const target = detail.value
  const ok = await useConfirm().confirm({
    title: `Delete "${target.originalName}"?`,
    description: 'This cannot be undone.',
    confirmLabel: 'Delete',
  })
  if (!ok) return
  await runDeleteFile(async () => {
    await $fetch<unknown>(`/api/v1/media/${target.id}`, { method: 'DELETE' })
    showDetail.value = false
    await refresh()
  }, { errorTitle: 'Failed to delete file' })
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function isImage(mime: string) { return mime.startsWith('image/') }

const folderOptions = computed(() => [
  { label: 'No folder', value: null },
  ...folders.value.map(f => ({ label: f.name, value: f.id })),
])

function copyUrl(url: string) {
  window.navigator.clipboard.writeText(url)
}
</script>

<template>
  <div class="space-y-4">
    <AdminMediaFallbackWarning />

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
          {{ bulkAltLoading ? `Alt text… ${bulkAltProgress.done + bulkAltProgress.failed} done` : 'Auto alt text' }}
        </UButton>
        <UButton icon="i-lucide-upload" :loading="uploading" @click="fileInput?.click()">
          Upload
        </UButton>
      </div>
      <input ref="fileInput" type="file" multiple class="sr-only" @change="handleUpload">
    </div>

    <div class="flex gap-4 items-start">
      <MediaFolderSidebar
        ref="folderSidebar"
        :folders="folders"
        :unfoldered-count="unfolderedCount"
        :total-files-count="files.length"
        :selected-folder-id="selectedFolderId"
        :creating-folder="creatingFolder"
        :new-folder-name="newFolderName"
        @select="(id: string | null | undefined) => (selectedFolderId = id)"
        @update:new-folder-name="(v: string) => (newFolderName = v)"
        @start-create="startCreatingFolder"
        @submit-create="createFolder"
        @cancel-create="cancelCreatingFolder"
        @delete="deleteFolder"
      />

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
            <div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-2">
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

        <div v-if="hasMoreMedia" class="flex justify-center pt-2">
          <UButton variant="outline" color="neutral" size="sm" :loading="loadingMoreMedia" @click="loadMoreMedia">
            Load more
          </UButton>
        </div>

        <div v-else-if="!files.length" class="text-center py-12 text-gray-400">
          <UIcon name="i-lucide-image" class="w-10 h-10 mx-auto mb-2 opacity-50" />
          <p class="text-sm">{{ selectedFolderId !== undefined ? 'No files in this folder' : 'No media uploaded yet' }}</p>
        </div>
      </div>
    </div>

    <MediaDetailPanel
      v-model:open="showDetail"
      v-model:form="detailForm"
      :file="detail"
      :folder-options="folderOptions"
      :loading="detailLoading"
      :saving="savingDetail"
      :deleting="deletingDetail"
      :ai-loading="detailAiLoading"
      @save="saveDetail"
      @delete="deleteFile"
      @generate-alt-text="generateDetailAltText"
    />

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
