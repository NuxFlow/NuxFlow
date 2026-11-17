<script setup lang="ts">
import type { PublicSite } from '#shared/lib/public-site-types'
import { chatbotShownOn, CHATBOT_LIMITS } from '#shared/lib/chatbot'

// The website chatbot's bubble (Admin → Chatbot). Rendered inside <ClientOnly> by
// layouts/default.vue, so cached page HTML never contains it. Replies are plain text
// (never HTML), so nothing the model writes can run on the page.

const { data: site } = useFetch<PublicSite>('/api/public/site', {
  key: 'nuxflow-public-site',
  headers: useRequestHeaders(['host']),
})
const route = useRoute()
const bot = computed(() => site.value?.chatbot ?? null)
const shown = computed(() => !!bot.value && chatbotShownOn(route.path, bot.value.excludePaths))

const { messages, sending, wantsLead, stopped, leadSent, needsTurnstile, send, sendLead, reset } = useChatbot()

const open = ref(false)
const draft = ref('')
const inputEl = ref<{ $el?: HTMLElement } | null>(null)
const listEl = ref<HTMLElement | null>(null)
const panelId = useId()

const siteKey = computed(() => site.value?.turnstileSiteKey ?? null)
const turnstileToken = ref('')
// Turnstile guards the first message (and a message left before any chat).
const showTurnstile = computed(() => !!siteKey.value && (messages.value.length === 0 || needsTurnstile.value))

const showLeadForm = ref(false)
const leadOffered = computed(() => bot.value?.lead.mode !== 'off' && !leadSent.value)
watch(wantsLead, (v) => { if (v && leadOffered.value) showLeadForm.value = true })

const lead = reactive({ name: '', email: '', phone: '', message: '', website: '' })
const leadError = ref('')
const leadBusy = ref(false)

async function scrollDown() {
  await nextTick()
  listEl.value?.scrollTo({ top: listEl.value.scrollHeight })
}
watch(() => messages.value.map(m => m.text.length).join(), scrollDown)
watch(showLeadForm, scrollDown)

function focusInput() {
  nextTick(() => inputEl.value?.$el?.querySelector('textarea')?.focus())
}

function toggle() {
  open.value = !open.value
  if (open.value) {
    focusInput()
    scrollDown()
  }
}

async function submit(text = draft.value) {
  const message = text.trim()
  if (!message || sending.value || stopped.value) return
  if (showTurnstile.value && !turnstileToken.value) return
  draft.value = ''
  await send(message, { path: route.path, turnstileToken: turnstileToken.value || undefined })
  turnstileToken.value = ''
  focusInput()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    submit()
  }
}

async function submitLead() {
  leadError.value = ''
  if (!lead.name.trim() || !lead.email.trim()) {
    leadError.value = 'Please add your name and email.'
    return
  }
  if (showTurnstile.value && !turnstileToken.value) {
    leadError.value = 'Please complete the check above first.'
    return
  }
  leadBusy.value = true
  try {
    await sendLead({
      name: lead.name,
      email: lead.email,
      phone: bot.value?.lead.askPhone ? lead.phone || undefined : undefined,
      message: lead.message || undefined,
      website: lead.website || undefined,
    }, { path: route.path, turnstileToken: turnstileToken.value || undefined })
    showLeadForm.value = false
  }
  catch (err) {
    leadError.value = getErrorMessage(err, 'Couldn\'t send your details. Please try again.')
  }
  finally {
    leadBusy.value = false
  }
}

function startOver() {
  reset()
  showLeadForm.value = false
  focusInput()
}

function onEscape(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) open.value = false
}
onMounted(() => window.addEventListener('keydown', onEscape))
onBeforeUnmount(() => window.removeEventListener('keydown', onEscape))
</script>

<template>
  <div v-if="shown && bot" class="nuxflow-chat fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3 print:hidden">
    <div
      v-if="open"
      :id="panelId"
      role="dialog"
      :aria-label="bot.name"
      class="nuxflow-chat-panel w-[calc(100vw-2rem)] sm:w-96 h-[min(36rem,calc(100dvh-6rem))] flex flex-col rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-2xl overflow-hidden"
    >
      <div class="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-primary-600 text-white">
        <p class="font-semibold truncate">{{ bot.name }}</p>
        <div class="flex items-center gap-1">
          <UButton v-if="messages.length" size="xs" color="neutral" variant="ghost" class="text-white hover:bg-white/10" icon="i-lucide-rotate-ccw" aria-label="Start a new conversation" @click="startOver" />
          <UButton size="xs" color="neutral" variant="ghost" class="text-white hover:bg-white/10" icon="i-lucide-x" aria-label="Close the chat" @click="open = false" />
        </div>
      </div>

      <div ref="listEl" class="flex-1 overflow-y-auto px-4 py-3 space-y-3" aria-live="polite">
        <div v-if="bot.greeting" class="nuxflow-chat-msg nuxflow-chat-msg--bot max-w-[85%] rounded-2xl rounded-tl-sm bg-gray-100 dark:bg-gray-800 px-3 py-2 text-sm whitespace-pre-wrap">{{ bot.greeting }}</div>

        <div v-if="!messages.length && bot.starterQuestions.length" class="flex flex-wrap gap-2">
          <UButton
            v-for="q in bot.starterQuestions"
            :key="q"
            size="xs"
            variant="outline"
            :disabled="showTurnstile && !turnstileToken"
            @click="submit(q)"
          >
            {{ q }}
          </UButton>
        </div>

        <template v-for="(m, i) in messages" :key="i">
          <div
            v-if="m.role === 'user'"
            class="nuxflow-chat-msg nuxflow-chat-msg--user ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-primary-600 text-white px-3 py-2 text-sm whitespace-pre-wrap break-words"
          >
            {{ m.text }}
          </div>
          <div v-else class="max-w-[85%] space-y-1">
            <div
              class="nuxflow-chat-msg nuxflow-chat-msg--bot rounded-2xl rounded-tl-sm px-3 py-2 text-sm whitespace-pre-wrap break-words"
              :class="m.error ? 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200' : 'bg-gray-100 dark:bg-gray-800'"
            >
              <span v-if="m.text">{{ m.text }}</span>
              <span v-else class="inline-flex gap-1" aria-label="Typing">
                <span class="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" />
                <span class="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:150ms]" />
                <span class="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:300ms]" />
              </span>
            </div>
            <div v-if="bot.showSources && m.sources?.length" class="flex flex-wrap gap-x-3 gap-y-1 px-1 text-xs">
              <NuxtLink v-for="s in m.sources" :key="s.path ?? s.title" :to="s.path ?? undefined" class="text-primary-600 dark:text-primary-400 underline">
                {{ s.title }}
              </NuxtLink>
            </div>
          </div>
        </template>

        <p v-if="leadSent" class="text-sm text-green-700 dark:text-green-400">Thanks — the team has your details and will get back to you.</p>

        <form v-if="showLeadForm && leadOffered" class="space-y-2 rounded-xl border border-gray-200 dark:border-gray-800 p-3" @submit.prevent="submitLead">
          <p class="text-sm font-medium">Leave your details and the team will get back to you</p>
          <UInput v-model="lead.name" placeholder="Your name" autocomplete="name" maxlength="100" class="w-full" aria-label="Your name" />
          <UInput v-model="lead.email" type="email" placeholder="Your email" autocomplete="email" maxlength="254" class="w-full" aria-label="Your email" />
          <UInput v-if="bot.lead.askPhone" v-model="lead.phone" type="tel" placeholder="Phone (optional)" autocomplete="tel" maxlength="40" class="w-full" aria-label="Phone" />
          <UTextarea v-model="lead.message" :rows="2" placeholder="Anything else? (optional)" maxlength="2000" class="w-full" aria-label="Message" />
          <!-- Honeypot: hidden from people, filled in by bots. -->
          <input v-model="lead.website" type="text" name="website" tabindex="-1" autocomplete="off" class="hidden" aria-hidden="true">
          <p v-if="bot.lead.consentText" class="text-xs text-gray-500">{{ bot.lead.consentText }}</p>
          <p v-if="leadError" class="text-xs text-red-600">{{ leadError }}</p>
          <div class="flex gap-2">
            <UButton type="submit" size="sm" :loading="leadBusy">Send</UButton>
            <UButton size="sm" variant="ghost" color="neutral" @click="showLeadForm = false">Not now</UButton>
          </div>
        </form>
      </div>

      <div class="border-t border-gray-200 dark:border-gray-800 p-3 space-y-2">
        <NuxtTurnstile v-if="showTurnstile && siteKey" v-model="turnstileToken" :site-key="siteKey" />
        <p v-if="stopped === 'limit'" class="text-xs text-gray-500">This conversation has reached its limit. <button class="underline" @click="startOver">Start a new one</button>.</p>
        <form v-else class="flex items-end gap-2" @submit.prevent="submit()">
          <UTextarea
            ref="inputEl"
            v-model="draft"
            :rows="1"
            autoresize
            :maxrows="4"
            :maxlength="CHATBOT_LIMITS.message"
            :disabled="stopped === 'paused'"
            placeholder="Type your question…"
            class="flex-1"
            aria-label="Your message"
            @keydown="onKeydown"
          />
          <UButton type="submit" icon="i-lucide-send" aria-label="Send" :loading="sending" :disabled="!draft.trim() || stopped === 'paused' || (showTurnstile && !turnstileToken)" />
        </form>
        <button
          v-if="bot.lead.mode === 'always' && leadOffered && !showLeadForm"
          class="text-xs text-primary-600 dark:text-primary-400 underline"
          @click="showLeadForm = true"
        >
          Leave a message for the team
        </button>
      </div>
    </div>

    <UButton
      size="xl"
      class="nuxflow-chat-button rounded-full shadow-lg"
      :icon="open ? 'i-lucide-x' : 'i-lucide-message-circle'"
      :aria-label="open ? 'Close the chat' : `Chat with ${bot.name}`"
      :aria-expanded="open"
      :aria-controls="panelId"
      @click="toggle"
    />
  </div>
</template>
