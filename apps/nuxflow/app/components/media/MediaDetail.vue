<script setup lang="ts">
const props = defineProps<{
  file: {
    id: string
    url: string
    originalName: string
    mimeType: string
    size: number
    altText?: string
    caption?: string
    width?: number
    height?: number
  }
}>()

const emit = defineEmits<{ close: []; updated: [] }>()

const form = reactive({ altText: props.file.altText ?? '', caption: props.file.caption ?? '' })
const saving = ref(false)
const aiLoading = ref(false)

async function save() {
  saving.value = true
  try {
    await $fetch(`/api/v1/media/${props.file.id}`, { method: 'PATCH', body: form })
    emit('updated')
  } finally {
    saving.value = false
  }
}

async function generateAltText() {
  aiLoading.value = true
  try {
    const res = await $fetch<{ altText: string }>('/api/v1/ai/alt-text', {
      method: 'POST',
      body: { mediaId: props.file.id },
    })
    form.altText = res.altText
  } catch {
    // AI not configured — fail silently
  } finally {
    aiLoading.value = false
  }
}

function copyFileUrl() { window.navigator.clipboard.writeText(props.file.url) }

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <div class="space-y-4">
    <!-- Preview -->
    <div class="aspect-video bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden flex items-center justify-center">
      <img v-if="file.mimeType.startsWith('image/')" :src="file.url" :alt="form.altText" class="max-h-full max-w-full object-contain" >
      <UIcon v-else name="i-lucide-file" class="w-10 h-10 text-gray-300" />
    </div>

    <!-- File info -->
    <div class="text-xs text-gray-400 space-y-0.5">
      <p>{{ file.originalName }}</p>
      <p>{{ file.mimeType }} · {{ formatSize(file.size) }}
        <template v-if="file.width && file.height"> · {{ file.width }}×{{ file.height }}</template>
      </p>
    </div>

    <!-- Copy URL -->
    <UButton size="xs" variant="outline" icon="i-lucide-copy" block @click="copyFileUrl">
      Copy URL
    </UButton>

    <!-- Fields -->
    <UFormField label="Alt text">
      <div class="flex gap-2">
        <UInput v-model="form.altText" class="flex-1" placeholder="Describe this image…" />
        <UButton
          size="sm"
          variant="ghost"
          icon="i-lucide-sparkles"
          :loading="aiLoading"
          title="Generate with AI"
          @click="generateAltText"
        />
      </div>
    </UFormField>

    <UFormField label="Caption">
      <UTextarea v-model="form.caption" :rows="2" />
    </UFormField>

    <div class="flex justify-end gap-2 pt-2">
      <UButton variant="ghost" @click="emit('close')">Cancel</UButton>
      <UButton :loading="saving" @click="save">Save</UButton>
    </div>
  </div>
</template>
