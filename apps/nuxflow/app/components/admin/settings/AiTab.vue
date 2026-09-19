<script setup lang="ts">
import type { AiState } from '~/types/admin-settings'

const ai = defineModel<AiState>('ai', { required: true })
defineProps<{
  saving: boolean
  onSave: () => Promise<void>
}>()

const aiProviderOptions = [
  { label: 'OpenAI', value: 'openai' },
  { label: 'Anthropic', value: 'anthropic' },
  { label: 'Google Gemini', value: 'gemini' },
  { label: 'DeepSeek', value: 'deepseek' },
  { label: 'Local (Ollama)', value: 'ollama' },
]
</script>

<template>
  <UCard>
    <template #header><p class="text-sm font-semibold text-gray-900 dark:text-white">AI Configuration</p></template>
    <div class="space-y-4">
      <UFormField label="Provider">
        <USelect v-model="ai.provider" :items="aiProviderOptions" class="w-full" />
      </UFormField>

      <template v-if="ai.provider === 'openai'">
        <UFormField label="OpenAI API Key">
          <UInput v-model="ai.openaiApiKey" type="password" placeholder="sk-..." />
        </UFormField>
      </template>

      <template v-if="ai.provider === 'anthropic'">
        <UFormField label="Anthropic API Key">
          <UInput v-model="ai.anthropicApiKey" type="password" placeholder="sk-ant-..." />
        </UFormField>
      </template>

      <template v-if="ai.provider === 'gemini'">
        <UFormField label="Google Gemini API Key">
          <UInput v-model="ai.geminiApiKey" type="password" placeholder="AIza..." />
        </UFormField>
      </template>

      <template v-if="ai.provider === 'deepseek'">
        <UFormField label="DeepSeek API Key">
          <UInput v-model="ai.deepseekApiKey" type="password" placeholder="sk-..." />
        </UFormField>
      </template>

      <template v-if="ai.provider === 'ollama'">
        <UFormField label="Ollama Base URL" hint="Default: http://localhost:11434">
          <UInput v-model="ai.ollamaBaseUrl" placeholder="http://localhost:11434" />
        </UFormField>
        <UFormField label="Ollama Model" hint="Default: llama3">
          <UInput v-model="ai.ollamaModel" placeholder="llama3" />
        </UFormField>
      </template>
    </div>
    <template #footer>
      <div class="flex justify-end">
        <UButton :loading="saving" @click="onSave">Save changes</UButton>
      </div>
    </template>
  </UCard>
</template>
