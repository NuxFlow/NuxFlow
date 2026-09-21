<script setup lang="ts">
// Shared "pick one of these AI-generated alternatives" list + dismiss button, used by
// FieldRenderer.vue's text and textarea branches — previously near-verbatim duplicated
// in both (the only real difference being the textarea variant's alternative buttons
// not line-clamping to 2 lines the way the single-line text variant's do).
defineProps<{
  alternatives: string[]
  error?: string | null
  /** Clamp each alternative button to 2 lines — used by the single-line text field
   * variant; the textarea variant leaves alternatives unclamped. */
  lineClamp?: boolean
}>()

const emit = defineEmits<{ select: [value: string]; dismiss: [] }>()
</script>

<template>
  <div v-if="alternatives.length" class="space-y-1">
    <p class="text-xs text-gray-400">Pick an alternative:</p>
    <button
      v-for="(alt, i) in alternatives"
      :key="i"
      type="button"
      class="w-full text-left text-xs px-2.5 py-1.5 rounded border border-gray-200 dark:border-gray-700 hover:border-primary-400 hover:bg-primary-50 dark:hover:bg-primary-950 transition-colors"
      :class="{ 'line-clamp-2': lineClamp }"
      @click="emit('select', alt)"
    >
      {{ alt }}
    </button>
    <button type="button" class="text-xs text-gray-400 hover:text-gray-600" @click="emit('dismiss')">
      Dismiss
    </button>
  </div>
  <p v-else-if="error" class="text-xs text-red-500 flex items-center gap-1">
    {{ error }}
    <button type="button" class="underline hover:no-underline" @click="emit('dismiss')">Dismiss</button>
  </p>
</template>
