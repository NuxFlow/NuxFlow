<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

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

const toast = useToast()
const fileInput = ref<HTMLInputElement>()

// Check Stream credentials before showing upload controls
const { data: streamStatus } = await useFetch<{ configured: boolean }>('/api/v1/media/video/configured')
const streamConfigured = computed(() => streamStatus.value?.configured ?? false)

// Fetch videos
const { data: videos, refresh } = await useFetch<VideoAsset[]>('/api/v1/media/video')

// Poller for processing videos — no completion predicate (there's always another
// video that could start processing later) and no timeout, so it just does
// conditional background sync work for as long as the page stays mounted; the
// shared usePollingUntil() composable handles interval/cleanup, `until: () => false`
// means it only ever stops via its own stop() (never called here) or on unmount.
const videoPoller = usePollingUntil({
  intervalMs: 6000,
  until: () => false,
  onTick: async () => {
    const processing = videos.value?.filter(v => v.status === 'processing' || v.status === 'uploading')
    if (processing && processing.length > 0) {
      await Promise.all(
        processing.map(v => $fetch(`/api/v1/media/video/${v.id}`))
      )
      await refresh()
    }
  },
})

onMounted(() => {
  videoPoller.start()
})

const { uploading, progress, statusText, streamError, upload } = useVideoUpload(async () => {
  await refresh()
  videoPoller.start()
})

async function handleUpload(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files?.length) return
  const file = input.files[0]
  if (!file) return
  await upload(file)
  if (fileInput.value) fileInput.value.value = ''
}

// Form editing details
const showDetailModal = ref(false)
const selectedVideo = ref<VideoAsset | null>(null)
const editTitle = ref('')
const savingDetail = ref(false)
const deletingDetail = ref(false)

function openDetail(video: VideoAsset) {
  selectedVideo.value = video
  editTitle.value = video.title
  showDetailModal.value = true
}

async function saveDetail() {
  if (!selectedVideo.value) return
  savingDetail.value = true
  try {
    await $fetch(`/api/v1/media/video/${selectedVideo.value.id}`, {
      method: 'PATCH',
      body: { title: editTitle.value },
    })
    toast.add({ title: 'Video details updated', color: 'success' })
    await refresh()
    showDetailModal.value = false
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error'
    toast.add({ title: 'Failed to save details', color: 'error', description: errMsg })
  } finally {
    savingDetail.value = false
  }
}

async function deleteVideo() {
  if (!selectedVideo.value) return
  const ok = await useConfirm().confirm({
    title: `Delete "${selectedVideo.value.title}"?`,
    description: 'This will delete the video permanently from Cloudflare Stream and NuxFlow.',
    confirmLabel: 'Delete',
  })
  if (!ok) return
  deletingDetail.value = true
  try {
    await $fetch(`/api/v1/media/video/${selectedVideo.value.id}`, { method: 'DELETE' })
    toast.add({ title: 'Video deleted', color: 'success' })
    await refresh()
    showDetailModal.value = false
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error'
    toast.add({ title: 'Failed to delete video', color: 'error', description: errMsg })
  } finally {
    deletingDetail.value = false
  }
}

// Video Player Modal
const showPlayerModal = ref(false)
const playerVideo = ref<VideoAsset | null>(null)

function playVideo(video: VideoAsset) {
  playerVideo.value = video
  showPlayerModal.value = true
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">Videos</h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Manage and upload adaptive streaming videos powered by Cloudflare Stream.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <UButton
          v-if="!uploading"
          icon="i-lucide-upload"
          color="primary"
          :disabled="!streamConfigured"
          @click="fileInput?.click()"
        >
          Upload Video
        </UButton>
        <UButton
          v-else
          icon="i-lucide-loader-2"
          disabled
          loading
          color="primary"
        >
          Uploading...
        </UButton>
        <input
          ref="fileInput"
          type="file"
          accept="video/*"
          class="sr-only"
          @change="handleUpload"
        >
      </div>
    </div>

    <!-- Stream not configured banner -->
    <UAlert
      v-if="!streamConfigured"
      icon="i-lucide-triangle-alert"
      color="warning"
      variant="soft"
      title="Cloudflare Stream is not configured"
      description="Video uploads are disabled until you add your Account ID and Stream API token."
    >
      <template #description>
        Video uploads are disabled until you add your Account ID and Stream API token.
        <NuxtLink to="/admin/settings" class="underline font-medium ml-1">Go to Settings → Media</NuxtLink> to set them up.
      </template>
    </UAlert>

    <!-- Stream quota / billing error -->
    <UAlert
      v-if="streamError"
      icon="i-lucide-credit-card"
      color="error"
      variant="soft"
      title="Cloudflare Stream quota exceeded"
      :description="streamError"
    >
      <template #description>
        {{ streamError }}
        <a
          href="https://dash.cloudflare.com/?to=/:account/stream"
          target="_blank"
          rel="noopener"
          class="underline font-medium ml-1"
        >Open Cloudflare Stream dashboard →</a>
      </template>
    </UAlert>

    <!-- Upload Progress Overlay (Glassmorphism card) -->
    <div
      v-if="uploading"
      class="rounded-xl border border-primary-500/20 bg-primary-50/10 dark:bg-primary-950/10 p-5 backdrop-blur-md"
    >
      <div class="flex items-center justify-between mb-2">
        <span class="text-sm font-semibold text-primary-600 dark:text-primary-400 flex items-center gap-2">
          <UIcon name="i-lucide-clapperboard" class="w-4 h-4 animate-bounce" />
          {{ statusText }}
        </span>
        <span class="text-xs text-gray-500">{{ progress }}%</span>
      </div>
      <div class="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-2.5 overflow-hidden">
        <div
          class="bg-primary-500 h-2.5 rounded-full transition-all duration-300"
          :style="{ width: `${progress}%` }"
        />
      </div>
    </div>

    <!-- Main Grid -->
    <div v-if="videos && videos.length" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      <VideoCard
        v-for="video in videos"
        :key="video.id"
        :video="video"
        @open-detail="openDetail(video)"
        @play="playVideo(video)"
      />
    </div>

    <!-- Empty state -->
    <div
      v-else
      class="text-center py-20 bg-gray-50/50 dark:bg-gray-900/20 rounded-2xl border border-dashed border-gray-200 dark:border-gray-800"
    >
      <UIcon
        :name="streamConfigured ? 'i-lucide-video' : 'i-lucide-video-off'"
        class="w-12 h-12 mx-auto text-gray-300 dark:text-gray-700 mb-3"
      />
      <h3 class="text-md font-semibold text-gray-700 dark:text-gray-300">
        {{ streamConfigured ? 'No videos uploaded yet' : 'Cloudflare Stream not configured' }}
      </h3>
      <p class="text-sm text-gray-500 dark:text-gray-500 mt-1 max-w-sm mx-auto">
        <template v-if="streamConfigured">
          Upload your first video to begin adaptive bitrate delivery.
        </template>
        <template v-else>
          Add your Account ID and Stream API token in
          <NuxtLink to="/admin/settings" class="underline">Settings → Media</NuxtLink>
          to enable video uploads.
        </template>
      </p>
      <div class="mt-6">
        <UButton
          v-if="streamConfigured && !uploading"
          icon="i-lucide-upload"
          @click="fileInput?.click()"
        >
          Upload first video
        </UButton>
        <UButton
          v-else-if="!streamConfigured"
          icon="i-lucide-settings"
          variant="soft"
          to="/admin/settings"
        >
          Go to Settings
        </UButton>
      </div>
    </div>

    <VideoDetailModal
      v-model:open="showDetailModal"
      v-model:edit-title="editTitle"
      :video="selectedVideo"
      :saving="savingDetail"
      :deleting="deletingDetail"
      @save="saveDetail"
      @delete="deleteVideo"
    />

    <VideoPlayerModal
      v-model:open="showPlayerModal"
      :video="playerVideo"
    />
  </div>
</template>
