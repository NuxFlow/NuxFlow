<script setup lang="ts">
// Video edit/delete modal, extracted from media/videos.vue. Presentational, following
// the same split as MediaDetailPanel.vue: the parent owns the save/delete API calls
// and emits 'save'/'delete'; this only edits the local title field and copies the
// stream URL (a pure clipboard action with no server round trip).
interface VideoAsset {
  id: string
  title: string
  cloudflareStreamId: string
  duration: number | null
  thumbnailUrl: string | null
  status: 'uploading' | 'processing' | 'ready' | 'failed'
  size: number | null
  createdAt: string
}

const open = defineModel<boolean>('open', { required: true })
const editTitle = defineModel<string>('editTitle', { required: true })

defineProps<{
  video: VideoAsset | null
  saving: boolean
  deleting: boolean
}>()

const emit = defineEmits<{
  save: []
  delete: []
}>()

const toast = useToast()

async function copyStreamUrl(streamId: string) {
  const url = `https://iframe.videodelivery.net/${streamId}`
  await navigator.clipboard.writeText(url)
  toast.add({ title: 'URL copied!', description: 'Paste it into a Canvas Video block.', color: 'success' })
}
</script>

<template>
  <UModal v-model:open="open" title="Edit Video Details">
    <template #body>
      <div v-if="video" class="space-y-4">
        <div class="flex gap-4 items-start pb-4 border-b border-gray-100 dark:border-gray-800">
          <div class="w-24 aspect-video rounded-lg overflow-hidden bg-black shrink-0 flex items-center justify-center">
            <img
              v-if="video.thumbnailUrl"
              :src="video.thumbnailUrl"
              class="w-full h-full object-cover"
            >
            <UIcon v-else name="i-lucide-video" class="w-8 h-8 text-gray-600" />
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400 space-y-1">
            <p class="flex items-center gap-1.5">
              <span class="font-medium shrink-0">Stream URL:</span>
              <code class="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded truncate max-w-[140px]" :title="`https://iframe.videodelivery.net/${video.cloudflareStreamId}`">
                {{ video.cloudflareStreamId }}
              </code>
              <UButton
                icon="i-lucide-copy"
                size="xs"
                variant="ghost"
                color="neutral"
                title="Copy video URL for use in Canvas Video block"
                @click="copyStreamUrl(video.cloudflareStreamId)"
              />
            </p>
            <p><span class="font-medium">Duration:</span> {{ formatDuration(video.duration) }}</p>
            <p><span class="font-medium">Size:</span> {{ formatBytes(video.size) }}</p>
          </div>
        </div>

        <UFormField label="Video Title">
          <UInput v-model="editTitle" placeholder="Enter a descriptive title..." />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-between w-full">
        <UButton
          color="error"
          variant="ghost"
          icon="i-lucide-trash-2"
          :loading="deleting"
          @click="emit('delete')"
        >
          Delete Permanently
        </UButton>
        <div class="flex gap-2">
          <UButton variant="ghost" @click="open = false">Cancel</UButton>
          <UButton :loading="saving" color="primary" @click="emit('save')">Save changes</UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
