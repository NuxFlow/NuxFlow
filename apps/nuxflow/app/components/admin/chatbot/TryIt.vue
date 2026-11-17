<script setup lang="ts">
import { CHATBOT_LIMITS, type ChatbotStatusResponse } from '#shared/lib/chatbot'

// Admin → Chatbot → Try it: the same chat as the bubble, with the saved settings, working
// before the bubble is switched on. Not kept in Conversations; it does use chat AI credits.
defineProps<{ status: ChatbotStatusResponse }>()

const { messages, sending, wantsLead, send, reset } = useChatbot({ test: true })
const draft = ref('')
const listEl = ref<HTMLElement | null>(null)

watch(() => messages.value.map(m => m.text.length).join(), async () => {
  await nextTick()
  listEl.value?.scrollTo({ top: listEl.value.scrollHeight })
})

async function submit() {
  const text = draft.value
  draft.value = ''
  await send(text, { path: '/' })
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between gap-3">
        <div>
          <h2 class="font-semibold">Try it</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400">Ask what your visitors would. Uses the saved settings — save first after a change. Uses chat AI credits.</p>
        </div>
        <UButton v-if="messages.length" size="sm" variant="ghost" icon="i-lucide-rotate-ccw" @click="reset">Start again</UButton>
      </div>
    </template>
    <div ref="listEl" class="h-96 overflow-y-auto space-y-3 mb-3">
      <p v-if="!messages.length" class="text-sm text-gray-500">{{ status.settings.greeting }}</p>
      <template v-for="(m, i) in messages" :key="i">
        <div v-if="m.role === 'user'" class="ml-auto max-w-[80%] rounded-2xl bg-primary-600 text-white px-3 py-2 text-sm whitespace-pre-wrap break-words">{{ m.text }}</div>
        <div v-else class="max-w-[80%] space-y-1">
          <div class="rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words" :class="m.error ? 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200' : 'bg-gray-100 dark:bg-gray-800'">
            {{ m.text || '…' }}
          </div>
          <p v-if="m.sources?.length" class="text-xs text-gray-500 px-1">From: {{ m.sources.map(s => s.path).join(', ') }}</p>
        </div>
      </template>
      <UAlert v-if="wantsLead" size="sm" color="info" variant="soft" icon="i-lucide-user-round-plus" description="Here a visitor would be offered the form to leave their details." />
    </div>
    <form class="flex items-end gap-2" @submit.prevent="submit">
      <UTextarea v-model="draft" :rows="1" autoresize :maxrows="4" :maxlength="CHATBOT_LIMITS.message" placeholder="Type a question…" class="flex-1" @keydown.enter.exact.prevent="submit" />
      <UButton type="submit" icon="i-lucide-send" :loading="sending" :disabled="!draft.trim() || !status.planIncluded">Send</UButton>
    </form>
  </UCard>
</template>
