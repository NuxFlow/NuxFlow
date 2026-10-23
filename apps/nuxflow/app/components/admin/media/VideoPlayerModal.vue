<script setup lang="ts">
// Video playback modal, extracted from media/videos.vue. Purely presentational — no
// state or API calls of its own, just an iframe embed of the Cloudflare Stream player.
// `playbackUrl` comes from the API, signed for a private video (utils/stream.ts).
interface VideoAsset {
  id: string
  title: string
  cloudflareStreamId: string
  duration: number | null
  thumbnailUrl: string | null
  status: 'uploading' | 'processing' | 'ready' | 'failed'
  size: number | null
  createdAt: string
  isPrivate: boolean
  playbackUrl: string
}

const open = defineModel<boolean>('open', { required: true })

defineProps<{
  video: VideoAsset | null
}>()
</script>

<template>
  <UModal v-model:open="open" :title="video?.title ?? 'Video Player'" size="xl">
    <template #body>
      <div v-if="video" class="aspect-video bg-black rounded-lg overflow-hidden shadow-inner">
        <iframe
          :src="video.playbackUrl"
          class="w-full h-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen
          loading="lazy"
        />
      </div>
    </template>
    <template #footer>
      <div class="flex justify-between items-center w-full">
        <span class="text-xs text-gray-400">Powered by Cloudflare Stream Edge CDN</span>
        <UButton variant="ghost" @click="open = false">Close</UButton>
      </div>
    </template>
  </UModal>
</template>
