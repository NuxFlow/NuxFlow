<script setup lang="ts">
// Event Details sidebar card for the `event` content type, extracted from
// content/[id].vue for consistency with its other already-extracted sidebar sections
// (PublishControls, SeoPanel, TermPicker, RevisionHistory, MediaPicker, TranslateModal).
import { describeRecurrence, type EventRecurrence } from '@nuxflow/canvas/events'

const eventStartAt = defineModel<string>('eventStartAt', { required: true })
const eventEndAt = defineModel<string>('eventEndAt', { required: true })
const eventAllDay = defineModel<boolean>('eventAllDay', { required: true })
const eventLocation = defineModel<string>('eventLocation', { required: true })
const eventUrl = defineModel<string>('eventUrl', { required: true })
const eventRsvpEnabled = defineModel<boolean>('eventRsvpEnabled', { required: true })
const eventRsvpCapacity = defineModel<number | null>('eventRsvpCapacity', { required: true })
const eventRsvpClosesAt = defineModel<string>('eventRsvpClosesAt', { required: true })
const eventRecurrence = defineModel<EventRecurrence | null>('eventRecurrence', { required: true })
const eventPrice = defineModel<number | null>('eventPrice', { required: true })
const eventCurrency = defineModel<string>('eventCurrency', { required: true })
const eventCancelHours = defineModel<number | null>('eventCancelHours', { required: true })
const eventPassesAllowed = defineModel<boolean>('eventPassesAllowed', { required: true })
// A Form Builder form people fill in before their booking goes through (a waiver, a health
// questionnaire) — server/utils/booking-intake.ts. Kept in the item's settings.
const intakeFormId = defineModel<string>('intakeFormId', { required: true })

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

// ── Intake form ─────────────────────────────────────────────────────────────
// Listing forms needs the editor role; an author sees the choice already made, if any.
const NO_FORM = 'none'
// The select can't hold an empty value, so "none" stands in for no form.
const intakeChoice = computed({
  get: () => intakeFormId.value || NO_FORM,
  set: (v: string) => { intakeFormId.value = v === NO_FORM ? '' : v },
})
const formOptions = ref<Array<{ label: string; value: string }>>([])
onMounted(async () => {
  try {
    const res = await $fetch<{ forms: Array<{ id: string; name: string; status: string }> }>('/api/v1/forms')
    formOptions.value = [
      { label: 'None', value: NO_FORM },
      ...res.forms.filter(f => f.status === 'active').map(f => ({ label: f.name, value: f.id })),
    ]
  }
  catch {
    formOptions.value = []
  }
})

// ── Repeating ─────────────────────────────────────────────────────────────

const WEEKDAYS = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' }, { value: 0, label: 'Sun' },
]
const REPEAT_OPTIONS = [
  { label: 'Does not repeat', value: 'none' },
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Monthly', value: 'monthly' },
]
const UNITS = { daily: 'days', weekly: 'weeks', monthly: 'months' } as const

const startWeekday = () => {
  const day = eventStartAt.value.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T00:00:00.000Z`).getUTCDay() : 1
}

const repeat = computed({
  get: () => eventRecurrence.value?.freq ?? 'none',
  set: (value: string) => {
    if (value === 'none') {
      eventRecurrence.value = null
      return
    }
    const freq = value as EventRecurrence['freq']
    eventRecurrence.value = {
      ...eventRecurrence.value,
      freq,
      interval: eventRecurrence.value?.interval ?? 1,
      weekdays: freq === 'weekly' ? (eventRecurrence.value?.weekdays?.length ? eventRecurrence.value.weekdays : [startWeekday()]) : undefined,
    }
  },
})

function setRule(patch: Partial<EventRecurrence>) {
  if (eventRecurrence.value) eventRecurrence.value = { ...eventRecurrence.value, ...patch }
}

function toggleWeekday(day: number) {
  const current = eventRecurrence.value?.weekdays ?? []
  const next = current.includes(day) ? current.filter(d => d !== day) : [...current, day]
  // A weekly rule with no days means nothing, so the last one stays.
  if (next.length) setRule({ weekdays: next })
}

const untilText = computed({
  get: () => eventRecurrence.value?.until ?? '',
  set: (value: string) => setRule({ until: value || null }),
})

const intervalText = computed({
  get: () => String(eventRecurrence.value?.interval ?? 1),
  set: (value: string | number) => {
    const n = Number(value)
    setRule({ interval: Number.isInteger(n) && n >= 1 && n <= 52 ? n : 1 })
  },
})

const skippedText = computed(() => (eventRecurrence.value?.skip ?? []).join(', '))
const summary = computed(() => (eventRecurrence.value ? describeRecurrence(eventRecurrence.value) : ''))

// ── Paid places ───────────────────────────────────────────────────────────

const priceText = computed({
  get: () => (eventPrice.value == null ? '' : String(eventPrice.value)),
  set: (value: string | number) => {
    const n = Number(value)
    eventPrice.value = String(value).trim() === '' || !Number.isFinite(n) || n < 0 ? null : n
  },
})

const cancelHoursText = computed({
  get: () => (eventCancelHours.value == null ? '' : String(eventCancelHours.value)),
  set: (value: string | number) => {
    const n = Number(value)
    eventCancelHours.value = String(value).trim() === '' || !Number.isInteger(n) || n < 0 ? null : n
  },
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
      <div v-if="!isTranslation" class="space-y-2">
        <UFormField label="Repeat" class="text-xs">
          <USelect v-model="repeat" :items="REPEAT_OPTIONS" class="w-full text-sm" />
        </UFormField>
        <template v-if="eventRecurrence">
          <UFormField :label="`Every how many ${UNITS[eventRecurrence.freq]}`" class="text-xs">
            <UInput v-model="intervalText" type="number" min="1" max="52" class="w-20 text-sm" />
          </UFormField>
          <div v-if="eventRecurrence.freq === 'weekly'" class="flex flex-wrap gap-1" role="group" aria-label="Days of the week">
            <UButton
              v-for="day in WEEKDAYS"
              :key="day.value"
              size="xs"
              :variant="eventRecurrence.weekdays?.includes(day.value) ? 'solid' : 'outline'"
              :color="eventRecurrence.weekdays?.includes(day.value) ? 'primary' : 'neutral'"
              :aria-pressed="eventRecurrence.weekdays?.includes(day.value)"
              @click="toggleWeekday(day.value)"
            >
              {{ day.label }}
            </UButton>
          </div>
          <UFormField label="Last date (optional)" class="text-xs">
            <UInput v-model="untilText" type="date" class="text-sm" />
          </UFormField>
          <p class="text-xs text-gray-400">{{ summary }}, starting from the date above. Each date has its own places and its own list.</p>
          <p v-if="skippedText" class="text-xs text-gray-400">Cancelled dates: {{ skippedText }}</p>
        </template>
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
          <UFormField v-if="!eventRecurrence" label="RSVPs close (optional)" hint="Otherwise when it starts" class="text-xs">
            <UInput
              v-model="eventRsvpClosesAt"
              type="datetime-local"
              class="text-sm"
            />
          </UFormField>
          <p class="text-xs text-gray-400">When it's full, people join a waitlist and move up if someone cancels.</p>
          <UFormField
            v-if="formOptions.length > 1"
            label="Form to fill in when booking"
            hint="Optional"
            description="A waiver or questionnaire people must answer before their booking goes through. Answers go to that form's Submissions."
            class="text-xs"
          >
            <USelect v-model="intakeChoice" :items="formOptions" class="w-full text-sm" />
          </UFormField>
          <div class="grid grid-cols-[1fr_5rem] gap-2">
            <UFormField label="Price per place" hint="Blank for free" class="text-xs">
              <UInput v-model="priceText" type="number" min="0" step="0.01" placeholder="Free" class="text-sm" />
            </UFormField>
            <UFormField label="Currency" class="text-xs">
              <UInput v-model="eventCurrency" maxlength="3" class="text-sm uppercase" />
            </UFormField>
          </div>
          <template v-if="eventPrice">
            <UFormField label="Refund if cancelled this many hours before" hint="Blank: any time before it starts" class="text-xs">
              <UInput v-model="cancelHoursText" type="number" min="0" placeholder="Until it starts" class="text-sm" />
            </UFormField>
            <div class="flex items-center gap-2">
              <USwitch id="event-passes" v-model="eventPassesAllowed" />
              <label for="event-passes" class="text-xs text-gray-500 dark:text-gray-400 select-none cursor-pointer">Can be booked with a class pass</label>
            </div>
            <p class="text-xs text-gray-400">Card payments go through Stripe (Settings → Payments). Cancelling someone's place yourself always refunds them.</p>
          </template>
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
