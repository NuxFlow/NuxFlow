<script setup lang="ts">
// "Add a better answer": turns a visitor's question (and the bot's reply, as a starting
// point) into a Knowledge question-and-answer, so next time the bot answers it properly.
// Used from Conversations and Insights. `messageId` (the bot's answer) is marked dealt with.
const props = defineProps<{ question: string; answer: string; messageId?: string }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ saved: [] }>()

const { run, isRunning } = useAdminAction()
const form = reactive({ title: '', body: '' })
// Refilled on opening, and when it's opened for another question.
watch(() => [open.value, props.question, props.answer] as const, ([isOpen, question, answer]) => {
  if (!isOpen) return
  form.title = question.slice(0, 300)
  form.body = answer.slice(0, 4000)
}, { immediate: true })

async function save() {
  const res = await run(async () => {
    const saved = await $fetch<{ id: string }>('/_nuxflow/chatbot', { method: 'POST', body: { action: 'knowledge-save', kind: 'faq', title: form.title, body: form.body, enabled: true } })
    if (props.messageId) await $fetch<{ success: boolean }>('/_nuxflow/chatbot', { method: 'POST', body: { action: 'review', messageId: props.messageId } })
    return saved
  }, { successTitle: 'Added to Knowledge — the chatbot uses it within a minute or two', errorTitle: "Couldn't add the answer", key: 'save' })
  if (!res) return
  open.value = false
  emit('saved')
}
</script>

<template>
  <UModal v-model:open="open" title="Add a better answer" description="Saved as a question and answer under Knowledge. The chatbot uses your answer word for word next time someone asks.">
    <template #body>
      <div class="space-y-4">
        <UFormField label="Question" required>
          <UInput v-model="form.title" maxlength="300" class="w-full" />
        </UFormField>
        <UFormField label="Answer" required hint="Write it the way you'd like it said">
          <UTextarea v-model="form.body" :rows="6" maxlength="4000" class="w-full" />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton variant="ghost" color="neutral" @click="open = false">Cancel</UButton>
        <UButton :loading="isRunning('save')" :disabled="!form.title.trim() || !form.body.trim()" @click="save">Add to Knowledge</UButton>
      </div>
    </template>
  </UModal>
</template>
