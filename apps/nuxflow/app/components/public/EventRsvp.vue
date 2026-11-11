<script setup lang="ts">
// The booking form on an event page. The page itself is cached whole, so whether places are
// left is fetched here in the browser, and nothing about a visitor is in the cached HTML.
// An event can ask for an intake form (a waiver, a health questionnaire), answered here
// before the booking goes through — server/utils/booking-intake.ts.
import FormFieldList from '~/components/forms/FormFieldList.vue'
import type { RenderableField } from '~/components/forms/FormFieldList.vue'
import { hiddenFieldNames, isFilled } from '#shared/lib/form-logic'

const props = defineProps<{ itemId: string }>()

type SlotState = 'open' | 'waitlist' | 'closed'

interface BookableDate {
  date: string
  when: string
  state: SlotState
  spotsLeft: number | null
  maxSeats: number
}

interface RsvpState {
  enabled: boolean
  state: SlotState
  spotsLeft: number | null
  maxSeats: number
  price: number | null
  currency: string | null
  canPayByCard: boolean
  canUsePass: boolean
  cancelHours: number | null
  /** A repeating event's next dates. Null for a one-off. */
  dates: BookableDate[] | null
  /** The questions to answer before booking, when the event asks for them. */
  intake: { name: string; fields: RenderableField[] } | null
}

type Answer = { status: 'pending' | 'confirmed' | 'waitlist' | 'checkout'; url?: string }

const { data: site } = useFetch<{ turnstileSiteKey?: string | null }>('/api/public/site', {
  key: 'nuxflow-public-site',
  headers: useRequestHeaders(['host']),
})

const route = useRoute()
const { user } = useUserSession()
const state = ref<RsvpState | null>(null)
const name = ref('')
const email = ref('')
const seats = ref(1)
const date = ref('')
const method = ref<'card' | 'pass'>('card')
// Honeypot — hidden from people and screen readers; see api/public/rsvp/[id].post.ts.
const website = ref('')
const turnstileToken = ref('')
const loading = ref(false)
const errorMessage = ref('')
const result = ref<'pending' | 'confirmed' | 'waitlist' | null>(null)
const uid = useId()

// ── Intake form ─────────────────────────────────────────────────────────────
const intakeValues = ref<Record<string, unknown>>({})
const intakeFields = computed(() => state.value?.intake?.fields ?? [])
const intakeHidden = computed(() => hiddenFieldNames(intakeFields.value, intakeValues.value))
const shownIntakeFields = computed(() => intakeFields.value.filter(f => !intakeHidden.value.has(f.name)))

function seedIntake(fields: RenderableField[]) {
  intakeValues.value = Object.fromEntries(fields.map(f => [f.name, f.type === 'checkbox' ? [] : f.type === 'hidden' ? f.placeholder ?? '' : '']))
}

/** The first shown required question left unanswered, by label. */
function missingIntake(): string | null {
  const field = shownIntakeFields.value.find(f => f.required && f.type !== 'step' && f.type !== 'computed' && !isFilled(intakeValues.value[f.name]))
  return field ? field.label || field.name : null
}

function intakeAnswers(): Record<string, unknown> | undefined {
  if (!state.value?.intake) return undefined
  return Object.fromEntries(shownIntakeFields.value.filter(f => f.type !== 'step').map(f => [f.name, intakeValues.value[f.name]]))
}

const rsvpUrl = computed<string>(() => `/api/public/rsvp/${props.itemId}`)

const dateOptions = computed(() => (state.value?.dates ?? []).map(d => ({
  label: d.state === 'waitlist' ? `${d.when} (full, join the waitlist)` : d.when,
  value: d.date,
})))
const selected = computed(() => state.value?.dates?.find(d => d.date === date.value) ?? null)

// The chosen date's state for a series, the event's own for a one-off.
const slotState = computed<SlotState>(() => selected.value?.state ?? state.value?.state ?? 'closed')
const spotsLeft = computed(() => (state.value?.dates ? selected.value?.spotsLeft ?? null : state.value?.spotsLeft ?? null))
const maxSeats = computed(() => selected.value?.maxSeats ?? state.value?.maxSeats ?? 1)
const seatOptions = computed(() => Array.from({ length: maxSeats.value }, (_, i) => ({ label: String(i + 1), value: i + 1 })))

const paid = computed(() => Boolean(state.value?.price))
const bookable = computed(() => state.value?.state !== 'closed' && (!state.value?.dates || state.value.dates.length > 0))
const total = computed(() => (state.value?.price ? state.value.price * seats.value : 0))

const methodOptions = computed(() => [
  ...(state.value?.canPayByCard ? [{ label: `Pay by card (${formatPrice(total.value, state.value.currency ?? 'USD')})`, value: 'card' as const }] : []),
  ...(state.value?.canUsePass ? [{ label: seats.value === 1 ? 'Use my class pass (1 session)' : `Use my class pass (${seats.value} sessions)`, value: 'pass' as const }] : []),
])

const buttonLabel = computed(() => {
  if (slotState.value === 'waitlist') return 'Join the waitlist'
  if (!paid.value) return 'Save my place'
  return method.value === 'pass' ? 'Email me a link to confirm' : `Pay ${formatPrice(total.value, state.value?.currency ?? 'USD')}`
})

const cancelNote = computed(() => {
  if (!paid.value) return ''
  const hours = state.value?.cancelHours
  if (!hours) return 'Cancel any time before it starts for a refund.'
  return hours % 24 === 0
    ? `Cancel at least ${hours / 24} ${hours === 24 ? 'day' : 'days'} before it starts for a refund.`
    : `Cancel at least ${hours} ${hours === 1 ? 'hour' : 'hours'} before it starts for a refund.`
})

onMounted(async () => {
  name.value = user.value?.name ?? ''
  email.value = user.value?.email ?? ''
  try {
    const loaded = await $fetch<RsvpState, string>(rsvpUrl.value)
    state.value = loaded
    seedIntake(loaded.intake?.fields ?? [])
    method.value = loaded.canPayByCard ? 'card' : 'pass'
    // A link from a timetable names its date; otherwise, the next one.
    const asked = typeof route.query.date === 'string' ? route.query.date : ''
    date.value = loaded.dates?.some(d => d.date === asked) ? asked : loaded.dates?.[0]?.date ?? ''
  }
  catch {
    // A booking form that can't load is left out; the rest of the event page is unaffected.
  }
})

// A date with fewer places can't keep a larger number asked for on another.
watch(maxSeats, (max) => {
  if (seats.value > max) seats.value = max
})

async function submit() {
  errorMessage.value = ''
  const missing = missingIntake()
  if (missing) {
    errorMessage.value = `Please answer "${missing}".`
    return
  }
  loading.value = true
  try {
    const answer = await $fetch<Answer, string>(rsvpUrl.value, {
      method: 'POST',
      body: {
        name: name.value,
        email: email.value,
        seats: seats.value,
        date: date.value || undefined,
        method: paid.value ? method.value : undefined,
        website: website.value || undefined,
        turnstileToken: turnstileToken.value || undefined,
        intake: intakeAnswers(),
      },
    })
    if (answer.status === 'checkout' && answer.url) {
      window.location.href = answer.url
      return
    }
    result.value = answer.status === 'checkout' ? 'pending' : answer.status
  }
  catch (e: unknown) {
    errorMessage.value = getErrorMessage(e, 'Something went wrong. Please try again.')
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div v-if="state?.enabled" class="nuxflow-event-rsvp border-t border-gray-100 dark:border-gray-800 pt-4">
    <div v-if="result" role="status" class="space-y-1">
      <template v-if="result === 'pending'">
        <p class="font-semibold">Check your inbox</p>
        <p class="text-sm opacity-80">We've sent a link to <strong>{{ email }}</strong>. Click it to confirm your place.</p>
      </template>
      <template v-else-if="result === 'confirmed'">
        <p class="font-semibold">You're on the list</p>
        <p class="text-sm opacity-80">See you there.</p>
      </template>
      <template v-else>
        <p class="font-semibold">You're on the waitlist</p>
        <p class="text-sm opacity-80">This event is full at the moment. You'll get a place if one opens up.</p>
      </template>
    </div>

    <p v-else-if="!bookable" class="text-sm text-gray-500 dark:text-gray-400">
      {{ paid ? 'Booking isn\'t open for this event at the moment.' : 'RSVPs for this event are closed.' }}
    </p>

    <form v-else class="space-y-3" @submit.prevent="submit">
      <div>
        <p class="font-semibold">{{ slotState === 'waitlist' ? 'Join the waitlist' : paid ? 'Book your place' : 'RSVP' }}</p>
        <p v-if="slotState === 'waitlist'" class="text-sm text-gray-500 dark:text-gray-400">
          {{ paid ? 'This date is full. If a place opens up, we\'ll keep it for you and email you a link to book.' : 'This event is full, but you\'ll get a place if one opens up.' }}
        </p>
        <p v-else-if="spotsLeft !== null" class="text-sm text-gray-500 dark:text-gray-400">{{ spotsLeft === 1 ? '1 place left' : `${spotsLeft} places left` }}</p>
      </div>
      <UFormField v-if="state.dates" label="Date" :name="`${uid}-date`" required>
        <USelect v-model="date" :items="dateOptions" class="w-full" />
      </UFormField>
      <div class="grid sm:grid-cols-2 gap-3">
        <UFormField label="Your name" :name="`${uid}-name`" required>
          <UInput v-model="name" required maxlength="100" autocomplete="name" class="w-full" />
        </UFormField>
        <UFormField label="Email" :name="`${uid}-email`" required>
          <UInput v-model="email" type="email" required maxlength="254" autocomplete="email" class="w-full" />
        </UFormField>
      </div>
      <UFormField v-if="maxSeats > 1" label="Places" :name="`${uid}-seats`">
        <USelect v-model="seats" :items="seatOptions" class="w-24" />
      </UFormField>
      <URadioGroup
        v-if="paid && slotState !== 'waitlist' && methodOptions.length > 1"
        v-model="method"
        :items="methodOptions"
        legend="How would you like to pay?"
      />
      <fieldset v-if="state.intake && shownIntakeFields.length" class="nuxflow-event-intake space-y-3 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
        <legend class="px-1 text-sm font-semibold">{{ state.intake.name }}</legend>
        <p class="text-xs opacity-70">Please fill this in before booking.</p>
        <FormFieldList :fields="shownIntakeFields" :values="intakeValues" @update="(fieldName, value) => { intakeValues[fieldName] = value }" />
      </fieldset>
      <div class="absolute -left-[9999px] w-px h-px overflow-hidden" aria-hidden="true">
        <label :for="`${uid}-website`">Website</label>
        <input :id="`${uid}-website`" v-model="website" type="text" name="website" tabindex="-1" autocomplete="off">
      </div>
      <NuxtTurnstile v-if="site?.turnstileSiteKey" v-model="turnstileToken" :site-key="site.turnstileSiteKey" />
      <p v-if="errorMessage" class="text-sm text-red-600 dark:text-red-400" role="alert">{{ errorMessage }}</p>
      <UButton type="submit" :loading="loading">{{ buttonLabel }}</UButton>
      <p v-if="cancelNote" class="text-xs opacity-70">{{ cancelNote }}</p>
      <p class="text-xs opacity-70">No account needed. Your name and email are shared with the organiser of this event.</p>
      <p v-if="paid" class="text-xs opacity-70">
        <NuxtLink v-if="state.canUsePass" to="/booking/passes" class="underline">Buy a class pass</NuxtLink>
        <template v-if="state.canUsePass"> · </template>
        <NuxtLink to="/booking/my" class="underline">My bookings and passes</NuxtLink>
      </p>
    </form>
  </div>
</template>
