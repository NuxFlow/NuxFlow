<script setup lang="ts">
// Extracted from FieldRenderer.vue's 'images' branch — the multi-image list backing a
// CanvasBlockDefinition field of type 'images' (Gallery/Carousel blocks). Owns the
// add/remove/alt-edit logic and stores its value as the same JSON-string-of-{url,alt}
// convention every other 'images'-typed prop uses.
import { computed, ref } from 'vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import { parseImageList, type ImageListItem } from '../utils/json'

const props = defineProps<{
  modelValue?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const parsedImages = computed<ImageListItem[]>(() => parseImageList(props.modelValue))

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

function removeImage(i: number) {
  update(parsedImages.value.filter((_, idx) => idx !== i))
}

function updateImageAlt(i: number, alt: string) {
  update(parsedImages.value.map((img, idx) => idx === i ? { ...img, alt } : img))
}
</script>

<template>
  <div class="space-y-3">
    <div v-if="parsedImages.length" class="space-y-1.5">
      <div
        v-for="(img, i) in parsedImages"
        :key="i"
        class="flex items-center gap-2 p-2 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
      >
        <img
          v-if="img.url"
          :src="img.url"
          alt=""
          class="w-10 h-10 object-cover rounded shrink-0"
        >
        <div v-else class="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded shrink-0 flex items-center justify-center">
          <UIcon name="i-lucide-image" mode="svg" class="w-4 h-4 text-gray-400" />
        </div>
        <input
          :value="img.alt"
          :aria-label="`Alt text for image ${i + 1}`"
          placeholder="Alt text…"
          class="flex-1 min-w-0 px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-primary-500"
          @input="updateImageAlt(i, ($event.target as HTMLInputElement).value)"
        >
        <button
          type="button"
          class="shrink-0 p-1 text-gray-400 hover:text-red-500 transition-colors rounded"
          aria-label="Remove image"
          title="Remove image"
          @click="removeImage(i)"
        >
          <UIcon name="i-lucide-trash-2" mode="svg" class="w-3.5 h-3.5 block" />
        </button>
      </div>
    </div>
    <div class="flex gap-2">
      <input
        v-model="newImageUrl"
        placeholder="Paste image URL…"
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
      Paste an image URL above to add it to the gallery.
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
