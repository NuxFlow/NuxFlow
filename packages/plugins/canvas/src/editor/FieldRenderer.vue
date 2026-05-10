<script setup lang="ts">
import { computed } from 'vue'
import type { FieldSchema, SpacingValue } from '../types'
import RichTextInput from './RichTextInput.vue'

const props = defineProps<{
  field: FieldSchema
  modelValue: unknown
}>()

const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>()

function update(val: unknown) {
  emit('update:modelValue', val)
}

const spacing = computed(() => {
  const v = props.modelValue as SpacingValue | undefined
  return v ?? { top: 0, right: 0, bottom: 0, left: 0, unit: 'px' }
})

function updateSpacing(key: keyof SpacingValue, raw: unknown) {
  const val = key === 'unit' ? raw : Number(raw)
  update({ ...spacing.value, [key]: val })
}
</script>

<template>
  <!-- Text / URL -->
  <div v-if="field.type === 'text' || field.type === 'url'">
    <input
      :value="(modelValue as string) ?? ''"
      :placeholder="field.placeholder"
      class="w-full px-3 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
      @input="update(($event.target as HTMLInputElement).value)"
    />
  </div>

  <!-- Textarea -->
  <div v-else-if="field.type === 'textarea'">
    <textarea
      :value="(modelValue as string) ?? ''"
      :placeholder="field.placeholder"
      rows="3"
      class="w-full px-3 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
      @input="update(($event.target as HTMLTextAreaElement).value)"
    />
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
