<script setup lang="ts">
import { computed, ref } from 'vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import type { FieldSchema, SpacingValue } from '../types'
import RichTextInput from './RichTextInput.vue'
import { useAiImprove, AI_IMPROVE_ACTIONS, type AiInstruction } from './useAiImprove'

const props = defineProps<{
  field: FieldSchema
  modelValue: unknown
}>()

const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>()

function update(val: unknown) {
  emit('update:modelValue', val)
}

// ── Multi-image list (type === 'images') ──────────────────────────────────────

interface GalleryImage { url: string; alt: string }

const parsedImages = computed<GalleryImage[]>(() => {
  if (props.field.type !== 'images') return []
  try {
    const arr = JSON.parse((props.modelValue as string) || '[]')
    return Array.isArray(arr) ? arr : []
  }
  catch {
    return []
  }
})

const newImageUrl = ref('')

function addImage() {
  const url = newImageUrl.value.trim()
  if (!url) return
  update(JSON.stringify([...parsedImages.value, { url, alt: '' }]))
  newImageUrl.value = ''
}

function removeImage(i: number) {
  update(JSON.stringify(parsedImages.value.filter((_, idx) => idx !== i)))
}

function updateImageAlt(i: number, alt: string) {
  update(JSON.stringify(parsedImages.value.map((img, idx) => idx === i ? { ...img, alt } : img)))
}

const spacing = computed(() => {
  const v = props.modelValue as SpacingValue | undefined
  return v ?? { top: 0, right: 0, bottom: 0, left: 0, unit: 'px' }
})

function updateSpacing(key: keyof SpacingValue, raw: unknown) {
  const val = key === 'unit' ? raw : Number(raw)
  update({ ...spacing.value, [key]: val })
}

// ── AI text improvement ───────────────────────────────────────────────────────

const { aiLoading, aiAlternatives, showAiMenu, triggerAi: runAiImprove, dismissAlternatives } = useAiImprove()
const aiActions = AI_IMPROVE_ACTIONS

function triggerAi(instruction: AiInstruction) {
  runAiImprove(instruction, String(props.modelValue ?? ''))
}

function applyAlternative(alt: string) {
  update(alt)
  dismissAlternatives()
}
</script>

<template>
  <!-- Text / URL -->
  <div v-if="field.type === 'text' || field.type === 'url'" class="space-y-1.5">
    <div class="flex gap-1">
      <input
        :value="(modelValue as string) ?? ''"
        :placeholder="field.placeholder"
        class="flex-1 px-3 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
        @input="update(($event.target as HTMLInputElement).value)"
      />
      <!-- AI button (only for text-like fields with content) -->
      <div v-if="field.type === 'text'" class="relative">
        <button
          type="button"
          title="Improve with AI"
          :disabled="aiLoading || !String(modelValue ?? '').trim()"
          class="h-full px-2 rounded-md border border-gray-200 dark:border-gray-700 text-gray-400 hover:text-primary-500 hover:border-primary-400 disabled:opacity-30 transition-colors"
          @click.stop="showAiMenu = !showAiMenu"
        >
          <UIcon v-if="aiLoading" name="i-lucide-loader-2" mode="svg" class="w-3.5 h-3.5 animate-spin block" />
          <UIcon v-else name="i-lucide-sparkles" mode="svg" class="w-3.5 h-3.5 block" />
        </button>
        <div
          v-if="showAiMenu"
          class="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden"
          style="min-width: 130px;"
        >
          <button
            v-for="action in aiActions"
            :key="action.value"
            type="button"
            class="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            @click="triggerAi(action.value)"
          >
            <span>{{ action.icon }}</span>{{ action.label }}
          </button>
        </div>
      </div>
    </div>

    <!-- AI alternatives inline -->
    <div v-if="aiAlternatives.length" class="space-y-1">
      <p class="text-xs text-gray-400">Pick an alternative:</p>
      <button
        v-for="(alt, i) in aiAlternatives"
        :key="i"
        type="button"
        class="w-full text-left text-xs px-2.5 py-1.5 rounded border border-gray-200 dark:border-gray-700 hover:border-primary-400 hover:bg-primary-50 dark:hover:bg-primary-950 transition-colors line-clamp-2"
        @click="applyAlternative(alt)"
      >
        {{ alt }}
      </button>
      <button type="button" class="text-xs text-gray-400 hover:text-gray-600" @click="dismissAlternatives()">
        Dismiss
      </button>
    </div>
  </div>

  <!-- Textarea -->
  <div v-else-if="field.type === 'textarea'" class="space-y-1.5">
    <textarea
      :value="(modelValue as string) ?? ''"
      :placeholder="field.placeholder"
      :rows="field.rows ?? 3"
      class="w-full px-3 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-y"
      @input="update(($event.target as HTMLTextAreaElement).value)"
    />
    <!-- AI row below textarea -->
    <div v-if="String(modelValue ?? '').trim()" class="flex flex-wrap gap-1">
      <button
        v-for="action in aiActions"
        :key="action.value"
        type="button"
        :disabled="aiLoading"
        class="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-primary-400 hover:text-primary-600 disabled:opacity-40 transition-colors"
        @click="triggerAi(action.value)"
      >
        <UIcon v-if="aiLoading" name="i-lucide-loader-2" mode="svg" class="w-2.5 h-2.5 animate-spin" />
        {{ action.icon }} {{ action.label }}
      </button>
    </div>

    <!-- AI alternatives inline -->
    <div v-if="aiAlternatives.length" class="space-y-1 mt-1">
      <p class="text-xs text-gray-400">Pick an alternative:</p>
      <button
        v-for="(alt, i) in aiAlternatives"
        :key="i"
        type="button"
        class="w-full text-left text-xs px-2.5 py-1.5 rounded border border-gray-200 dark:border-gray-700 hover:border-primary-400 hover:bg-primary-50 dark:hover:bg-primary-950 transition-colors"
        @click="applyAlternative(alt)"
      >
        {{ alt }}
      </button>
      <button type="button" class="text-xs text-gray-400 hover:text-gray-600" @click="dismissAlternatives()">
        Dismiss
      </button>
    </div>
  </div>

  <!-- Rich text — contenteditable WYSIWYG -->
  <div v-else-if="field.type === 'richtext'">
    <RichTextInput
      :model-value="(modelValue as string) ?? ''"
      @update:model-value="update($event)"
    />
  </div>

  <!-- Number -->
  <div v-else-if="field.type === 'number'">
    <input
      type="number"
      :value="(modelValue as number) ?? field.default ?? 0"
      :min="field.min"
      :max="field.max"
      :step="field.step ?? 1"
      class="w-full px-3 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
      @input="update(Number(($event.target as HTMLInputElement).value))"
    />
  </div>

  <!-- Color -->
  <div v-else-if="field.type === 'color'" class="flex items-center gap-2">
    <input
      type="color"
      :value="(modelValue as string) ?? '#ffffff'"
      class="h-8 w-10 cursor-pointer rounded border border-gray-200 dark:border-gray-700 p-0.5 bg-white"
      @input="update(($event.target as HTMLInputElement).value)"
    />
    <input
      type="text"
      :value="(modelValue as string) ?? '#ffffff'"
      maxlength="7"
      class="flex-1 px-3 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono"
      @change="update(($event.target as HTMLInputElement).value)"
    />
  </div>

  <!-- Select -->
  <div v-else-if="field.type === 'select'">
    <select
      :value="(modelValue as string) ?? ''"
      class="w-full px-3 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
      @change="update(($event.target as HTMLSelectElement).value)"
    >
      <option
        v-for="opt in field.options"
        :key="opt.value"
        :value="opt.value"
      >
        {{ opt.label }}
      </option>
    </select>
  </div>

  <!-- Toggle -->
  <div v-else-if="field.type === 'toggle'">
    <button
      type="button"
      role="switch"
      :aria-checked="Boolean(modelValue)"
      class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1"
      :class="modelValue ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'"
      @click="update(!modelValue)"
    >
      <span
        class="inline-block h-3.5 w-3.5 translate-x-0.5 rounded-full bg-white shadow transition-transform duration-150"
        :class="modelValue ? 'translate-x-[18px]' : ''"
      />
    </button>
  </div>

  <!-- Image URL -->
  <div v-else-if="field.type === 'image'" class="space-y-2">
    <input
      :value="(modelValue as string) ?? ''"
      placeholder="https://example.com/image.jpg"
      class="w-full px-3 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
      @input="update(($event.target as HTMLInputElement).value)"
    />
    <img
      v-if="modelValue"
      :src="(modelValue as string)"
      class="h-20 w-full object-cover rounded-md border border-gray-200 dark:border-gray-700"
    />
  </div>

  <!-- Multi-image list (gallery) -->
  <div v-else-if="field.type === 'images'" class="space-y-3">
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
        />
        <div v-else class="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded shrink-0 flex items-center justify-center">
          <UIcon name="i-lucide-image" mode="svg" class="w-4 h-4 text-gray-400" />
        </div>
        <input
          :value="img.alt"
          placeholder="Alt text…"
          class="flex-1 min-w-0 px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-primary-500"
          @input="updateImageAlt(i, ($event.target as HTMLInputElement).value)"
        />
        <button
          type="button"
          class="shrink-0 p-1 text-gray-400 hover:text-red-500 transition-colors rounded"
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
      />
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

  <!-- Spacing -->
  <div v-else-if="field.type === 'spacing'" class="space-y-2">
    <div class="grid grid-cols-4 gap-1.5 text-center">
      <div v-for="side in (['top', 'right', 'bottom', 'left'] as const)" :key="side">
        <label class="block text-xs text-gray-400 mb-0.5 capitalize">{{ side }}</label>
        <input
          type="number"
          :value="spacing[side]"
          min="0"
          class="w-full px-1.5 py-1 text-sm text-center rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-primary-500"
          @input="updateSpacing(side, ($event.target as HTMLInputElement).value)"
        />
      </div>
    </div>
    <select
      :value="spacing.unit"
      class="w-full px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none"
      @change="updateSpacing('unit', ($event.target as HTMLSelectElement).value)"
    >
      <option value="px">px</option>
      <option value="rem">rem</option>
      <option value="%">%</option>
    </select>
  </div>
</template>

<style scoped>
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
