<script setup lang="ts">
// Event Details sidebar card for the `event` content type, extracted from
// content/[id].vue for consistency with its other already-extracted sidebar sections
// (PublishControls, SeoPanel, TermPicker, RevisionHistory, MediaPicker, TranslateModal).
const eventStartAt = defineModel<string>('eventStartAt', { required: true })
const eventEndAt = defineModel<string>('eventEndAt', { required: true })
const eventAllDay = defineModel<boolean>('eventAllDay', { required: true })
const eventLocation = defineModel<string>('eventLocation', { required: true })
const eventUrl = defineModel<string>('eventUrl', { required: true })
</script>

<template>
  <UCard class="text-sm">
    <p class="font-medium mb-3">Event Details</p>
    <div class="space-y-3">
      <UFormField label="Start Date & Time" class="text-xs">
        <UInput
          v-model="eventStartAt"
          type="datetime-local"
          class="text-sm"
        />
      </UFormField>
      <UFormField label="End Date & Time" class="text-xs">
        <UInput
          v-model="eventEndAt"
          type="datetime-local"
          class="text-sm"
        />
      </UFormField>
      <div class="flex items-center gap-2">
        <USwitch
          id="event-all-day"
          v-model="eventAllDay"
        />
        <label for="event-all-day" class="text-xs text-gray-500 dark:text-gray-400 select-none cursor-pointer">All Day Event</label>
      </div>
      <UFormField label="Location / Venue" class="text-xs">
        <UInput
          v-model="eventLocation"
          placeholder="e.g. Online, Paris Office..."
          class="text-sm"
        />
      </UFormField>
      <UFormField label="Event Link / Registration URL" class="text-xs">
        <UInput
          v-model="eventUrl"
          placeholder="https://..."
          class="text-sm"
        />
      </UFormField>
    </div>
  </UCard>
</template>
