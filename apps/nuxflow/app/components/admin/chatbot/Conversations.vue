<script setup lang="ts">
import type { ChatConversationSummary, ChatTranscriptMessage } from '#shared/lib/chatbot'

// Admin → Chatbot → Conversations: what visitors asked and what the bot answered, kept 30 days.
interface ListResponse { conversations: ChatConversationSummary[]; total: number; page: number; pageSize: number }

const { run, isRunning } = useAdminAction()
const { confirm } = useConfirm()
const page = ref(1)
const leadsOnly = ref(false)
const query = computed(() => ({ view: 'conversations', page: page.value, leads: leadsOnly.value ? '1' : '0' }))
const { data, refresh } = await useFetch<ListResponse>('/_nuxflow/chatbot', { query })

const selected = ref<string | null>(null)
const transcript = ref<{ conversation: ChatConversationSummary; messages: ChatTranscriptMessage[] } | null>(null)
const loadingTranscript = ref(false)

async function openConversation(id: string) {
  selected.value = id
  transcript.value = null
  loadingTranscript.value = true
  try {
    transcript.value = await $fetch<{ conversation: ChatConversationSummary; messages: ChatTranscriptMessage[] }>('/_nuxflow/chatbot', { query: { view: 'conversation', id } })
  }
  finally {
    loadingTranscript.value = false
  }
}

// "Add a better answer" on one of the bot's replies: the question is the visitor's message before it.
const faq = reactive({ open: false, question: '', answer: '', messageId: '' })
function improve(index: number) {
  const list = transcript.value?.messages ?? []
  const reply = list[index]!
  const question = list.slice(0, index).reverse().find(m => m.role === 'user')
  Object.assign(faq, { open: true, question: question?.text ?? '', answer: reply.text, messageId: reply.id })
}

async function remove(id: string) {
  const ok = await confirm({ title: 'Delete this conversation?', description: 'It can\'t be brought back. An enquiry already in the Inbox stays there.', confirmLabel: 'Delete', color: 'error' })
  if (!ok) return
  const res = await run(() => $fetch<{ success: boolean }>('/_nuxflow/chatbot', { method: 'POST', body: { action: 'conversation-delete', id } }), {
    successTitle: 'Conversation deleted', errorTitle: "Couldn't delete the conversation", key: `delete:${id}`,
  })
  if (!res) return
  selected.value = null
  transcript.value = null
  await refresh()
}
</script>

<template>
  <div class="grid lg:grid-cols-2 gap-4">
    <UCard>
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <h2 class="font-semibold">Conversations</h2>
          <USwitch v-model="leadsOnly" label="Only ones with details left" @update:model-value="page = 1" />
        </div>
      </template>
      <p v-if="!data?.conversations.length" class="text-sm text-gray-500">No conversations in the last 30 days.</p>
      <ul v-else class="divide-y divide-gray-200 dark:divide-gray-800">
        <li v-for="c in data.conversations" :key="c.id">
          <button
            class="w-full text-left py-3 px-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50"
            :class="selected === c.id ? 'bg-gray-50 dark:bg-gray-800/50' : ''"
            @click="openConversation(c.id)"
          >
            <p class="text-sm font-medium truncate">{{ c.firstMessage || '(left details without chatting)' }}</p>
            <p class="text-xs text-gray-500 mt-0.5">
              {{ formatLocalDateTime(c.lastMessageAt) }} · {{ c.messageCount }} {{ c.messageCount === 1 ? 'question' : 'questions' }} · {{ c.pagePath }}
              <span v-if="c.leadEmail" class="text-green-700 dark:text-green-400"> · {{ c.leadName }} left their details</span>
            </p>
          </button>
        </li>
      </ul>
      <div v-if="data && data.total > data.pageSize" class="flex justify-center pt-3">
        <UPagination v-model:page="page" :total="data.total" :items-per-page="data.pageSize" />
      </div>
    </UCard>

    <UCard v-if="selected">
      <div v-if="loadingTranscript" class="text-sm text-gray-500">Loading…</div>
      <div v-else-if="transcript" class="space-y-3">
        <div class="flex items-start justify-between gap-3">
          <div class="text-sm">
            <p v-if="transcript.conversation.leadEmail" class="font-medium">{{ transcript.conversation.leadName }} &lt;{{ transcript.conversation.leadEmail }}&gt;</p>
            <p class="text-gray-500">Started on {{ transcript.conversation.pagePath }}, {{ formatLocalDateTime(transcript.conversation.createdAt) }}</p>
          </div>
          <div class="flex gap-1">
            <UButton v-if="transcript.conversation.inboxThreadId" size="xs" variant="outline" icon="i-lucide-inbox" to="/admin/inbox">Inbox</UButton>
            <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" aria-label="Delete" :loading="isRunning(`delete:${selected}`)" @click="remove(selected!)" />
          </div>
        </div>
        <template v-for="(m, i) in transcript.messages" :key="m.id">
          <div v-if="m.role === 'user'" class="ml-auto max-w-[85%] rounded-2xl bg-primary-600 text-white px-3 py-2 text-sm whitespace-pre-wrap break-words">{{ m.text }}</div>
          <div v-else class="max-w-[85%] space-y-1">
            <div class="rounded-2xl bg-gray-100 dark:bg-gray-800 px-3 py-2 text-sm whitespace-pre-wrap break-words">{{ m.text }}</div>
            <div class="flex flex-wrap items-center gap-2 px-1 text-xs text-gray-500">
              <span v-if="m.sources?.length">From: {{ m.sources.map(s => s.path).join(', ') }}</span>
              <UBadge v-if="m.unanswered" size="xs" variant="soft" color="warning">Couldn't help</UBadge>
              <UIcon v-if="m.rating === 1" name="i-lucide-thumbs-up" class="w-3.5 h-3.5 text-green-600" aria-label="Rated helpful" />
              <UIcon v-if="m.rating === -1" name="i-lucide-thumbs-down" class="w-3.5 h-3.5 text-red-600" aria-label="Rated not helpful" />
              <button class="underline" @click="improve(i)">Add a better answer</button>
            </div>
          </div>
        </template>
      </div>
    </UCard>

    <AdminChatbotFaqModal v-model:open="faq.open" :question="faq.question" :answer="faq.answer" :message-id="faq.messageId" />
  </div>
</template>
