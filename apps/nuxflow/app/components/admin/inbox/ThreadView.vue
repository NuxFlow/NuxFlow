<script setup lang="ts">
interface ThreadAttachment { index: number; filename: string; contentType: string; size: number; available: boolean }
interface ThreadMessage {
  id: string
  direction: 'inbound' | 'outbound'
  fromAddress: string
  fromName: string | null
  toAddress: string
  subject: string
  textBody: string | null
  htmlBody: string | null
  attachments: ThreadAttachment[]
  auth: { spf?: string; dkim?: string; dmarc?: string } | null
  status: 'new' | 'read' | 'archived' | 'spam'
  category: string | null
  aiSummary: string | null
  sentByName: string | null
  createdAt: string
}
interface ThreadResponse {
  message: { id: string; threadId: string; mailboxId: string | null; status: ThreadMessage['status']; subject: string }
  thread: ThreadMessage[]
}

const props = defineProps<{ messageId: string; canDelete: boolean }>()
const emit = defineEmits<{ changed: []; deleted: [] }>()

const toast = useToast()
const { confirm } = useConfirm()

// Plain string-typed URLs: /api/v1/inbox/:id has sibling routes under an [id]/ folder, the
// pattern that collapses Nitro's typed $fetch method inference (see CLAUDE.md).
const messageUrl = computed<string>(() => `/api/v1/inbox/${props.messageId}`)
const { data, pending, refresh } = await useFetch<ThreadResponse>(messageUrl, { watch: [messageUrl] })

const reply = ref('')
const includeQuote = ref(true)
const sending = ref(false)
const suggesting = ref(false)
const busy = ref(false)

watch(() => props.messageId, () => { reply.value = '' })

const latestInbound = computed(() => [...(data.value?.thread ?? [])].reverse().find(m => m.direction === 'inbound'))

function sender(m: ThreadMessage): string {
  if (m.direction === 'outbound') return m.sentByName ? `${m.sentByName} (${m.fromAddress})` : m.fromAddress
  return m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress
}

function authWarning(m: ThreadMessage): string | null {
  const a = m.auth
  if (m.direction !== 'inbound' || !a) return null
  if (a.dmarc === 'fail' || (a.spf === 'fail' && a.dkim !== 'pass')) return 'This message failed sender verification — the From address may be forged.'
  return null
}

async function setStatus(status: ThreadMessage['status']) {
  busy.value = true
  try {
    const url: string = messageUrl.value
    await $fetch<unknown>(url, { method: 'PATCH', body: { status } })
    await refresh()
    emit('changed')
  }
  catch (e: unknown) {
    toast.add({ title: getErrorMessage(e, 'Failed to update message'), color: 'error' })
  }
  finally {
    busy.value = false
  }
}

async function remove() {
  const ok = await confirm({
    title: 'Delete this message permanently?',
    description: 'The message and its attachments are removed. Other messages in the conversation are kept.',
    confirmLabel: 'Delete',
  })
  if (!ok) return
  busy.value = true
  try {
    const url: string = messageUrl.value
    await $fetch<unknown>(url, { method: 'DELETE' })
    emit('deleted')
  }
  catch (e: unknown) {
    toast.add({ title: getErrorMessage(e, 'Failed to delete message'), color: 'error' })
  }
  finally {
    busy.value = false
  }
}

async function suggestReply() {
  suggesting.value = true
  try {
    const url: string = `${messageUrl.value}/suggest-reply`
    const res = await $fetch<{ suggestion: string }>(url, { method: 'POST' })
    reply.value = res.suggestion
  }
  catch (e: unknown) {
    toast.add({ title: getErrorMessage(e, 'Could not draft a reply'), color: 'error' })
  }
  finally {
    suggesting.value = false
  }
}

async function sendReply() {
  if (!reply.value.trim() || !latestInbound.value) return
  sending.value = true
  try {
    const url: string = `/api/v1/inbox/${latestInbound.value.id}/reply`
    await $fetch<{ id: string }>(url, { method: 'POST', body: { body: reply.value, quote: includeQuote.value } })
    reply.value = ''
    toast.add({ title: 'Reply sent', color: 'success' })
    await refresh()
    emit('changed')
  }
  catch (e: unknown) {
    toast.add({ title: getErrorMessage(e, 'Reply failed'), color: 'error' })
  }
  finally {
    sending.value = false
  }
}
</script>

<template>
  <div v-if="pending && !data" class="flex justify-center py-12">
    <UIcon name="i-lucide-loader-2" class="w-6 h-6 animate-spin text-gray-400" />
  </div>

  <div v-else-if="data" class="space-y-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <h2 class="text-lg font-semibold text-gray-900 dark:text-white break-words min-w-0">{{ data.message.subject || '(no subject)' }}</h2>
      <div class="flex flex-wrap gap-1">
        <UButton v-if="data.message.status !== 'archived'" size="xs" variant="soft" icon="i-lucide-archive" :loading="busy" @click="setStatus('archived')">Archive</UButton>
        <UButton v-else size="xs" variant="soft" icon="i-lucide-inbox" :loading="busy" @click="setStatus('read')">Move to inbox</UButton>
        <UButton v-if="data.message.status !== 'spam'" size="xs" color="warning" variant="soft" icon="i-lucide-shield-x" :loading="busy" @click="setStatus('spam')">Spam</UButton>
        <UButton v-else size="xs" color="success" variant="soft" icon="i-lucide-shield-check" :loading="busy" @click="setStatus('read')">Not spam</UButton>
        <UButton size="xs" variant="ghost" icon="i-lucide-mail" :loading="busy" @click="setStatus('new')">Mark unread</UButton>
        <UButton v-if="canDelete" size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :loading="busy" @click="remove">Delete</UButton>
      </div>
    </div>

    <div v-for="m in data.thread" :key="m.id" class="rounded-xl border p-4 space-y-3" :class="m.direction === 'outbound' ? 'border-primary-200 dark:border-primary-900 bg-primary-50/40 dark:bg-primary-950/30' : 'border-gray-200 dark:border-gray-800'">
      <div class="flex flex-wrap items-start justify-between gap-2 text-sm">
        <div class="min-w-0">
          <p class="font-medium text-gray-900 dark:text-white break-all">
            <UIcon v-if="m.direction === 'outbound'" name="i-lucide-reply" class="w-3.5 h-3.5 mr-1 align-[-2px]" />{{ sender(m) }}
          </p>
          <p class="text-xs text-gray-400 break-all">to {{ m.toAddress }}</p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <UBadge v-if="m.category" :label="m.category" variant="soft" size="xs" :color="m.category === 'lead' ? 'success' : m.category === 'support' ? 'info' : 'neutral'" />
          <span class="text-xs text-gray-400">{{ parseDbDate(m.createdAt).toLocaleString() }}</span>
        </div>
      </div>

      <UAlert v-if="authWarning(m)" color="warning" variant="soft" icon="i-lucide-triangle-alert" :description="authWarning(m)!" />
      <p v-if="m.aiSummary" class="text-xs text-gray-500"><UIcon name="i-lucide-sparkles" class="w-3 h-3 align-[-1px]" /> {{ m.aiSummary }}</p>

      <AdminInboxMessageBody :html="m.htmlBody" :text="m.textBody" />

      <div v-if="m.attachments.length" class="flex flex-wrap gap-2">
        <component
          :is="a.available ? 'a' : 'span'"
          v-for="a in m.attachments"
          :key="a.index"
          :href="a.available ? `/api/v1/inbox/${m.id}/attachments/${a.index}` : undefined"
          class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs"
          :class="a.available ? 'hover:bg-gray-50 dark:hover:bg-gray-800' : 'opacity-50'"
          :title="a.available ? 'Download' : 'Not stored — no R2 bucket was bound when this arrived'"
        >
          <UIcon name="i-lucide-paperclip" class="w-3.5 h-3.5" />
          {{ a.filename }} <span class="text-gray-400">{{ formatBytes(a.size) }}</span>
        </component>
      </div>
    </div>

    <UCard v-if="latestInbound">
      <div class="space-y-3">
        <div class="flex items-center justify-between gap-2">
          <p class="text-sm font-medium text-gray-900 dark:text-white">Reply to {{ latestInbound.fromName || latestInbound.fromAddress }}</p>
          <UButton size="xs" variant="ghost" icon="i-lucide-sparkles" :loading="suggesting" @click="suggestReply">Draft with AI</UButton>
        </div>
        <UTextarea v-model="reply" :rows="8" autoresize placeholder="Write your reply…" class="w-full" />
        <div class="flex flex-wrap items-center justify-between gap-3">
          <UCheckbox v-model="includeQuote" label="Quote the original message" />
          <UButton icon="i-lucide-send" :loading="sending" :disabled="!reply.trim()" @click="sendReply">Send reply</UButton>
        </div>
      </div>
    </UCard>
  </div>
</template>
