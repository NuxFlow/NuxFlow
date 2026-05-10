<script setup lang="ts">
defineProps<{
  modelValue: { status: string; scheduledAt?: string }
  saving?: boolean
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

      <template v-if="modelValue.status === 'scheduled'">
        <UFormField label="Schedule for">
          <UInput
            type="datetime-local"
            :model-value="modelValue.scheduledAt"
            @update:model-value="(val) => $emit('update:modelValue', { ...modelValue, scheduledAt: val as string | undefined })"
          />
        </UFormField>
        <UAlert
          color="yellow"
          variant="soft"
          icon="i-lucide-clock"
          description="Scheduled publishing requires a cron trigger, which is not available on Cloudflare Workers' free tier. Upgrade to the paid Workers plan ($5/mo) to enable it."
          :ui="{ description: 'text-xs' }"
        />
      </template>

      <div class="flex gap-2">
        <UButton variant="outline" class="flex-1" :loading="saving" @click="$emit('save')">Save draft</UButton>
        <UButton class="flex-1" :loading="saving" @click="$emit('publish')">
          {{ modelValue.status === 'scheduled' ? 'Schedule' : 'Publish' }}
        </UButton>
      </div>
    </div>
  </UCard>
</template>
