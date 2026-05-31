<script setup lang="ts">
const emit = defineEmits<{ replace: [text: string] }>()
const props = defineProps<{ selectedText: string }>()

const loading = ref(false)
const alternatives = ref<string[]>([])
const instruction = ref<'improve' | 'shorten' | 'expand' | 'simplify'>('improve')

const actions = [
  { label: 'Improve', value: 'improve' as const, icon: 'i-lucide-sparkles' },
  { label: 'Shorten', value: 'shorten' as const, icon: 'i-lucide-scissors' },
  { label: 'Expand', value: 'expand' as const, icon: 'i-lucide-expand' },
  { label: 'Simplify', value: 'simplify' as const, icon: 'i-lucide-zap' },
]

async function generate(inst: typeof instruction.value) {
  instruction.value = inst
  loading.value = true
  alternatives.value = []
  try {
    const res = await $fetch<{ alternatives: string[] }>('/api/v1/ai/improve', {
      method: 'POST',
      body: { text: props.selectedText, instruction: inst },
    })
    alternatives.value = res.alternatives
  } finally {
    loading.value = false
  }
}

</script>

<template>
  <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-lg p-3 space-y-3 w-72">
    <div class="flex items-center gap-1">
      <UIcon name="i-lucide-sparkles" class="w-4 h-4 text-primary-500" />
      <span class="text-xs font-semibold text-gray-700 dark:text-gray-300">AI Assistant</span>
    </div>

    <div class="flex flex-wrap gap-1">
      <UButton
        v-for="action in actions"
        :key="action.value"
        size="xs"
        :variant="instruction === action.value ? 'solid' : 'outline'"
        :icon="action.icon"
        :loading="loading && instruction === action.value"
        @click="generate(action.value)"
      >
        {{ action.label }}
      </UButton>
    </div>

    <div v-if="alternatives.length" class="space-y-2">
      <p class="text-xs font-medium text-gray-500">Pick an alternative:</p>
      <button
        v-for="(alt, i) in alternatives"
        :key="i"
        class="w-full text-left p-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 hover:border-primary-400 hover:bg-primary-50 dark:hover:bg-primary-950 transition-colors"
        @click="emit('replace', alt)"
      >
        {{ alt }}
      </button>
    </div>
  </div>
</template>
