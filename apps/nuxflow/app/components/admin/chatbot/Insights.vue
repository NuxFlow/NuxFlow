<script setup lang="ts">
import type { ChatInsightItem, ChatInsightsResponse } from '#shared/lib/chatbot'

// Admin → Chatbot → Insights: how the last 30 days went, and the answers that need a look —
// questions it couldn't help with, and answers visitors said weren't helpful.
const { run, isRunning } = useAdminAction()
const { data, refresh } = await useFetch<ChatInsightsResponse>('/_nuxflow/chatbot', { query: { view: 'insights' } })

const editing = ref<ChatInsightItem | null>(null)
const modalOpen = ref(false)
function addAnswer(item: ChatInsightItem) {
  editing.value = item
  modalOpen.value = true
}

async function dismiss(item: ChatInsightItem) {
  const res = await run(() => $fetch<{ success: boolean }>('/_nuxflow/chatbot', { method: 'POST', body: { action: 'review', messageId: item.messageId } }), {
    errorTitle: "Couldn't dismiss it", key: `dismiss:${item.messageId}`,
  })
  if (res) await refresh()
}

const cards = computed(() => {
  const t = data.value?.totals
  if (!t) return []
  const rated = t.helpful + t.unhelpful
  return [
    { label: 'Conversations', value: t.conversations.toLocaleString() },
    { label: 'Questions', value: t.questions.toLocaleString() },
    { label: 'Details left', value: t.leads.toLocaleString() },
    { label: 'Helpful', value: rated ? `${Math.round((t.helpful / rated) * 100)}%` : '—', hint: rated ? `${rated} rated` : 'No ratings yet' },
    { label: 'Couldn\'t help', value: t.unanswered.toLocaleString() },
  ]
})
</script>

<template>
  <div class="space-y-4">
    <div class="grid grid-cols-2 sm:grid-cols-5 gap-3">
      <UCard v-for="c in cards" :key="c.label">
        <p class="text-xs text-gray-500">{{ c.label }}</p>
        <p class="text-2xl font-semibold mt-1">{{ c.value }}</p>
        <p v-if="c.hint" class="text-xs text-gray-400">{{ c.hint }}</p>
      </UCard>
    </div>
    <p class="text-xs text-gray-500">The last 30 days. "Try it" chats aren't counted.</p>

    <UCard>
      <template #header>
        <div>
          <h2 class="font-semibold">Needs a look</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400">Questions it couldn't help with, and answers visitors marked as not helpful. Add an answer and the chatbot uses it next time.</p>
        </div>
      </template>
      <p v-if="!data?.items.length" class="text-sm text-gray-500">Nothing to look at — nice.</p>
      <ul v-else class="divide-y divide-gray-200 dark:divide-gray-800">
        <li v-for="item in data.items" :key="item.messageId" class="py-3 space-y-2">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <UBadge size="xs" variant="soft" :color="item.reason === 'unhelpful' ? 'error' : 'warning'">
                  {{ item.reason === 'unhelpful' ? 'Not helpful' : 'Couldn\'t help' }}
                </UBadge>
                <span class="text-xs text-gray-500">{{ formatLocalDateTime(item.createdAt) }}</span>
              </div>
              <p class="font-medium text-sm mt-1">{{ item.question || '(no question)' }}</p>
              <p class="text-sm text-gray-500 dark:text-gray-400 line-clamp-3 whitespace-pre-wrap">{{ item.answer }}</p>
            </div>
            <div class="flex gap-1 shrink-0">
              <UButton size="xs" icon="i-lucide-plus" @click="addAnswer(item)">Add an answer</UButton>
              <UButton size="xs" variant="ghost" color="neutral" :loading="isRunning(`dismiss:${item.messageId}`)" @click="dismiss(item)">Dismiss</UButton>
            </div>
          </div>
        </li>
      </ul>
    </UCard>

    <AdminChatbotFaqModal v-if="editing" v-model:open="modalOpen" :question="editing.question" :answer="''" :message-id="editing.messageId" @saved="refresh()" />
  </div>
</template>
