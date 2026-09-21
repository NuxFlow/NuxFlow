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
const bulkAltLoading = ref(false)
type BulkAltTextResponse = { processed?: number; skipped?: number; total?: number; processing?: boolean; mediaIds?: string[]; capped?: boolean; remaining?: number }
const bulkAltResult = ref<BulkAltTextResponse | null>(null)
const toast = useToast()

// The bulk alt-text endpoint fires a background `waitUntil` job on Cloudflare and
// returns immediately with `{ processing: true, mediaIds }` — there's no push/webhook
// telling us when it finishes, so poll the media list (mirrors the video-processing
// poller in videos.vue, both built on the shared usePollingUntil()) until every
// targeted item has non-empty alt text, or bail out after a couple of minutes with a
// "still processing" toast rather than polling forever.
//
// The endpoint also caps how many images it processes per invocation (currently 50 — see
// MAX_IMAGES_PER_RUN in bulk-alt-text.post.ts) and reports `capped`/`remaining` when the
// media library has more untagged images than that. When a batch finishes and more remain,
// automatically kick off the next batch rather than requiring a manual re-click — bounded
// by BULK_ALT_MAX_ROUNDS so a server-side bug that always reports `capped: true` can't spin
// this into an unbounded loop of AI-provider calls.
const BULK_ALT_POLL_INTERVAL_MS = 5000
const BULK_ALT_POLL_TIMEOUT_MS = 2 * 60 * 1000
const BULK_ALT_MAX_ROUNDS = 20 // 20 x 50-image batches = up to 1000 images per click
let bulkAltRound = 0
let bulkAltTargetIds: string[] = []
let bulkAltCapped = false

const bulkAltPoll = usePollingUntil({
  intervalMs: BULK_ALT_POLL_INTERVAL_MS,
  timeoutMs: BULK_ALT_POLL_TIMEOUT_MS,
  onTick: refresh,
  until: () => bulkAltTargetIds.every((id) => {
    const file = files.value.find(f => f.id === id)
    return !!file?.altText
  }),
  onComplete: async () => {
    if (bulkAltCapped && bulkAltRound < BULK_ALT_MAX_ROUNDS) {
      toast.add({ title: 'Batch complete — starting next batch…', color: 'info' })
      await runBulkAltTextBatch()
    } else if (bulkAltCapped) {
      toast.add({
        title: 'More images remain',
        description: 'Click "Generate alt text" again to continue processing the rest of the library.',
        color: 'warning',
      })
    } else {
      toast.add({ title: 'Alt text generation complete', color: 'success' })
    }
  },
  onTimeout: () => {
    toast.add({
      title: 'Still processing',
      description: 'Alt text generation is taking longer than expected — refresh the page later to see the results.',
      color: 'warning',
    })
  },
})

function startBulkAltPoller(targetIds: string[], capped: boolean) {
  if (!targetIds.length) {
    bulkAltPoll.stop()
    return
  }
  bulkAltTargetIds = targetIds
  bulkAltCapped = capped
  bulkAltPoll.start()
}

// Entry point for a manual click — resets the round counter so a fresh click always gets
// the full BULK_ALT_MAX_ROUNDS budget, regardless of how many auto-continuation rounds a
// previous click already used.
async function runBulkAltText() {
  bulkAltRound = 0
  await runBulkAltTextBatch()
}

async function runBulkAltTextBatch() {
  bulkAltLoading.value = true
  bulkAltResult.value = null
  bulkAltRound++
  try {
    const res = await $fetch<BulkAltTextResponse>('/api/v1/ai/bulk-alt-text', {
      method: 'POST',
      body: {},
    })
    bulkAltResult.value = res
    if (res.processing) {
      toast.add({ title: `Generating alt text for ${res.total} images in background…`, color: 'info' })
      startBulkAltPoller(res.mediaIds ?? [], !!res.capped)
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
  } catch {
    // AI not configured — fail silently
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
          :loading="bulkAltLoading || bulkAltPoll.pending.value"
          :disabled="bulkAltPoll.pending.value"
          :title="bulkAltPoll.pending.value ? 'Alt text is generating in the background…' : 'Generate alt text for all images missing it'"
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
