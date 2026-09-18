<script setup lang="ts">
const props = defineProps<{
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  color?: 'error' | 'primary' | 'warning'
}>()

const emit = defineEmits<{ close: [boolean] }>()

const open = ref(true)
let resolved = false

// Guards against resolving twice — a button click resolves immediately, then also flips
// `open` to false, which would otherwise trigger onUpdateOpen's own resolve(false) a second
// time. Dismissing via Escape/backdrop click only ever goes through onUpdateOpen, so it
// still resolves exactly once, as a cancel.
function resolve(value: boolean) {
  if (resolved) return
  resolved = true
  emit('close', value)
}

function onUpdateOpen(value: boolean) {
  open.value = value
  if (!value) resolve(false)
}

function onCancel() {
  resolve(false)
  open.value = false
}

function onConfirm() {
  resolve(true)
  open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="props.title" @update:open="onUpdateOpen">
    <template #body>
      <p v-if="props.description" class="text-sm text-gray-600 dark:text-gray-300">{{ props.description }}</p>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton variant="ghost" color="neutral" @click="onCancel">
          {{ props.cancelLabel ?? 'Cancel' }}
        </UButton>
        <UButton :color="props.color ?? 'error'" @click="onConfirm">
          {{ props.confirmLabel ?? 'Confirm' }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
