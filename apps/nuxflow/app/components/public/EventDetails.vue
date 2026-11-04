<script lang="ts">
export interface PublicEventInfo {
  startAt: string
  endAt?: string | null
  allDay?: boolean | null
  location?: string | null
  url?: string | null
  timeZone?: string
  rsvp?: boolean
  icsUrl?: string | null
}
</script>

<script setup lang="ts">
import { formatEventWhen } from '@nuxflow/canvas/events'

// What an event page shows up top: when, where, and how to come. Time is in the site's own
// zone and labelled, so it reads the same as the invitation wherever the visitor is.
const props = defineProps<{
  event: PublicEventInfo
  /** The content item, for its RSVP list. */
  itemId: string
  locale?: string
}>()

const when = computed(() => formatEventWhen(
  { eventStartAt: props.event.startAt, eventEndAt: props.event.endAt, eventAllDay: props.event.allDay },
  props.event.timeZone || 'UTC',
  props.locale,
))
const link = computed(() => (props.event.url && /^https?:\/\//i.test(props.event.url) ? props.event.url : null))
</script>

<template>
  <section class="nuxflow-event-details rounded-2xl border border-gray-200 dark:border-gray-800 p-5 space-y-4" aria-label="Event details">
    <dl class="space-y-2 text-sm">
      <div class="flex items-start gap-2.5">
        <dt><UIcon name="i-lucide-calendar-days" class="w-4 h-4 mt-0.5 text-primary-500" /><span class="sr-only">When</span></dt>
        <!-- Formatted by the Worker and then the browser, whose date libraries can differ by a space. -->
        <dd class="font-medium text-gray-900 dark:text-white" data-allow-mismatch="text">{{ when }}</dd>
      </div>
      <div v-if="event.location" class="flex items-start gap-2.5">
        <dt><UIcon name="i-lucide-map-pin" class="w-4 h-4 mt-0.5 text-primary-500" /><span class="sr-only">Where</span></dt>
        <dd class="text-gray-700 dark:text-gray-300">{{ event.location }}</dd>
      </div>
    </dl>
    <div v-if="event.icsUrl || link" class="flex flex-wrap gap-2">
      <UButton v-if="event.icsUrl" :href="event.icsUrl" external variant="outline" color="neutral" size="sm" icon="i-lucide-calendar-plus">
        Add to calendar
      </UButton>
      <UButton v-if="link" :href="link" target="_blank" rel="noopener" external :variant="event.rsvp ? 'outline' : 'solid'" size="sm" icon="i-lucide-external-link">
        Register
      </UButton>
    </div>
    <PublicEventRsvp v-if="event.rsvp" :item-id="itemId" />
  </section>
</template>
