<script setup lang="ts">
import type { PublicSite } from '#shared/lib/public-site-types'
import { chatbotShownOn } from '#shared/lib/chatbot'

// The website chatbot's floating bubble (Admin → Chatbot). Rendered inside <ClientOnly> by
// layouts/default.vue, so cached page HTML never contains it. The conversation itself is
// PublicChatPanel. Hidden on a page that has the Chat block, which shows the same chat inline.

const { data: site } = useFetch<PublicSite>('/api/public/site', {
  key: 'nuxflow-public-site',
  headers: useRequestHeaders(['host']),
})
const route = useRoute()
const bot = computed(() => site.value?.chatbot ?? null)
const inlineChats = useInlineChatCount()
const shown = computed(() => !!bot.value && inlineChats.value === 0 && chatbotShownOn(route.path, bot.value.excludePaths))

const open = ref(false)
const panelId = useId()

function onEscape(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) open.value = false
}
onMounted(() => window.addEventListener('keydown', onEscape))
onBeforeUnmount(() => window.removeEventListener('keydown', onEscape))
</script>

<template>
  <div v-if="shown && bot" class="nuxflow-chat fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3 print:hidden">
    <PublicChatPanel v-if="open" :id="panelId" role="dialog" :aria-label="bot.name" @close="open = false" />
    <UButton
      size="xl"
      class="nuxflow-chat-button rounded-full shadow-lg"
      :icon="open ? 'i-lucide-x' : 'i-lucide-message-circle'"
      :aria-label="open ? 'Close the chat' : `Chat with ${bot.name}`"
      :aria-expanded="open"
      :aria-controls="panelId"
      @click="open = !open"
    />
  </div>
</template>
