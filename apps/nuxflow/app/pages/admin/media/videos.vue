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
const uploading = ref(false)
const progress = ref(0)
const statusText = ref('')
const fileInput = ref<HTMLInputElement>()
const streamError = ref<string | null>(null)

// Check Stream credentials before showing upload controls
const { data: streamStatus } = await useFetch<{ configured: boolean }>('/api/v1/media/video/configured')
const streamConfigured = computed(() => streamStatus.value?.configured ?? false)

// Fetch videos
const { data: videos, refresh } = await useFetch<VideoAsset[]>('/api/v1/media/video')

// Form editing details
const showDetailModal = ref(false)
const selectedVideo = ref<VideoAsset | null>(null)
const editTitle = ref('')
const savingDetail = ref(false)
const deletingDetail = ref(false)

// Video Player Modal
const showPlayerModal = ref(false)
const playerVideo = ref<VideoAsset | null>(null)

// Poller for processing videos
let poller: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  startPoller()
})

onBeforeUnmount(() => {
  if (poller) clearInterval(poller)
})

function startPoller() {
  if (poller) clearInterval(poller)
  poller = setInterval(async () => {
    // If any videos are processing, sync status in background
    const processing = videos.value?.filter(v => v.status === 'processing' || v.status === 'uploading')
    if (processing && processing.length > 0) {
      await Promise.all(
        processing.map(v => $fetch(`/api/v1/media/video/${v.id}`))
      )
      await refresh()
    }
  }, 6000)
}

async function handleUpload(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files?.length) return
  const file = input.files[0]
  if (!file) return
  await uploadFile(file)
}

async function uploadFile(file: File) {
  uploading.value = true
  progress.value = 0
  statusText.value = 'Preparing upload...'
  streamError.value = null

  try {
    // 1. Get a pre-authorised upload.cloudflarestream.com URL from the backend.
    //    TUS cannot be used from the browser: the authenticated CF TUS endpoint has no
    //    CORS headers, and the direct_upload URL doesn't implement TUS properly.
    //    A plain XHR POST to the direct_upload URL is the correct approach.
    const { uploadUrl, uid } = await $fetch<{ uploadUrl: string; uid: string }>('/api/v1/media/video/token', {
      method: 'POST',
      body: { title: file.name },
    })

    statusText.value = 'Uploading to Cloudflare Stream...'

    // 2. Upload via XHR so we get upload progress events.
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          progress.value = Math.round((e.loaded / e.total) * 100)
          statusText.value = `Uploading: ${progress.value}% (${formatBytes(e.loaded)} of ${formatBytes(e.total)})`
        }
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve()
        else reject(new Error(`Upload failed (${xhr.status}): ${xhr.statusText || 'unknown error'}`))
      }
      xhr.onerror = () => reject(new Error('Network error during upload — check your connection and try again.'))
      xhr.onabort = () => reject(new Error('Upload was cancelled.'))
      xhr.open('POST', uploadUrl)
      const form = new FormData()
      form.append('file', file)
      xhr.send(form)
    })

    // 3. Register the video in NuxFlow and let the poller sync processing status.
    statusText.value = 'Registering video with library...'
    await $fetch('/api/v1/media/video', {
      method: 'POST',
      body: { uid, title: file.name.replace(/\.[^/.]+$/, ''), size: file.size },
    })
    toast.add({ title: 'Video uploaded!', color: 'green', description: 'Cloudflare Stream is now processing the file.' })
    await refresh()
    startPoller()
  }
  catch (err: unknown) {
    console.error('Video upload failed:', err)
    const status = (err as { status?: number })?.status
    const errorMsg = (err as { data?: { message?: string } })?.data?.message
      || (err instanceof Error ? err.message : 'Verify your Cloudflare Stream settings.')
    if (status === 402) {
      streamError.value = errorMsg
    }
    else {
      toast.add({ title: 'Upload failed', color: 'red', description: errorMsg })
    }
  }
  finally {
    uploading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

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
    toast.add({ title: 'Video details updated', color: 'green' })
    await refresh()
    showDetailModal.value = false
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error'
    toast.add({ title: 'Failed to save details', color: 'red', description: errMsg })
  } finally {
    savingDetail.value = false
  }
}

async function deleteVideo() {
  if (!selectedVideo.value) return
  if (!confirm(`Delete "${selectedVideo.value.title}"? This will delete the video permanently from Cloudflare Stream and NuxFlow.`)) return
  deletingDetail.value = true
  try {
    await $fetch(`/api/v1/media/video/${selectedVideo.value.id}`, { method: 'DELETE' })
    toast.add({ title: 'Video deleted', color: 'green' })
    await refresh()
    showDetailModal.value = false
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error'
    toast.add({ title: 'Failed to delete video', color: 'red', description: errMsg })
  } finally {
    deletingDetail.value = false
  }
}

async function copyStreamUrl(streamId: string) {
  const url = `https://iframe.videodelivery.net/${streamId}`
  await navigator.clipboard.writeText(url)
  toast.add({ title: 'URL copied!', description: 'Paste it into a Canvas Video block.', color: 'green' })
}

function playVideo(video: VideoAsset) {
  playerVideo.value = video
  showPlayerModal.value = true
}

// Helper formatting utilities
function formatBytes(bytes: number | null) {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return '--:--'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
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
      color="yellow"
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
      color="red"
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
      <div
        v-for="video in videos"
        :key="video.id"
        class="group relative flex flex-col rounded-xl overflow-hidden bg-white/70 dark:bg-gray-900/40 border border-gray-200/80 dark:border-gray-800/80 backdrop-blur-sm shadow-sm transition-all duration-300 hover:shadow-md hover:border-gray-300 dark:hover:border-gray-700 hover:translate-y-[-2px]"
      >
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
            class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
          >
            <UButton
              icon="i-lucide-play"
              size="lg"
              color="neutral"
              variant="solid"
              class="rounded-full shadow-lg scale-90 group-hover:scale-100 transition-all duration-300"
              @click="playVideo(video)"
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
              @click="openDetail(video)"
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
              @click="playVideo(video)"
            >
              Play
            </UButton>
          </div>
        </div>
      </div>
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

    <!-- Video Detail / Rename Modal -->
    <UModal v-model:open="showDetailModal" title="Edit Video Details">
      <template #body>
        <div v-if="selectedVideo" class="space-y-4">
          <div class="flex gap-4 items-start pb-4 border-b border-gray-100 dark:border-gray-800">
            <div class="w-24 aspect-video rounded-lg overflow-hidden bg-black shrink-0 flex items-center justify-center">
              <img
                v-if="selectedVideo.thumbnailUrl"
                :src="selectedVideo.thumbnailUrl"
                class="w-full h-full object-cover"
              >
              <UIcon v-else name="i-lucide-video" class="w-8 h-8 text-gray-600" />
            </div>
            <div class="text-xs text-gray-500 dark:text-gray-400 space-y-1">
              <p class="flex items-center gap-1.5">
                <span class="font-medium shrink-0">Stream URL:</span>
                <code class="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded truncate max-w-[140px]" :title="`https://iframe.videodelivery.net/${selectedVideo.cloudflareStreamId}`">
                  {{ selectedVideo.cloudflareStreamId }}
                </code>
                <UButton
                  icon="i-lucide-copy"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  title="Copy video URL for use in Canvas Video block"
                  @click="copyStreamUrl(selectedVideo.cloudflareStreamId)"
                />
              </p>
              <p><span class="font-medium">Duration:</span> {{ formatDuration(selectedVideo.duration) }}</p>
              <p><span class="font-medium">Size:</span> {{ formatBytes(selectedVideo.size) }}</p>
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
            color="red"
            variant="ghost"
            icon="i-lucide-trash-2"
            :loading="deletingDetail"
            @click="deleteVideo"
          >
            Delete Permanently
          </UButton>
          <div class="flex gap-2">
            <UButton variant="ghost" @click="showDetailModal = false">Cancel</UButton>
            <UButton :loading="savingDetail" color="primary" @click="saveDetail">Save changes</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Visual Streaming Player Modal -->
    <UModal v-model:open="showPlayerModal" :title="playerVideo?.title ?? 'Video Player'" size="xl">
      <template #body>
        <div v-if="playerVideo" class="aspect-video bg-black rounded-lg overflow-hidden shadow-inner">
          <iframe
            :src="`https://iframe.videodelivery.net/${playerVideo.cloudflareStreamId}?controls=true&letterbox=false`"
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
          <UButton variant="ghost" @click="showPlayerModal = false">Close</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
