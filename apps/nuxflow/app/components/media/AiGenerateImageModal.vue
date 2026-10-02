<script setup lang="ts">
const emit = defineEmits<{
  generated: [url: string, mediaId?: string]
  close: []
}>()

const prompt = ref('')
const shape = ref<'square' | 'landscape' | 'portrait'>('square')
const quality = ref<'standard' | 'hd'>('standard')
const loading = ref(false)
const error = ref('')
const previewUrl = ref('')
const resultMediaId = ref<string | undefined>()

// Shapes rather than pixel sizes — each provider supports different exact dimensions, and
// the server picks the closest one it offers.
const shapeOptions = [
  { label: 'Square', value: 'square' },
  { label: 'Landscape', value: 'landscape' },
  { label: 'Portrait', value: 'portrait' },
]

const qualityOptions = [
  { label: 'Standard', value: 'standard' },
  { label: 'HD', value: 'hd' },
]

async function generate() {
  if (prompt.value.trim().length < 5) return
  loading.value = true
  error.value = ''
  previewUrl.value = ''
  resultMediaId.value = undefined
  try {
    const res = await $fetch<{ url: string; mediaId?: string; saved: boolean; error?: string }>('/api/v1/ai/generate-image', {
      method: 'POST',
      body: { prompt: prompt.value.trim(), shape: shape.value, quality: quality.value },
    })
    previewUrl.value = res.url
    resultMediaId.value = res.mediaId
    if (res.error) {
      error.value = `Generated but not saved: ${res.error}`
    }
  } catch (e: unknown) {
    error.value = getErrorMessage(e, 'Generation failed. Check the AI provider settings.')
  } finally {
    loading.value = false
  }
}

function useImage() {
  if (!previewUrl.value) return
  emit('generated', previewUrl.value, resultMediaId.value)
}
</script>

<template>
  <div class="space-y-4">
    <UFormField label="Describe the image you want">
      <UTextarea
        v-model="prompt"
        class="w-full"
        :rows="3"
        placeholder="e.g. A professional team collaborating around a laptop in a bright modern office, photorealistic, warm lighting"
      />
    </UFormField>

    <div class="grid grid-cols-2 gap-3">
      <UFormField label="Shape">
        <USelect v-model="shape" :items="shapeOptions" />
      </UFormField>
      <UFormField label="Quality">
        <USelect v-model="quality" :items="qualityOptions" />
      </UFormField>
    </div>

    <!-- Preview -->
    <div v-if="previewUrl" class="space-y-2">
      <p class="text-xs font-medium text-gray-500">Generated image</p>
      <div class="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
        <img :src="previewUrl" alt="AI generated image" class="w-full max-h-64 object-contain bg-gray-50 dark:bg-gray-800">
      </div>
    </div>

    <p v-if="error" class="text-sm text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
      <UIcon name="i-lucide-alert-triangle" class="w-4 h-4 mt-0.5 shrink-0" />
      {{ error }}
    </p>

    <UAlert
      v-if="!previewUrl"
      icon="i-lucide-info"
      color="info"
      variant="soft"
      size="sm"
      description="Uses OpenAI or Google Gemini when a key is set in Settings → AI, otherwise Workers AI. Images are saved to your media library."
    />

    <div class="flex justify-end gap-2 pt-1">
      <UButton variant="ghost" @click="emit('close')">Cancel</UButton>
      <UButton
        v-if="previewUrl"
        icon="i-lucide-check"
        variant="outline"
        @click="useImage"
      >
        Use this image
      </UButton>
      <UButton
        icon="i-lucide-image-plus"
        :loading="loading"
        :disabled="prompt.trim().length < 5"
        @click="generate"
      >
        {{ previewUrl ? 'Regenerate' : 'Generate' }}
      </UButton>
    </div>
  </div>
</template>
