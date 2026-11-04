<script setup lang="ts">
// Event Details sidebar card for the `event` content type, extracted from
// content/[id].vue for consistency with its other already-extracted sidebar sections
// (PublishControls, SeoPanel, TermPicker, RevisionHistory, MediaPicker, TranslateModal).
const eventStartAt = defineModel<string>('eventStartAt', { required: true })
const eventEndAt = defineModel<string>('eventEndAt', { required: true })
const eventAllDay = defineModel<boolean>('eventAllDay', { required: true })
const eventLocation = defineModel<string>('eventLocation', { required: true })
const eventUrl = defineModel<string>('eventUrl', { required: true })
const eventRsvpEnabled = defineModel<boolean>('eventRsvpEnabled', { required: true })
const eventRsvpCapacity = defineModel<number | null>('eventRsvpCapacity', { required: true })
const eventRsvpClosesAt = defineModel<string>('eventRsvpClosesAt', { required: true })

defineProps<{
  /** The site's time zone, which the times here are in. */
  timeZone: string
  /** Absent until the event has been saved for the first time. */
  itemId?: string
  /** A translation shares its original's RSVP settings and list. */
  isTranslation?: boolean
}>()

// All-day events are plain dates; the time comes back at a sensible default when it's
// switched off again.
watch(eventAllDay, (allDay) => {
  if (allDay) {
    eventStartAt.value = eventStartAt.value.slice(0, 10)
    eventEndAt.value = eventEndAt.value.slice(0, 10)
  }
  else {
    if (eventStartAt.value.length === 10) eventStartAt.value = `${eventStartAt.value}T09:00`
    if (eventEndAt.value.length === 10) eventEndAt.value = `${eventEndAt.value}T17:00`
  }
})

const capacityText = computed({
  get: () => (eventRsvpCapacity.value == null ? '' : String(eventRsvpCapacity.value)),
  set: (value: string | number) => {
    const n = Number(value)
    eventRsvpCapacity.value = String(value).trim() === '' || !Number.isInteger(n) || n < 1 ? null : n
  },
})
</script>

<template>
  <UCard class="text-sm">
    <p class="font-medium mb-3">Event Details</p>
    <div class="space-y-3">
      <div class="flex items-center gap-2">
        <USwitch
          id="event-all-day"
          v-model="eventAllDay"
        />
        <label for="event-all-day" class="text-xs text-gray-500 dark:text-gray-400 select-none cursor-pointer">All Day Event</label>
      </div>
      <UFormField :label="eventAllDay ? 'First day' : 'Start Date & Time'" class="text-xs">
        <UInput
          v-model="eventStartAt"
          :type="eventAllDay ? 'date' : 'datetime-local'"
          class="text-sm"
        />
      </UFormField>
      <UFormField :label="eventAllDay ? 'Last day (optional)' : 'End Date & Time (optional)'" class="text-xs">
        <UInput
          v-model="eventEndAt"
          :type="eventAllDay ? 'date' : 'datetime-local'"
          :min="eventStartAt || undefined"
          class="text-sm"
        />
      </UFormField>
      <p v-if="!eventAllDay" class="text-xs text-gray-400">
        Times are in {{ timeZone }}, the site's time zone (Settings → General).
      </p>
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

      <div class="border-t border-gray-100 dark:border-gray-800 pt-3 space-y-3">
        <p v-if="isTranslation" class="text-xs text-gray-400">RSVPs are managed on the original event, and all languages share one list.</p>
        <div v-else class="flex items-center gap-2">
          <USwitch
            id="event-rsvp"
            v-model="eventRsvpEnabled"
          />
          <label for="event-rsvp" class="text-xs text-gray-500 dark:text-gray-400 select-none cursor-pointer">Let visitors RSVP on this page</label>
        </div>
        <template v-if="eventRsvpEnabled && !isTranslation">
          <UFormField label="Places available" hint="Blank for unlimited" class="text-xs">
            <UInput
              v-model="capacityText"
              type="number"
              min="1"
              placeholder="Unlimited"
              class="text-sm"
            />
          </UFormField>
          <UFormField label="RSVPs close (optional)" hint="Otherwise when it starts" class="text-xs">
            <UInput
              v-model="eventRsvpClosesAt"
              type="datetime-local"
              class="text-sm"
            />
          </UFormField>
          <p class="text-xs text-gray-400">When it's full, people join a waitlist and move up if someone cancels.</p>
        </template>
        <UButton
          v-if="itemId"
          :to="`/admin/events/${itemId}`"
          variant="outline"
          color="neutral"
          size="xs"
          icon="i-lucide-users"
        >
          View attendees
        </UButton>
      </div>
    </div>
  </UCard>
</template>
