<script setup lang="ts">
// The site-wide audio player: a bar along the bottom of public pages that keeps playing a
// podcast episode while the visitor moves around the site (the default layout isn't
// re-created between pages). Started by "Play episode" on an episode's page; the browser's
// own controls do the rest (play, seek, speed in most browsers, keyboard).
// Theme hooks: .nux-audio-player, .nux-audio-player-title.
const track = useAudioTrack()
const audio = ref<HTMLAudioElement | null>(null)

watch(() => track.value?.src, async (src) => {
  if (!src) return
  await nextTick()
  audio.value?.play().catch(() => {
    // Autoplay refused: the controls are there for the visitor to press play.
  })
})

// Sit above anything else pinned to the bottom (the cookie banner, marked
// data-nuxflow-bottom-bar), so the controls are never hidden under it.
const offset = ref(0)
let observer: MutationObserver | null = null
function measure() {
  const bars = Array.from(document.querySelectorAll<HTMLElement>('[data-nuxflow-bottom-bar]'))
  offset.value = bars.reduce((most, bar) => Math.max(most, bar.offsetHeight), 0)
}
watch(() => Boolean(track.value), (playing) => {
  observer?.disconnect()
  observer = null
  if (!playing) return
  measure()
  observer = new MutationObserver(measure)
  observer.observe(document.body, { childList: true, subtree: true })
}, { immediate: true })
onMounted(() => window.addEventListener('resize', measure))
onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('resize', measure)
})

function close() {
  audio.value?.pause()
  track.value = null
}
</script>

<template>
  <!-- Room at the foot of the page, so the bar never covers its last lines. -->
  <div v-if="track" class="h-16" aria-hidden="true" />
  <div
    v-if="track"
    class="nux-audio-player fixed inset-x-0 z-40 border-t border-gray-200 bg-white/95 px-4 py-2 shadow-lg backdrop-blur dark:border-gray-800 dark:bg-gray-900/95"
    :style="{ bottom: `${offset}px` }"
    role="region"
    aria-label="Audio player"
  >
    <div class="mx-auto flex max-w-4xl items-center gap-3">
      <div class="min-w-0 flex-1 sm:flex-none sm:w-56">
        <NuxtLink v-if="track.link" :to="track.link" class="nux-audio-player-title block truncate text-sm font-medium hover:underline">{{ track.title }}</NuxtLink>
        <p v-else class="nux-audio-player-title truncate text-sm font-medium">{{ track.title }}</p>
        <p v-if="track.duration" class="text-xs text-gray-500">{{ track.duration }}</p>
      </div>
      <audio ref="audio" :key="track.src" :src="track.src" controls preload="metadata" class="h-10 flex-1 min-w-0" :aria-label="`Playing: ${track.title}`" />
      <UButton icon="i-lucide-x" variant="ghost" color="neutral" size="sm" aria-label="Close the player" @click="close" />
    </div>
  </div>
</template>
