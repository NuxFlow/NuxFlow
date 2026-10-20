<script setup lang="ts">
// Media library picker. Single-select by default (featured images, SEO images, the
// Image block); `multiple` is used by Gallery/Carousel image lists, where a
// photographer adds a whole shoot at once — so it can filter by folder, sort by file
// name (camera order), select everything shown, and keep loading past one page.
const props = withDefaults(defineProps<{ multiple?: boolean }>(), { multiple: false })

interface PickedFile { url: string; altText?: string; caption?: string; width?: number | null; height?: number | null }

const emit = defineEmits<{
  select: [PickedFile]
  selectMany: [PickedFile[]]
}>()

interface MediaFile {
  id: string
  url: string
  originalName: string
  altText?: string | null
  caption?: string | null
  mimeType: string
  width?: number | null
  height?: number | null
}

interface Folder { id: string; name: string; fileCount: number }

const PAGE_SIZE = 200

const folderId = ref<string>('all')
const sort = ref<'newest' | 'name'>(props.multiple ? 'name' : 'newest')
const files = ref<MediaFile[]>([])
const total = ref(0)
const page = ref(0)
const loading = ref(false)
const loadError = ref('')

const { data: folderData } = useFetch<{ folders: Folder[]; unfolderedCount: number }>('/api/v1/media/folders')

const folderItems = computed(() => [
  { label: 'All media', value: 'all' },
  { label: `Not in a folder (${folderData.value?.unfolderedCount ?? 0})`, value: 'none' },
  ...(folderData.value?.folders ?? []).map(f => ({ label: `${f.name} (${f.fileCount})`, value: f.id })),
])

const sortItems = [
  { label: 'Newest first', value: 'newest' },
  { label: 'File name (A–Z)', value: 'name' },
]

async function loadPage(reset: boolean) {
  if (loading.value) return
  loading.value = true
  loadError.value = ''
  const nextPage = reset ? 1 : page.value + 1
  try {
    const query: Record<string, string | number> = { limit: PAGE_SIZE, page: nextPage, sort: sort.value }
    if (folderId.value === 'none') query.folderId = 'null'
    else if (folderId.value !== 'all') query.folderId = folderId.value
    const res = await $fetch<{ files: MediaFile[]; total: number }>('/api/v1/media', { query })
    files.value = reset ? res.files : [...files.value, ...res.files]
    total.value = res.total
    page.value = nextPage
  }
  catch {
    loadError.value = 'Could not load the media library.'
  }
  finally {
    loading.value = false
  }
}

onMounted(() => loadPage(true))
watch([folderId, sort], () => loadPage(true))

const search = ref('')
const filtered = computed(() => {
  const q = search.value.toLowerCase()
  return files.value.filter(f =>
    (!props.multiple || f.mimeType.startsWith('image/'))
    && f.originalName.toLowerCase().includes(q),
  )
})

function toPicked(file: MediaFile): PickedFile {
  return { url: file.url, altText: file.altText ?? '', caption: file.caption ?? '', width: file.width, height: file.height }
}

// ── Multi-select ────────────────────────────────────────────────────────────
// Kept as an ordered list, so images are added in the order they were clicked.
const selectedIds = ref<string[]>([])
const selectedSet = computed(() => new Set(selectedIds.value))

function toggle(file: MediaFile) {
  selectedIds.value = selectedSet.value.has(file.id)
    ? selectedIds.value.filter(id => id !== file.id)
    : [...selectedIds.value, file.id]
}

const allShownSelected = computed(() => filtered.value.length > 0 && filtered.value.every(f => selectedSet.value.has(f.id)))

function toggleAllShown() {
  if (allShownSelected.value) {
    const shown = new Set(filtered.value.map(f => f.id))
    selectedIds.value = selectedIds.value.filter(id => !shown.has(id))
  }
  else {
    selectedIds.value = [...selectedIds.value, ...filtered.value.filter(f => !selectedSet.value.has(f.id)).map(f => f.id)]
  }
}

// Selections survive a folder switch, so the files they refer to are remembered here.
const known = new Map<string, MediaFile>()
watch(files, list => list.forEach(f => known.set(f.id, f)), { immediate: true })

function addSelected() {
  const picked = selectedIds.value.map(id => known.get(id)).filter((f): f is MediaFile => Boolean(f))
  if (picked.length) emit('selectMany', picked.map(toPicked))
}

function onTileClick(file: MediaFile) {
  if (props.multiple) toggle(file)
  else emit('select', toPicked(file))
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap gap-2">
      <UInput v-model="search" placeholder="Search loaded media…" icon="i-lucide-search" class="flex-1 min-w-40" />
      <USelect v-model="folderId" :items="folderItems" class="w-52" aria-label="Folder" />
      <USelect v-model="sort" :items="sortItems" class="w-40" aria-label="Sort order" />
    </div>

    <div v-if="multiple" class="flex items-center justify-between text-xs text-gray-500">
      <button type="button" class="hover:text-primary-500 disabled:opacity-40" :disabled="!filtered.length" @click="toggleAllShown">
        {{ allShownSelected ? 'Deselect all shown' : `Select all ${filtered.length} shown` }}
      </button>
      <span v-if="selectedIds.length">{{ selectedIds.length }} selected</span>
    </div>

    <div class="grid grid-cols-4 sm:grid-cols-5 gap-2 max-h-96 overflow-y-auto">
      <button
        v-for="file in filtered"
        :key="file.id"
        type="button"
        class="relative aspect-square rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 hover:ring-2 ring-primary-500 transition-all"
        :class="selectedSet.has(file.id) ? 'ring-2' : ''"
        :aria-pressed="multiple ? selectedSet.has(file.id) : undefined"
        :title="file.originalName"
        @click="onTileClick(file)"
      >
        <img
          v-if="file.mimeType.startsWith('image/')"
          :src="file.url"
          :alt="file.altText || file.originalName"
          loading="lazy"
          class="w-full h-full object-cover"
        >
        <div v-else class="w-full h-full flex items-center justify-center">
          <UIcon name="i-lucide-file" class="w-6 h-6 text-gray-300" />
        </div>
        <span
          v-if="multiple && selectedSet.has(file.id)"
          class="absolute top-1 right-1 min-w-5 h-5 px-1 rounded-full bg-primary-500 text-white text-[10px] font-semibold flex items-center justify-center"
        >
          {{ selectedIds.indexOf(file.id) + 1 }}
        </span>
      </button>
    </div>

    <p v-if="loadError" class="text-sm text-center text-red-500 py-2">{{ loadError }}</p>
    <p v-else-if="!loading && !filtered.length" class="text-sm text-center text-gray-400 py-4">No media found</p>

    <div class="flex items-center justify-between gap-2">
      <UButton
        v-if="files.length < total"
        variant="ghost"
        size="sm"
        :loading="loading"
        @click="loadPage(false)"
      >
        Load more ({{ files.length }} of {{ total }})
      </UButton>
      <span v-else />
      <UButton
        v-if="multiple"
        size="sm"
        icon="i-lucide-plus"
        :disabled="!selectedIds.length"
        @click="addSelected"
      >
        Add {{ selectedIds.length || '' }} {{ selectedIds.length === 1 ? 'image' : 'images' }}
      </UButton>
    </div>
  </div>
</template>
