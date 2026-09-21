<script setup lang="ts">
// Extracted from FieldRenderer.vue's 'list' branch — backs both "array of structured
// objects" (field.fields set — e.g. footer links, FAQ items) and "array of plain
// strings" (field.fields omitted — e.g. pricing feature bullets). Owns add/remove/
// move/parse logic; stores its value as a JSON string, matching the 'images' field's
// convention so it round-trips through the same prop-serialization path every other
// field type already uses.
import { computed, ref, watch } from 'vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import type { FieldSchema } from '../types'
import { safeJsonParse } from '../utils/json'
import FieldRenderer from './FieldRenderer.vue'

const props = defineProps<{
  field: FieldSchema
  modelValue?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

type ListItem = string | Record<string, unknown>

const parsedList = computed<ListItem[]>(() => {
  const arr = safeJsonParse<unknown>(props.modelValue, [])
  return Array.isArray(arr) ? arr as ListItem[] : []
})

// List items carry no stable id of their own in the stored JSON, but rows must still be
// keyed by identity rather than array index — an index key makes Vue patch the existing
// row component in place after a move/remove instead of remounting it, which leaves that
// row's own local state (e.g. the AI-improve panel's aiAlternatives inside the nested
// FieldRenderer) bound to whatever item now occupies that position instead of the item
// it was actually opened for. `itemKeys` mirrors parsedList 1:1 and is updated by the
// same operations that mutate the list, so key identity always follows the item.
let keySeq = 0
const itemKeys = ref<string[]>([])
watch(parsedList, (list) => {
  // A length mismatch means the list changed from outside this component's own
  // add/remove/move calls (e.g. switching to a different block instance) — our own
  // mutations below always keep itemKeys in sync already, so this only fires then.
  if (itemKeys.value.length !== list.length) {
    itemKeys.value = list.map(() => `k${keySeq++}`)
  }
}, { immediate: true })

function emptyListItem(): ListItem {
  const subFields = props.field.fields
  if (!subFields) return ''
  const item: Record<string, unknown> = {}
  for (const f of subFields) item[f.key] = f.default ?? ''
  return item
}

function updateList(items: ListItem[]) {
  emit('update:modelValue', JSON.stringify(items))
}

function addListItem() {
  updateList([...parsedList.value, emptyListItem()])
  itemKeys.value = [...itemKeys.value, `k${keySeq++}`]
}

function removeListItem(i: number) {
  updateList(parsedList.value.filter((_, idx) => idx !== i))
  itemKeys.value = itemKeys.value.filter((_, idx) => idx !== i)
}

function moveListItem(i: number, dir: -1 | 1) {
  const items = [...parsedList.value]
  const j = i + dir
  if (j < 0 || j >= items.length) return
  ;[items[i], items[j]] = [items[j] as ListItem, items[i] as ListItem]
  updateList(items)

  const keys = [...itemKeys.value]
  ;[keys[i], keys[j]] = [keys[j] as string, keys[i] as string]
  itemKeys.value = keys
}

function updateListItemString(i: number, value: string) {
  updateList(parsedList.value.map((item, idx) => idx === i ? value : item))
}

function updateListItemField(i: number, key: string, value: unknown) {
  updateList(parsedList.value.map((item, idx) =>
    idx === i ? { ...(item as Record<string, unknown>), [key]: value } : item,
  ))
}
</script>

<template>
  <div class="space-y-2">
    <div v-if="parsedList.length" class="space-y-2">
      <div
        v-for="(item, i) in parsedList"
        :key="itemKeys[i]"
        class="p-2 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 space-y-1.5"
      >
        <div class="flex items-start gap-2">
          <!-- Structured item — one recursive FieldRenderer per sub-field -->
          <div v-if="field.fields" class="flex-1 min-w-0 space-y-2">
            <div v-for="subField in field.fields" :key="subField.key">
              <label class="block text-xs text-gray-400 mb-0.5">{{ subField.label }}</label>
              <FieldRenderer
                :field="subField"
                :model-value="(item as Record<string, unknown>)[subField.key]"
                @update:model-value="(v) => updateListItemField(i, subField.key, v)"
              />
            </div>
          </div>
          <!-- Plain string item -->
          <input
            v-else
            :value="item as string"
            :aria-label="`${field.label} item ${i + 1}`"
            class="flex-1 min-w-0 px-3 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            @input="updateListItemString(i, ($event.target as HTMLInputElement).value)"
          >
          <div class="flex flex-col gap-0.5 shrink-0">
            <button
              type="button"
              :disabled="i === 0"
              class="p-0.5 text-gray-400 hover:text-primary-500 disabled:opacity-25 disabled:hover:text-gray-400 transition-colors rounded"
              :aria-label="`Move item ${i + 1} up`"
              @click="moveListItem(i, -1)"
            >
              <UIcon name="i-lucide-chevron-up" mode="svg" class="w-3.5 h-3.5 block" />
            </button>
            <button
              type="button"
              :disabled="i === parsedList.length - 1"
              class="p-0.5 text-gray-400 hover:text-primary-500 disabled:opacity-25 disabled:hover:text-gray-400 transition-colors rounded"
              :aria-label="`Move item ${i + 1} down`"
              @click="moveListItem(i, 1)"
            >
              <UIcon name="i-lucide-chevron-down" mode="svg" class="w-3.5 h-3.5 block" />
            </button>
            <button
              type="button"
              class="p-0.5 text-gray-400 hover:text-red-500 transition-colors rounded"
              :aria-label="`Remove item ${i + 1}`"
              @click="removeListItem(i)"
            >
              <UIcon name="i-lucide-trash-2" mode="svg" class="w-3.5 h-3.5 block" />
            </button>
          </div>
        </div>
      </div>
    </div>
    <p v-else class="text-xs text-gray-400">No items yet.</p>
    <button
      type="button"
      class="w-full px-3 py-1.5 text-xs font-medium rounded-md border border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-primary-400 hover:text-primary-500 transition-colors"
      @click="addListItem"
    >
      + Add item
    </button>
  </div>
</template>

<style scoped>
/* Mirrors FieldRenderer.vue's own input-styling override — Vue's scoped CSS doesn't
   reach into a child component's template, so this has to be repeated here rather
   than relying on the parent's style block now that this markup lives in its own file.
   Only reachable via the plain-string-item input (structured sub-fields render through
   a nested FieldRenderer, which carries its own copy of this same block already). */
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
