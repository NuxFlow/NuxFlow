<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3'

const props = defineProps<{ editor: Editor | undefined }>()
const emit = defineEmits<{
  'update:modelValue': [value: unknown]
  close: []
}>()

const generateDescription = ref('')
const generateTone = ref<'professional' | 'casual' | 'friendly' | 'technical'>('professional')
const generateFormat = ref<'prose' | 'listicle' | 'howto' | 'faq'>('prose')
const generating = ref(false)
const generateError = ref('')

const toneOptions = [
  { label: 'Professional', value: 'professional' },
  { label: 'Casual', value: 'casual' },
  { label: 'Friendly', value: 'friendly' },
  { label: 'Technical', value: 'technical' },
]

const formatOptions = [
  { label: 'Prose', value: 'prose' },
  { label: 'Listicle', value: 'listicle' },
  { label: 'How-to guide', value: 'howto' },
  { label: 'FAQ', value: 'faq' },
]

// Capped like typing is (the textarea's maxlength) — a long dictation used to push the
// description past the server's 500-character limit and fail with a validation error.
function appendDictation(text: string) {
  generateDescription.value = (generateDescription.value ? `${generateDescription.value.trimEnd()} ${text}` : text).slice(0, 500)
}

async function generateContent() {
  if (generateDescription.value.length < 5) return
  generating.value = true
  generateError.value = ''
  try {
    const { html } = await $fetch<{ html: string }>('/api/v1/ai/generate-content', {
      method: 'POST',
      body: { description: generateDescription.value, tone: generateTone.value, format: generateFormat.value },
    })
    // An empty post gets the draft as its body; one that already has writing gets it at the
    // cursor — setContent() here used to replace everything the author had written.
    if (!props.editor || props.editor.isEmpty) props.editor?.commands.setContent(html)
    else props.editor.commands.insertContent(html)
    emit('update:modelValue', props.editor?.getJSON())
    generateDescription.value = ''
    emit('close')
  } catch (e: unknown) {
    generateError.value = getErrorMessage(e, 'Generation failed. Check your AI provider settings.')
  } finally {
    generating.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <UFormField label="Describe what you want to write">
      <template #hint>
        <AiVoiceInput @transcribed="appendDictation" />
      </template>
      <UTextarea
        v-model="generateDescription"
        class="w-full"
        :rows="5"
        autoresize
        :maxrows="12"
        :maxlength="500"
        placeholder="e.g. An introduction to Cloudflare Workers explaining what they are and why developers should use them."
      />
    </UFormField>
    <div class="grid grid-cols-2 gap-3">
      <UFormField label="Tone">
        <USelect v-model="generateTone" :items="toneOptions" />
      </UFormField>
      <UFormField label="Format">
        <USelect v-model="generateFormat" :items="formatOptions" />
      </UFormField>
    </div>
    <p v-if="editor && !editor.isEmpty" class="text-xs text-gray-500">
      Your post already has content — the generated text is added where your cursor is.
    </p>
    <p v-if="generateError" class="text-sm text-red-500">{{ generateError }}</p>

    <div class="flex justify-end gap-2 pt-2">
      <UButton variant="ghost" @click="emit('close')">Cancel</UButton>
      <UButton
        icon="i-lucide-sparkles"
        :loading="generating"
        :disabled="generateDescription.length < 5"
        @click="generateContent"
      >
        Generate
      </UButton>
    </div>
  </div>
</template>
