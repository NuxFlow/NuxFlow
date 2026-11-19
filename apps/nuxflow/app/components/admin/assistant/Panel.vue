<script setup lang="ts">
import { ASSISTANT_LIMITS, type AssistantResponse, type AssistantSection } from '#shared/lib/assistant'

// "Ask AI" — the admin helper (server/routes/_nuxflow/assistant.post.ts). It answers how-to
// questions from the user guide and the site's own setup, and can suggest changes, which
// show as cards the person previews and applies themselves (AdminAssistantProposal). The
// conversation lives in this browser tab only.

const state = useAssistantState()
const access = useAdminAccessState()
const input = ref('')
const sending = ref(false)
const scroller = ref<HTMLElement | null>(null)

const EXAMPLES = [
  'Switch my site to dark mode',
  'Change the accent colour to a deep green',
  'How do I add a contact form?',
  'Why aren\'t my emails sending?',
]

// The screens this person can open, for the helper's links (the server only links to these).
const SETTINGS_TABS = ['General', 'Appearance', 'Business', 'Appointments', 'Podcast', 'Email', 'Payments', 'Media', 'Integrations', 'AI Settings', 'Push', 'Security']
const sections = computed<AssistantSection[]>(() => {
  const a = access.value
  const nav = [...ADMIN_NAV, ...SUPER_ADMIN_NAV]
    .filter(item => !item.hidden && canAccessNavItem(item, a))
    .map(item => ({ label: item.group ? `${ADMIN_NAV_GROUPS[item.group].label} → ${item.label}` : item.label, to: item.to }))
  const tabs = a?.role && roleAtLeast(a.role, 'admin')
    ? SETTINGS_TABS.map(t => ({ label: `Settings → ${t}`, to: `/admin/settings?tab=${encodeURIComponent(t)}` }))
    : []
  return [...nav, ...tabs].slice(0, ASSISTANT_LIMITS.sections)
})

async function scrollToEnd() {
  await nextTick()
  scroller.value?.scrollTo({ top: scroller.value.scrollHeight, behavior: 'smooth' })
}

async function send(text = input.value) {
  const question = text.trim().slice(0, ASSISTANT_LIMITS.messageChars)
  if (!question || sending.value) return
  state.value.turns.push({ role: 'user', text: question })
  input.value = ''
  sending.value = true
  scrollToEnd()
  // Not useAdminAction(): the answer, or why there isn't one, is shown in the conversation.
  try {
    const messages = state.value.turns.filter(t => !t.error).slice(-ASSISTANT_LIMITS.messages).map(t => ({ role: t.role, text: t.text }))
    const res = await $fetch<AssistantResponse>('/_nuxflow/assistant', { method: 'POST', body: { messages, sections: sections.value } })
    state.value.turns.push({ role: 'assistant', text: res.reply, proposals: res.proposals, sources: res.sources, question })
  }
  catch (e) {
    state.value.turns.push({ role: 'assistant', text: getErrorMessage(e, 'The helper could not answer. Check Settings → AI Settings.'), error: true })
  }
  finally {
    sending.value = false
    scrollToEnd()
  }
}

function clear() {
  state.value.turns = []
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}
</script>

<template>
  <USlideover v-model:open="state.open" title="Ask AI" description="Ask how to do something, or what you'd like changed. I only suggest — you check and apply every change." :ui="{ content: 'max-w-md' }">
    <template #body>
      <div class="flex flex-col h-full -my-4 sm:-my-6">
        <div ref="scroller" class="flex-1 overflow-y-auto py-4 space-y-4" data-testid="assistant-turns">
          <div v-if="!state.turns.length" class="space-y-3">
            <p class="text-sm text-gray-600 dark:text-gray-400">Try one of these, or ask your own question:</p>
            <div class="flex flex-col items-start gap-1.5">
              <UButton v-for="ex in EXAMPLES" :key="ex" size="xs" variant="soft" color="neutral" @click="send(ex)">{{ ex }}</UButton>
            </div>
          </div>

          <div v-for="(turn, i) in state.turns" :key="i" :class="turn.role === 'user' ? 'flex justify-end' : ''">
            <div v-if="turn.role === 'user'" class="max-w-[85%] rounded-2xl rounded-br-sm bg-primary-600 text-white px-3 py-2 text-sm whitespace-pre-line">{{ turn.text }}</div>
            <div v-else class="space-y-2">
              <p class="text-sm whitespace-pre-line" :class="turn.error ? 'text-red-500' : 'text-gray-800 dark:text-gray-200'">{{ turn.text }}</p>
              <AdminAssistantProposal
                v-for="(p, j) in turn.proposals ?? []"
                :key="j"
                :proposal="p"
                :question="turn.question ?? ''"
                @navigate="state.open = false"
              />
              <p v-if="turn.sources?.length" class="text-xs text-gray-400">From the user guide: {{ turn.sources.join(' · ') }}</p>
            </div>
          </div>

          <div v-if="sending" class="flex items-center gap-2 text-sm text-gray-500">
            <UIcon name="i-lucide-loader-2" class="w-4 h-4 animate-spin" />
            Thinking…
          </div>
        </div>

        <div class="border-t border-gray-200 dark:border-gray-800 pt-3 space-y-2">
          <UTextarea
            v-model="input"
            :rows="2"
            autoresize
            :maxrows="6"
            :maxlength="ASSISTANT_LIMITS.messageChars"
            placeholder="e.g. Make my headings use a serif font"
            class="w-full"
            aria-label="Your question"
            data-testid="assistant-input"
            @keydown="onKeydown"
          />
          <div class="flex items-center justify-between gap-2">
            <p class="text-xs text-gray-400">AI can make mistakes. Changes are marked AI-assisted in the audit log.</p>
            <div class="flex items-center gap-1">
              <UButton v-if="state.turns.length" size="xs" variant="ghost" color="neutral" @click="clear">Clear</UButton>
              <UButton size="sm" icon="i-lucide-send" :loading="sending" :disabled="!input.trim()" data-testid="assistant-send" @click="send()">Ask</UButton>
            </div>
          </div>
        </div>
      </div>
    </template>
  </USlideover>
</template>
