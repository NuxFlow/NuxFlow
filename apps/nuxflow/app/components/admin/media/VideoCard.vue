<script setup lang="ts">
// Video library grid item, extracted from media/videos.vue. Purely presentational —
// the parent owns fetching, polling, and modal state; this only renders one video's
// thumbnail/status/meta and emits the two actions a card can trigger.
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

defineProps<{
  video: VideoAsset
}>()

const emit = defineEmits<{
  'open-detail': []
  'play': []
}>()
</script>

<template>
  <div class="group relative flex flex-col rounded-xl overflow-hidden bg-white/70 dark:bg-gray-900/40 border border-gray-200/80 dark:border-gray-800/80 backdrop-blur-sm shadow-sm transition-all duration-300 hover:shadow-md hover:border-gray-300 dark:hover:border-gray-700 hover:translate-y-[-2px]">
    <!-- Thumbnail preview wrapper -->
    <div class="relative aspect-video bg-black flex items-center justify-center overflow-hidden">
      <img
        v-if="video.thumbnailUrl"
        :src="video.thumbnailUrl"
        :alt="video.title"
        class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
        loading="lazy"
      >
      <!-- Custom Status Overlay -->
      <div
        v-if="video.status !== 'ready'"
        class="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2 p-3 text-center"
      >
        <UIcon
          v-if="video.status === 'processing' || video.status === 'uploading'"
          name="i-lucide-refresh-cw"
          class="w-8 h-8 text-primary-400 animate-spin"
        />
        <UIcon
          v-else
          name="i-lucide-alert-circle"
          class="w-8 h-8 text-red-500"
        />
        <span class="text-xs text-gray-300 font-medium capitalize">{{ video.status }}...</span>
      </div>

      <!-- Hover Overlay -->
      <div
        v-if="video.status === 'ready'"
        class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity flex items-center justify-center"
      >
        <UButton
          icon="i-lucide-play"
          size="lg"
          color="neutral"
          variant="solid"
          class="rounded-full shadow-lg scale-90 group-hover:scale-100 transition-all duration-300"
          @click="emit('play')"
        />
      </div>

      <!-- Duration badge -->
      <span
        v-if="video.status === 'ready'"
        class="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/75 text-[10px] font-semibold text-white tracking-wide"
      >
        {{ formatDuration(video.duration) }}
      </span>
    </div>

    <!-- Meta -->
    <div class="p-4 flex-1 flex flex-col justify-between min-w-0">
      <div class="min-w-0">
        <h3 class="font-semibold text-gray-900 dark:text-white truncate" :title="video.title">
          {{ video.title }}
        </h3>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {{ formatBytes(video.size) }} · {{ new Date(video.createdAt).toLocaleDateString() }}
        </p>
      </div>

      <div class="flex gap-2 mt-4 pt-3 border-t border-gray-100 dark:border-gray-800/50">
        <UButton
          icon="i-lucide-settings"
          size="xs"
          variant="ghost"
          color="neutral"
          class="flex-1"
          @click="emit('open-detail')"
        >
          Manage
        </UButton>
        <UButton
          v-if="video.status === 'ready'"
          icon="i-lucide-play-circle"
          size="xs"
          variant="soft"
          color="primary"
          class="flex-1"
          @click="emit('play')"
        >
          Play
        </UButton>
      </div>
    </div>
  </div>
</template>
