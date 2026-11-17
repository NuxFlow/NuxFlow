<script setup lang="ts">
import type { ChatbotIndexStatus, ChatbotStatusResponse, ChatKnowledgeEntry } from '#shared/lib/chatbot'

const props = defineProps<{ status: ChatbotStatusResponse }>()
const emit = defineEmits<{ changed: [] }>()

const { run, isRunning } = useAdminAction()
const { confirm } = useConfirm()
const { data, refresh } = await useFetch<{ entries: ChatKnowledgeEntry[] }>('/_nuxflow/chatbot', { query: { view: 'knowledge' } })
const entries = computed(() => data.value?.entries ?? [])
const index = ref<ChatbotIndexStatus>(props.status.index)
watch(() => props.status.index, (v) => { index.value = v })

const editing = ref(false)
const form = reactive({ id: undefined as string | undefined, kind: 'faq' as 'faq' | 'text', title: '', body: '', enabled: true })

function openNew(kind: 'faq' | 'text') {
  Object.assign(form, { id: undefined, kind, title: '', body: '', enabled: true })
  editing.value = true
}
function openEdit(e: ChatKnowledgeEntry) {
  Object.assign(form, { id: e.id, kind: e.kind, title: e.title, body: e.body, enabled: e.enabled })
  editing.value = true
}

async function save() {
  const res = await run(() => $fetch<{ id: string }>('/_nuxflow/chatbot', { method: 'POST', body: { action: 'knowledge-save', ...form } }), {
    successTitle: form.id ? 'Entry updated' : 'Entry added',
    errorTitle: "Couldn't save the entry",
    key: 'save',
  })
  if (!res) return
  editing.value = false
  await refresh()
  emit('changed')
}

async function remove(e: ChatKnowledgeEntry) {
  const ok = await confirm({ title: 'Delete this entry?', description: 'The chatbot stops using it within a minute or two.', confirmLabel: 'Delete', color: 'error' })
  if (!ok) return
  const res = await run(() => $fetch<{ success: boolean }>('/_nuxflow/chatbot', { method: 'POST', body: { action: 'knowledge-delete', id: e.id } }), {
    successTitle: 'Entry deleted', errorTitle: "Couldn't delete the entry", key: `delete:${e.id}`,
  })
  if (res) {
    await refresh()
    emit('changed')
  }
}

async function syncNow() {
  const res = await run(() => $fetch<{ done: boolean; stopped?: string; index: ChatbotIndexStatus }>('/_nuxflow/chatbot', { method: 'POST', body: { action: 'sync' } }), {
    errorTitle: "Couldn't update the chatbot",
    key: 'sync',
    successTitle: r => r.stopped === 'allowance' ? 'Paused: this month\'s chat AI allowance is used up' : r.done ? 'Up to date' : 'Part-way there — it carries on by itself',
  })
  if (res) index.value = res.index
}
</script>

<template>
  <div class="space-y-4">
    <UCard>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="text-sm">
          <template v-if="index.indexAvailable">
            <p class="font-medium">
              Learnt {{ index.learnt.toLocaleString() }} {{ index.learnt === 1 ? 'page or entry' : 'pages and entries' }}
              <span v-if="index.pending" class="text-amber-600"> · {{ index.pending.toLocaleString() }} still to learn</span>
            </p>
            <p class="text-gray-500 dark:text-gray-400">New and changed pages are picked up by themselves within a minute or two.</p>
          </template>
          <p v-else class="text-gray-500 dark:text-gray-400">
            This installation has no search index (Vectorize), so the chatbot only knows your business details from Settings → Business. Pages and the entries below need the <code>[[vectorize]]</code> binding in wrangler.toml.
          </p>
        </div>
        <UButton v-if="index.indexAvailable" variant="outline" icon="i-lucide-refresh-cw" :loading="isRunning('sync')" @click="syncNow">Update now</UButton>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="font-semibold">Knowledge</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400">Answers to common questions, and anything else it should know that isn't on your pages.</p>
          </div>
          <div class="flex gap-2">
            <UButton icon="i-lucide-plus" @click="openNew('faq')">Question &amp; answer</UButton>
            <UButton variant="outline" icon="i-lucide-plus" @click="openNew('text')">Text</UButton>
          </div>
        </div>
      </template>

      <p v-if="!entries.length" class="text-sm text-gray-500">Nothing yet. Add the questions people ask you most — the chatbot uses your answers word for word.</p>
      <ul v-else class="divide-y divide-gray-200 dark:divide-gray-800">
        <li v-for="e in entries" :key="e.id" class="py-3 flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <UBadge size="xs" variant="soft" :color="e.kind === 'faq' ? 'primary' : 'neutral'">{{ e.kind === 'faq' ? 'Q&A' : 'Text' }}</UBadge>
              <UBadge v-if="!e.enabled" size="xs" variant="soft" color="warning">Off</UBadge>
              <p class="font-medium text-sm truncate">{{ e.title }}</p>
            </div>
            <p class="text-sm text-gray-500 dark:text-gray-400 line-clamp-2 mt-1">{{ e.body }}</p>
          </div>
          <div class="flex gap-1 shrink-0">
            <UButton size="xs" variant="ghost" icon="i-lucide-pencil" aria-label="Edit" @click="openEdit(e)" />
            <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" aria-label="Delete" :loading="isRunning(`delete:${e.id}`)" @click="remove(e)" />
          </div>
        </li>
      </ul>
    </UCard>

    <UModal v-model:open="editing" :title="form.id ? 'Edit entry' : form.kind === 'faq' ? 'New question and answer' : 'New text'">
      <template #body>
        <div class="space-y-4">
          <UFormField :label="form.kind === 'faq' ? 'Question' : 'Title'" required>
            <UInput v-model="form.title" maxlength="300" class="w-full" :placeholder="form.kind === 'faq' ? 'Do you offer gift vouchers?' : 'Delivery area'" />
          </UFormField>
          <UFormField :label="form.kind === 'faq' ? 'Answer' : 'Text'" required>
            <UTextarea v-model="form.body" :rows="6" maxlength="4000" class="w-full" />
          </UFormField>
          <USwitch v-model="form.enabled" label="The chatbot uses this" />
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton variant="ghost" color="neutral" @click="editing = false">Cancel</UButton>
          <UButton :loading="isRunning('save')" :disabled="!form.title.trim() || !form.body.trim()" @click="save">Save</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
