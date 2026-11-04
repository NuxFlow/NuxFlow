<script setup lang="ts">
// "Add to this day" on Admin → Calendar: pick Event or Post, give it a title, and carry on
// in the full editor with the date filled in. Nothing is saved until the editor saves it.

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ day: string }>()

const type = ref<'event' | 'post'>('event')
const title = ref('')

const dayLabel = computed(() => (props.day
  ? new Date(`${props.day}T00:00:00.000Z`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  : ''))

watch(open, (isOpen) => {
  if (isOpen) title.value = ''
})

async function start() {
  if (!title.value.trim()) return
  await navigateTo({ path: '/admin/content/new', query: { type: type.value, date: props.day, title: title.value.trim() } })
}
</script>

<template>
  <UModal v-model:open="open" title="Add to the calendar" :description="dayLabel">
    <template #body>
      <form id="calendar-new-item" class="space-y-4" @submit.prevent="start">
        <div class="grid grid-cols-2 gap-2" role="radiogroup" aria-label="What to add">
          <UButton
            type="button"
            icon="i-lucide-calendar-check"
            :variant="type === 'event' ? 'solid' : 'outline'"
            :color="type === 'event' ? 'primary' : 'neutral'"
            class="justify-center"
            role="radio"
            :aria-checked="type === 'event'"
            @click="type = 'event'"
          >
            Event
          </UButton>
          <UButton
            type="button"
            icon="i-lucide-newspaper"
            :variant="type === 'post' ? 'solid' : 'outline'"
            :color="type === 'post' ? 'primary' : 'neutral'"
            class="justify-center"
            role="radio"
            :aria-checked="type === 'post'"
            @click="type = 'post'"
          >
            Post
          </UButton>
        </div>
        <UFormField label="Title" required>
          <UInput v-model="title" autofocus required maxlength="500" class="w-full" :placeholder="type === 'event' ? 'e.g. Summer open day' : 'e.g. Our summer news'" />
        </UFormField>
      </form>
    </template>
    <template #footer>
      <UButton variant="outline" color="neutral" @click="open = false">Cancel</UButton>
      <UButton type="submit" form="calendar-new-item" :disabled="!title.trim()">Continue</UButton>
    </template>
  </UModal>
</template>
