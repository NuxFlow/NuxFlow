<script setup lang="ts">
import { useAiImprove, AI_IMPROVE_ACTIONS, type AiInstruction } from '@nuxflow/canvas'

const emit = defineEmits<{ replace: [text: string] }>()
const props = defineProps<{ selectedText: string }>()

const { aiLoading, aiAlternatives, triggerAi } = useAiImprove()
const instruction = ref<AiInstruction>('improve')

// Labels/values come from the shared canvas package so this list can't drift from
// FieldRenderer.vue/RichTextInput.vue's — only the icon representation differs here
// (Lucide icon classes for UButton, vs. the emoji text those two render inline).
const ICONS: Record<AiInstruction, string> = {
  improve: 'i-lucide-sparkles',
  shorten: 'i-lucide-scissors',
  expand: 'i-lucide-expand',
  simplify: 'i-lucide-zap',
}
const actions = AI_IMPROVE_ACTIONS.map(a => ({ ...a, icon: ICONS[a.value] }))

async function generate(inst: AiInstruction) {
  instruction.value = inst
  await triggerAi(inst, props.selectedText)
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
        :loading="aiLoading && instruction === action.value"
        @click="generate(action.value)"
      >
        {{ action.label }}
      </UButton>
    </div>

    <div v-if="aiAlternatives.length" class="space-y-2">
      <p class="text-xs font-medium text-gray-500">Pick an alternative:</p>
      <button
        v-for="(alt, i) in aiAlternatives"
        :key="i"
        class="w-full text-left p-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 hover:border-primary-400 hover:bg-primary-50 dark:hover:bg-primary-950 transition-colors"
        @click="emit('replace', alt)"
      >
        {{ alt }}
      </button>
    </div>
  </div>
</template>
