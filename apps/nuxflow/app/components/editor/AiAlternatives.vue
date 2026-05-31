<script setup lang="ts">
defineProps<{
  alternatives: string[]
  loading?: boolean
}>()
const emit = defineEmits<{
  select: [text: string]
  close: []
}>()
</script>

<template>
  <UCard class="w-96 shadow-xl">
    <template #header>
      <div class="flex items-center justify-between">
        <p class="text-sm font-semibold flex items-center gap-2">
          <UIcon name="i-lucide-sparkles" class="text-primary-500" />
          AI Alternatives
        </p>
        <UButton icon="i-lucide-x" variant="ghost" size="xs" @click="emit('close')" />
      </div>
    </template>

    <div v-if="loading" class="flex items-center justify-center py-6">
      <UIcon name="i-lucide-loader-2" class="w-5 h-5 animate-spin text-gray-400" />
      <span class="ml-2 text-sm text-gray-500">Generating alternatives…</span>
    </div>

    <div v-else class="space-y-2">
      <button
        v-for="(alt, i) in alternatives"
        :key="i"
        class="w-full text-left p-3 rounded-lg text-sm border border-gray-200 dark:border-gray-700 hover:border-primary-400 hover:bg-primary-50 dark:hover:bg-primary-950 transition-colors"
        @click="emit('select', alt)"
      >
        {{ alt }}
      </button>

      <p v-if="!alternatives.length" class="text-center text-sm text-gray-400 py-4">
        No alternatives generated.
      </p>
    </div>
  </UCard>
</template>
