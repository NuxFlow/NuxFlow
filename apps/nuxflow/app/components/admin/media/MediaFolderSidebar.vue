<script setup lang="ts">
// Presentational folder list + create/delete UI extracted from media/index.vue —
// the parent still owns all folder state and the actual fetch calls (create/delete/
// select), this component just renders the list and bubbles user intent up via emits.
interface Folder { id: string; name: string; fileCount: number }

defineProps<{
  folders: Folder[]
  unfolderedCount: number
  totalFilesCount: number
  selectedFolderId: string | null | undefined
  creatingFolder: boolean
  newFolderName: string
}>()

const emit = defineEmits<{
  select: [id: string | null | undefined]
  'update:newFolderName': [name: string]
  'start-create': []
  'submit-create': []
  'cancel-create': []
  delete: [id: string]
}>()

// UInput's exposed instance shape is enough here — only its root element is needed
// to reach the underlying native <input> for the manual focus() call below.
const newFolderInput = ref<{ $el?: HTMLElement } | null>(null)

// Called by the parent (via a template ref to this component) right after it flips
// `creatingFolder` to true, mirroring the original inline nextTick-focus behavior.
defineExpose({
  focusInput: () => newFolderInput.value?.$el?.querySelector('input')?.focus(),
})
</script>

<template>
  <aside class="w-44 shrink-0 space-y-0.5">
    <button
      class="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors"
      :class="selectedFolderId === undefined ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'"
      @click="emit('select', undefined)"
    >
      <span class="flex items-center gap-2">
        <UIcon name="i-lucide-images" class="w-4 h-4" />
        All files
      </span>
      <span class="text-xs opacity-60">{{ totalFilesCount }}</span>
    </button>

    <button
      class="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors"
      :class="selectedFolderId === null ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'"
      @click="emit('select', null)"
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
      @click="emit('select', folder.id)"
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
          class="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 -mr-1"
          @click.stop="emit('delete', folder.id)"
        />
      </span>
    </div>

    <div v-if="creatingFolder" class="px-1 pt-1">
      <UInput
        ref="newFolderInput"
        :model-value="newFolderName"
        size="sm"
        placeholder="Folder name"
        autofocus
        @update:model-value="(v) => emit('update:newFolderName', String(v))"
        @keyup.enter="emit('submit-create')"
        @keyup.escape="emit('cancel-create')"
      />
      <div class="flex gap-1 mt-1">
        <UButton size="xs" @click="emit('submit-create')">Add</UButton>
        <UButton size="xs" variant="ghost" @click="emit('cancel-create')">Cancel</UButton>
      </div>
    </div>
    <button
      v-else
      class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      @click="emit('start-create')"
    >
      <UIcon name="i-lucide-folder-plus" class="w-4 h-4" />
      New folder
    </button>
  </aside>
</template>
