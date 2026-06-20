<script setup lang="ts">
const props = defineProps<{ title: string }>()

const route = useRoute()
const copied = ref(false)

const pageUrl = computed(() => {
  if (import.meta.server) return ''
  return `${window.location.origin}${route.path}`
})

const twitterUrl = computed(() =>
  `https://twitter.com/intent/tweet?text=${encodeURIComponent(props.title)}&url=${encodeURIComponent(pageUrl.value)}`,
)

const linkedInUrl = computed(() =>
  `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(pageUrl.value)}`,
)

async function copyLink() {
  try {
    await navigator.clipboard.writeText(pageUrl.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  }
  catch { /* clipboard API unavailable on insecure origins */ }
}
</script>

<template>
  <ClientOnly>
    <div class="flex items-center gap-2 flex-wrap">
      <span class="text-sm text-gray-500 mr-1">Share:</span>
      <UButton
        :to="twitterUrl"
        target="_blank"
        rel="noopener noreferrer"
        variant="outline"
        size="sm"
        icon="i-lucide-twitter"
        label="X / Twitter"
        external
      />
      <UButton
        :to="linkedInUrl"
        target="_blank"
        rel="noopener noreferrer"
        variant="outline"
        size="sm"
        icon="i-lucide-linkedin"
        label="LinkedIn"
        external
      />
      <UButton
        variant="outline"
        size="sm"
        :icon="copied ? 'i-lucide-check' : 'i-lucide-link'"
        :label="copied ? 'Copied!' : 'Copy link'"
        @click="copyLink"
      />
    </div>
  </ClientOnly>
</template>
