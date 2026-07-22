<script setup lang="ts">
const emit = defineEmits<{
  generated: [url: string, mediaId?: string]
  close: []
}>()

const prompt = ref('')
const size = ref<'1024x1024' | '1792x1024' | '1024x1792'>('1024x1024')
const quality = ref<'standard' | 'hd'>('standard')
const loading = ref(false)
const error = ref('')
const previewUrl = ref('')
const resultMediaId = ref<string | undefined>()

const sizeOptions = [
  { label: 'Square (1024×1024)', value: '1024x1024' },
  { label: 'Landscape (1792×1024)', value: '1792x1024' },
  { label: 'Portrait (1024×1792)', value: '1024x1792' },
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
      body: { prompt: prompt.value.trim(), size: size.value, quality: quality.value },
    })
    previewUrl.value = res.url
    resultMediaId.value = res.mediaId
    if (res.error) {
      error.value = `Generated but not saved: ${res.error}`
    }
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    error.value = msg || 'Generation failed. Ensure an OpenAI or Google API key is configured.'
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
        :rows="3"
        placeholder="e.g. A professional team collaborating around a laptop in a bright modern office, photorealistic, warm lighting"
      />
    </UFormField>

    <div class="grid grid-cols-2 gap-3">
      <UFormField label="Size">
        <USelect v-model="size" :items="sizeOptions" />
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
      description="Requires an OpenAI (DALL-E 3) or Google Gemini (Imagen 3) API key. Images are saved to your media library."
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
