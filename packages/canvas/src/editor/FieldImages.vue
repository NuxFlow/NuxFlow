<script setup lang="ts">
// Extracted from FieldRenderer.vue's 'images' branch — the multi-image list backing a
// CanvasBlockDefinition field of type 'images' (Gallery/Carousel blocks). Owns the
// add/remove/reorder/alt/caption logic and stores its value as the same
// JSON-string-of-{url,alt,...} convention every other 'images'-typed prop uses.
// Photographers add a whole shoot at once, so the library picker runs in multi-select
// mode here and the list can be reordered by dragging or with the arrow buttons.
import { computed, ref } from 'vue'
import draggable from 'vuedraggable'
import UIcon from '@nuxt/ui/components/Icon.vue'
import { parseImageList, type ImageListItem } from '../utils/json'
import { moveItem, type PickedMedia } from '../utils/gallery'
import MediaLibraryPickerButton from './MediaLibraryPickerButton.vue'

const props = defineProps<{
  modelValue?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const parsedImages = computed<ImageListItem[]>(() => parseImageList(props.modelValue))

// vuedraggable needs a stable key per row; the same URL can legitimately appear twice.
const rows = computed(() => parsedImages.value.map((img, i) => ({ key: `${i}:${img.url}`, img })))

function update(images: ImageListItem[]) {
  emit('update:modelValue', JSON.stringify(images))
}

const newImageUrl = ref('')

function addImage() {
  const url = newImageUrl.value.trim()
  if (!url) return
  update([...parsedImages.value, { url, alt: '' }])
  newImageUrl.value = ''
}

function toItem(file: PickedMedia): ImageListItem {
  return {
    url: file.url,
    alt: file.altText ?? '',
    ...(file.width ? { width: file.width } : {}),
    ...(file.height ? { height: file.height } : {}),
    ...(file.caption ? { caption: file.caption } : {}),
  }
}

function addFromLibrary(files: PickedMedia[]) {
  update([...parsedImages.value, ...files.map(toItem)])
}

function removeImage(i: number) {
  update(parsedImages.value.filter((_, idx) => idx !== i))
}

function removeAll() {
  if (window.confirm(`Remove all ${parsedImages.value.length} images from this block? The files stay in the media library.`)) update([])
}

function move(i: number, to: number) {
  update(moveItem(parsedImages.value, i, to))
}

function onDragged(newRows: Array<{ img: ImageListItem }>) {
  update(newRows.map(r => r.img))
}

function updateField(i: number, key: 'alt' | 'caption', value: string) {
  update(parsedImages.value.map((img, idx) => {
    if (idx !== i) return img
    const next = { ...img, [key]: value }
    if (key === 'caption' && !value) delete next.caption
    return next
  }))
}

const inputClass = 'w-full min-w-0 px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-primary-500'
const iconBtnClass = 'shrink-0 p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30 disabled:hover:text-gray-400 transition-colors rounded'
</script>

<template>
  <div class="space-y-3">
    <div v-if="parsedImages.length" class="flex items-center justify-between text-xs text-gray-500">
      <span>{{ parsedImages.length }} {{ parsedImages.length === 1 ? 'image' : 'images' }} — drag to reorder</span>
      <button type="button" class="hover:text-red-500 transition-colors" @click="removeAll">
        Remove all
      </button>
    </div>
    <draggable
      v-if="parsedImages.length"
      :model-value="rows"
      item-key="key"
      handle=".field-images-handle"
      class="space-y-1.5 max-h-[28rem] overflow-y-auto pr-1"
      @update:model-value="onDragged"
    >
      <template #item="{ element, index }">
        <div class="flex items-start gap-2 p-2 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <button
            type="button"
            class="field-images-handle shrink-0 self-center cursor-grab text-gray-300 hover:text-gray-500"
            :aria-label="`Drag image ${index + 1} to reorder`"
            title="Drag to reorder"
          >
            <UIcon name="i-lucide-grip-vertical" mode="svg" class="w-3.5 h-3.5 block" />
          </button>
          <img
            v-if="element.img.url"
            :src="element.img.url"
            alt=""
            loading="lazy"
            class="w-12 h-12 object-cover rounded shrink-0"
          >
          <div v-else class="w-12 h-12 bg-gray-100 dark:bg-gray-800 rounded shrink-0 flex items-center justify-center">
            <UIcon name="i-lucide-image" mode="svg" class="w-4 h-4 text-gray-400" />
          </div>
          <div class="flex-1 min-w-0 space-y-1">
            <input
              :value="element.img.alt"
              :aria-label="`Alt text for image ${index + 1}`"
              placeholder="Alt text (describes the photo)…"
              :class="inputClass"
              @input="updateField(index, 'alt', ($event.target as HTMLInputElement).value)"
            >
            <input
              :value="element.img.caption ?? ''"
              :aria-label="`Caption for image ${index + 1}`"
              placeholder="Caption (optional, shown to visitors)…"
              :class="inputClass"
              @input="updateField(index, 'caption', ($event.target as HTMLInputElement).value)"
            >
          </div>
          <div class="flex flex-col items-center shrink-0">
            <button
              type="button"
              :class="iconBtnClass"
              :disabled="index === 0"
              :aria-label="`Move image ${index + 1} up`"
              title="Move up"
              @click="move(index, index - 1)"
            >
              <UIcon name="i-lucide-chevron-up" mode="svg" class="w-3.5 h-3.5 block" />
            </button>
            <button
              type="button"
              :class="iconBtnClass"
              :disabled="index === parsedImages.length - 1"
              :aria-label="`Move image ${index + 1} down`"
              title="Move down"
              @click="move(index, index + 1)"
            >
              <UIcon name="i-lucide-chevron-down" mode="svg" class="w-3.5 h-3.5 block" />
            </button>
            <button
              type="button"
              class="shrink-0 p-0.5 text-gray-400 hover:text-red-500 transition-colors rounded"
              :aria-label="`Remove image ${index + 1}`"
              title="Remove image"
              @click="removeImage(index)"
            >
              <UIcon name="i-lucide-trash-2" mode="svg" class="w-3.5 h-3.5 block" />
            </button>
          </div>
        </div>
      </template>
    </draggable>
    <MediaLibraryPickerButton multiple label="Add from library" @select-many="addFromLibrary" />
    <div class="flex gap-2">
      <input
        v-model="newImageUrl"
        placeholder="…or paste an image URL"
        class="flex-1 px-3 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
        @keyup.enter="addImage"
      >
      <button
        type="button"
        :disabled="!newImageUrl.trim()"
        class="px-3 py-1.5 text-xs font-medium rounded-md bg-primary-500 hover:bg-primary-600 disabled:opacity-40 text-white transition-colors"
        @click="addImage"
      >
        Add
      </button>
    </div>
    <p v-if="!parsedImages.length" class="text-xs text-gray-400">
      Choose from the media library to add many photos at once (or a whole folder) — the
      library also carries real image dimensions, which the uncropped layouts use and
      paste-by-URL can't provide.
    </p>
  </div>
</template>

<style scoped>
/* Mirrors FieldRenderer.vue's own input-styling override — Vue's scoped CSS doesn't
   reach into a child component's template, so this has to be repeated here rather
   than relying on the parent's style block now that this markup lives in its own file. */
input:not([type="color"]):not([type="checkbox"]):not([type="radio"]),
textarea,
select {
  color: #111827 !important;
  background-color: #ffffff !important;
  border-color: #e5e7eb !important;
}

:global(.dark) input:not([type="color"]):not([type="checkbox"]):not([type="radio"]),
:global(.dark) textarea,
:global(.dark) select {
  color: #f3f4f6 !important;
  background-color: #111827 !important;
  border-color: #374151 !important;
}
</style>
