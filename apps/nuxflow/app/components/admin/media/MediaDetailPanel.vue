<script setup lang="ts">
// File-detail modal (focal-point picker + EXIF + alt/caption/folder form) extracted
// from media/index.vue. Presentational — the parent still owns the fetch-on-open
// (list projection -> full row with EXIF), save, and delete calls; this component
// only edits the local form fields and emits 'save'/'delete'/'generate-alt-text'.
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
export interface MediaDetailForm {
  altText: string
  caption: string
  folderId: string | null
  focalX: number | null
  focalY: number | null
}

const open = defineModel<boolean>('open', { required: true })
const form = defineModel<MediaDetailForm>('form', { required: true })

const props = defineProps<{
  file: MediaFile | null
  folderOptions: { label: string, value: string | null }[]
  loading: boolean
  saving: boolean
  deleting: boolean
  aiLoading: boolean
}>()

const emit = defineEmits<{
  save: []
  delete: []
  'generate-alt-text': []
}>()

const copied = ref(false)
const previewImg = ref<HTMLImageElement | null>(null)

function isImage(mime: string) { return mime.startsWith('image/') }

function copyUrl(url: string) {
  window.navigator.clipboard.writeText(url)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}

function handleImageClick(event: MouseEvent) {
  const img = previewImg.value
  if (!img) return
  const rect = img.getBoundingClientRect()
  const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width))
  const y = Math.max(0, Math.min(event.clientY - rect.top, rect.height))
  form.value = {
    ...form.value,
    focalX: Math.round((x / rect.width) * 100),
    focalY: Math.round((y / rect.height) * 100),
  }
}

function resetFocalPoint() {
  form.value = { ...form.value, focalX: null, focalY: null }
}

const detailExif = computed<ExifInfo | null>(() => {
  const meta = props.file?.metadata
  return (meta && typeof meta === 'object' && meta.exif) ? (meta.exif as ExifInfo) : null
})

// Reset the "Copied!" affordance whenever a different file is opened.
watch(() => props.file?.id, () => { copied.value = false })
</script>

<template>
  <UModal v-model:open="open" :title="file?.originalName ?? ''" size="lg">
    <template #body>
      <div v-if="file" class="space-y-4">
        <div class="flex gap-4">
          <!-- Preview with Focal Point Selector -->
          <div
            class="relative w-48 h-48 shrink-0 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center group"
            :class="isImage(file.mimeType) ? 'cursor-crosshair' : ''"
          >
            <img
              v-if="isImage(file.mimeType)"
              ref="previewImg"
              :src="file.url"
              :alt="form.altText || file.originalName"
              class="w-full h-full object-cover pointer-events-auto"
              :style="{ objectPosition: `${form.focalX ?? 50}% ${form.focalY ?? 50}%` }"
              @click="handleImageClick"
            >
            <!-- Focal point crosshair — positioned in container, which matches object-cover coords 1:1 -->
            <div
              v-if="isImage(file.mimeType) && form.focalX !== null && form.focalY !== null"
              class="absolute w-5 h-5 border-2 border-white rounded-full -translate-x-1/2 -translate-y-1/2 pointer-events-none shadow-lg ring-1 ring-primary-500"
              :style="{ left: form.focalX + '%', top: form.focalY + '%' }"
            >
              <div class="absolute inset-0 flex items-center justify-center">
                <div class="w-1 h-1 bg-primary-500 rounded-full" />
              </div>
            </div>
            <UIcon v-if="!isImage(file.mimeType)" name="i-lucide-file" class="w-10 h-10 text-gray-400" />
          </div>
          <!-- Metadata -->
          <div class="flex-1 space-y-1 text-sm min-w-0">
            <p class="text-gray-500 dark:text-gray-400 truncate">{{ file.originalName }}</p>
            <p class="text-gray-400 text-xs">{{ file.mimeType }} · {{ formatBytes(file.size) }}</p>
            <p v-if="file.width && file.height" class="text-gray-400 text-xs">{{ file.width }} × {{ file.height }} px</p>
            <p class="text-gray-400 text-xs">{{ new Date(file.createdAt).toLocaleDateString() }}</p>
            <UButton
              size="xs"
              variant="outline"
              :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
              :color="copied ? 'success' : 'neutral'"
              class="mt-2"
              @click="copyUrl(file.url)"
            >
              {{ copied ? 'Copied!' : 'Copy URL' }}
            </UButton>
            <div v-if="isImage(file.mimeType)" class="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 px-2.5 py-1 rounded mt-2 border border-gray-100 dark:border-gray-800">
              <span v-if="form.focalX !== null && form.focalY !== null">Focal: {{ form.focalX }}%, {{ form.focalY }}%</span>
              <span v-else class="italic text-gray-400">Click preview to set focal point</span>
              <UButton v-if="form.focalX !== null || form.focalY !== null" size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" class="h-5 p-1" aria-label="Reset focal point" @click="resetFocalPoint" />
            </div>
            <!-- EXIF data -->
            <p v-if="loading && isImage(file.mimeType) && !detailExif" class="text-gray-400 text-xs mt-2 italic">Loading details…</p>
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
            <UInput
              :model-value="form.altText"
              class="flex-1"
              placeholder="A descriptive alt text…"
              @update:model-value="(v) => (form = { ...form, altText: String(v) })"
            />
            <UButton
              v-if="file?.mimeType?.startsWith('image/')"
              size="sm"
              variant="ghost"
              icon="i-lucide-sparkles"
              :loading="aiLoading"
              title="Generate alt text with AI"
              @click="emit('generate-alt-text')"
            />
          </div>
        </UFormField>

        <UFormField label="Caption">
          <UInput
            :model-value="form.caption"
            placeholder="Optional caption shown below the image…"
            @update:model-value="(v) => (form = { ...form, caption: String(v) })"
          />
        </UFormField>

        <UFormField label="Folder">
          <USelect
            :model-value="form.folderId"
            :items="folderOptions"
            value-key="value"
            class="w-full"
            @update:model-value="(v) => (form = { ...form, folderId: v as string | null })"
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
          :loading="deleting"
          @click="emit('delete')"
        >
          Delete file
        </UButton>
        <div class="flex gap-2">
          <UButton variant="ghost" @click="open = false">Cancel</UButton>
          <UButton :loading="saving" @click="emit('save')">Save</UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
