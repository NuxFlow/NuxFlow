<script setup lang="ts">
const props = defineProps<{
  modelValue: { status: string; scheduledAt?: string }
  saving?: boolean
  /** The site's time zone, which the date here is in. */
  timeZone?: string
}>()
defineEmits<{
  'update:modelValue': [value: { status: string; scheduledAt?: string }]
  save: []
  publish: []
}>()

const statusOptions = [
  { label: 'Draft', value: 'draft' },
  { label: 'Review', value: 'review' },
  { label: 'Published', value: 'published' },
  { label: 'Scheduled', value: 'scheduled' },
  { label: 'Archived', value: 'archived' },
]

// Drafts can carry a planned date too: it places them on the calendar, and nothing is
// published until the status is Scheduled.
const showsDate = computed(() => ['draft', 'review', 'scheduled'].includes(props.modelValue.status))
</script>

<template>
  <UCard>
    <template #header>
      <p class="text-sm font-semibold">Publish</p>
    </template>
    <div class="space-y-3">
      <UFormField label="Status">
        <USelect
          :model-value="modelValue.status"
          :items="statusOptions"
          @update:model-value="(val) => $emit('update:modelValue', { ...modelValue, status: val as string })"
        />
      </UFormField>

      <UFormField
        v-if="showsDate"
        :label="modelValue.status === 'scheduled' ? 'Publish on' : 'Planned date (optional)'"
        :help="timeZone ? `Time zone: ${timeZone}` : undefined"
      >
        <UInput
          type="datetime-local"
          :model-value="modelValue.scheduledAt"
          @update:model-value="(val) => $emit('update:modelValue', { ...modelValue, scheduledAt: (val as string) || undefined })"
        />
      </UFormField>

      <div class="flex gap-2">
        <UButton variant="outline" class="flex-1" :loading="saving" @click="$emit('save')">
          {{ modelValue.status === 'draft' ? 'Save draft' : 'Save' }}
        </UButton>
        <UButton class="flex-1" :loading="saving" @click="$emit('publish')">
          {{ modelValue.status === 'scheduled' ? 'Schedule' : 'Publish' }}
        </UButton>
      </div>
    </div>
  </UCard>
</template>
