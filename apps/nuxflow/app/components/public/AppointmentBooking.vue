<script setup lang="ts">
import type { PublicSite } from '#shared/lib/public-site-types'
// The Appointment block's picker and form (CanvasHost.appointmentBooking). The page is cached
// whole, so free times are fetched here, in the browser. Reads and posts
// /_nuxflow/appointments (not /api; see that route). The page's intake form, when it has one,
// is answered here before the booking goes through — server/utils/booking-intake.ts.
import FormFieldList from '~/components/forms/FormFieldList.vue'
import type { RenderableField } from '~/components/forms/FormFieldList.vue'
import { hiddenFieldNames, isFilled } from '#shared/lib/form-logic'

const props = defineProps<{ block: string; askPhone?: boolean }>()

interface Day { date: string; times: Array<{ start: string; time: string }> }
interface Free {
  service: { name: string; duration: number; durationText: string; price: number | null; currency: string; cancelHours: number; canPayByCard: boolean }
  timeZone: string
  days: Day[]
  previous: string | null
  next: string | null
  intake: { name: string; fields: RenderableField[] } | null
}
type Answer = { status: 'pending' | 'confirmed' | 'checkout'; url?: string }

const { data: site } = useFetch<PublicSite>('/api/public/site', {
  key: 'nuxflow-public-site',
  headers: useRequestHeaders(['host']),
})
const { user } = useUserSession()
const uid = useId()

const free = ref<Free | null>(null)
const failedToLoad = ref(false)
const loadingTimes = ref(false)
const day = ref('')
const start = ref('')
const name = ref('')
const email = ref('')
const phone = ref('')
const note = ref('')
const website = ref('')
const turnstileToken = ref('')
const sending = ref(false)
const errorMessage = ref('')
const result = ref<'pending' | 'confirmed' | null>(null)

const path = () => window.location.pathname.replace(/^\/+|\/+$/g, '')

async function load(from?: string) {
  loadingTimes.value = true
  try {
    const loaded = await $fetch<Free>('/_nuxflow/appointments', { query: { path: path(), block: props.block, from } })
    const firstLoad = !free.value
    free.value = loaded
    if (firstLoad) seedIntake(loaded.intake?.fields ?? [])
    day.value = loaded.days.find(d => d.times.length)?.date ?? ''
    start.value = ''
  }
  catch {
    failedToLoad.value = true
  }
  finally {
    loadingTimes.value = false
  }
}

onMounted(() => {
  name.value = user.value?.name ?? ''
  email.value = user.value?.email ?? ''
  load()
})

const chosenDay = computed(() => free.value?.days.find(d => d.date === day.value) ?? null)
const chosenTime = computed(() => chosenDay.value?.times.find(t => t.start === start.value) ?? null)
const anyTimes = computed(() => free.value?.days.some(d => d.times.length) ?? false)
const paid = computed(() => Boolean(free.value?.service.price))

function dayLabel(date: string, part: 'weekday' | 'day' | 'month') {
  const d = new Date(`${date}T12:00:00Z`)
  if (part === 'weekday') return d.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })
  if (part === 'month') return d.toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' })
  return String(d.getUTCDate())
}
function longDay(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
}

const priceText = computed(() => (free.value?.service.price ? formatPrice(free.value.service.price, free.value.service.currency) : 'Free'))
const cancelNote = computed(() => {
  const s = free.value?.service
  if (!s?.price) return ''
  if (!s.cancelHours) return 'Cancel any time before it starts for a refund.'
  return s.cancelHours % 24 === 0
    ? `Cancel at least ${s.cancelHours / 24} ${s.cancelHours === 24 ? 'day' : 'days'} before for a refund.`
    : `Cancel at least ${s.cancelHours} ${s.cancelHours === 1 ? 'hour' : 'hours'} before for a refund.`
})

// ── Intake form ─────────────────────────────────────────────────────────────
const intakeValues = ref<Record<string, unknown>>({})
const intakeFields = computed(() => free.value?.intake?.fields ?? [])
const intakeHidden = computed(() => hiddenFieldNames(intakeFields.value, intakeValues.value))
const shownIntakeFields = computed(() => intakeFields.value.filter(f => !intakeHidden.value.has(f.name)))
function seedIntake(fields: RenderableField[]) {
  intakeValues.value = Object.fromEntries(fields.map(f => [f.name, f.type === 'checkbox' ? [] : f.type === 'hidden' ? f.placeholder ?? '' : '']))
}
function missingIntake(): string | null {
  const field = shownIntakeFields.value.find(f => f.required && f.type !== 'step' && f.type !== 'computed' && !isFilled(intakeValues.value[f.name]))
  return field ? field.label || field.name : null
}
function intakeAnswers(): Record<string, unknown> | undefined {
  if (!free.value?.intake) return undefined
  return Object.fromEntries(shownIntakeFields.value.filter(f => f.type !== 'step').map(f => [f.name, intakeValues.value[f.name]]))
}

async function submit() {
  errorMessage.value = ''
  if (!start.value) {
    errorMessage.value = 'Please choose a time.'
    return
  }
  const missing = missingIntake()
  if (missing) {
    errorMessage.value = `Please answer "${missing}".`
    return
  }
  sending.value = true
  try {
    const answer = await $fetch<Answer>('/_nuxflow/appointments', {
      method: 'POST',
      body: {
        action: 'book',
        path: path(),
        block: props.block,
        start: start.value,
        name: name.value,
        email: email.value,
        phone: phone.value || undefined,
        note: note.value || undefined,
        website: website.value || undefined,
        turnstileToken: turnstileToken.value || undefined,
        intake: intakeAnswers(),
      },
    })
    if (answer.status === 'checkout' && answer.url) {
      window.location.href = answer.url
      return
    }
    result.value = answer.status === 'confirmed' ? 'confirmed' : 'pending'
  }
  catch (e: unknown) {
    errorMessage.value = getErrorMessage(e, 'Something went wrong. Please try again.')
    // Someone else may have taken it: show what's free now.
    if (/taken/i.test(errorMessage.value)) await load(free.value?.days[0]?.date)
  }
  finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="nuxflow-appointment space-y-5">
    <p v-if="failedToLoad" class="text-center text-sm opacity-70">Booking isn't available at the moment. Please get in touch instead.</p>

    <template v-else-if="free">
      <p class="text-center text-sm opacity-80">
        <span class="font-semibold">{{ free.service.name }}</span> · {{ free.service.durationText }} · {{ priceText }}
      </p>

      <div v-if="result" role="status" class="rounded-xl border border-current/15 p-5 text-center space-y-1">
        <template v-if="result === 'pending'">
          <p class="font-semibold">Check your inbox</p>
          <p class="text-sm opacity-80">We've sent a link to <strong>{{ email }}</strong>. Click it within the hour to confirm your appointment.</p>
        </template>
        <template v-else>
          <p class="font-semibold">You're booked</p>
          <p class="text-sm opacity-80">{{ chosenDay ? longDay(chosenDay.date) : '' }}<template v-if="chosenTime">, {{ chosenTime.time }}</template></p>
        </template>
      </div>

      <template v-else>
        <div>
          <div class="mb-2 flex items-center justify-between gap-2">
            <p :id="`${uid}-days`" class="font-semibold">Choose a day</p>
            <div class="flex gap-1">
              <UButton size="xs" variant="ghost" icon="i-lucide-chevron-left" :disabled="!free.previous || loadingTimes" aria-label="Earlier days" @click="load(free.previous ?? undefined)" />
              <UButton size="xs" variant="ghost" icon="i-lucide-chevron-right" :disabled="!free.next || loadingTimes" aria-label="Later days" @click="load(free.next ?? undefined)" />
            </div>
          </div>
          <div class="canvas-appointment-days flex gap-2 overflow-x-auto pb-1" role="group" :aria-labelledby="`${uid}-days`">
            <button
              v-for="d in free.days"
              :key="d.date"
              type="button"
              class="canvas-appointment-day flex min-w-14 flex-col items-center rounded-lg border px-2 py-1.5 text-xs disabled:opacity-35"
              :class="day === d.date ? 'border-primary-500 bg-primary-500 text-white' : 'border-current/20'"
              :disabled="!d.times.length"
              :data-date="d.date"
              :aria-pressed="day === d.date"
              :aria-label="`${longDay(d.date)}${d.times.length ? '' : ', no free times'}`"
              @click="day = d.date; start = ''"
            >
              <span>{{ dayLabel(d.date, 'weekday') }}</span>
              <span class="text-base font-semibold">{{ dayLabel(d.date, 'day') }}</span>
              <span>{{ dayLabel(d.date, 'month') }}</span>
            </button>
          </div>
          <p v-if="!anyTimes" class="mt-2 text-sm opacity-70">No free times in these days.{{ free.next ? ' Try later days.' : '' }}</p>
        </div>

        <div v-if="chosenDay?.times.length">
          <p :id="`${uid}-times`" class="mb-2 font-semibold">Choose a time <span class="font-normal text-sm opacity-70">({{ longDay(chosenDay.date) }})</span></p>
          <div class="canvas-appointment-times grid grid-cols-3 gap-2 sm:grid-cols-5" role="group" :aria-labelledby="`${uid}-times`">
            <button
              v-for="t in chosenDay.times"
              :key="t.start"
              type="button"
              class="canvas-appointment-time rounded-lg border px-2 py-2 text-sm"
              :class="start === t.start ? 'border-primary-500 bg-primary-500 text-white' : 'border-current/20 hover:border-current/50'"
              :aria-pressed="start === t.start"
              @click="start = t.start"
            >{{ t.time }}</button>
          </div>
        </div>

        <form v-if="chosenTime" class="canvas-appointment-form space-y-3" @submit.prevent="submit">
          <p class="font-semibold">Your details</p>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField label="Your name" :name="`${uid}-name`" required>
              <UInput v-model="name" required maxlength="100" autocomplete="name" class="w-full" />
            </UFormField>
            <UFormField label="Email" :name="`${uid}-email`" required>
              <UInput v-model="email" type="email" required maxlength="254" autocomplete="email" class="w-full" />
            </UFormField>
            <UFormField v-if="askPhone" label="Phone" :name="`${uid}-phone`" hint="Optional">
              <UInput v-model="phone" type="tel" maxlength="40" autocomplete="tel" class="w-full" />
            </UFormField>
          </div>
          <UFormField label="Anything we should know?" :name="`${uid}-note`" hint="Optional">
            <UTextarea v-model="note" :rows="2" maxlength="1000" class="w-full" />
          </UFormField>
          <fieldset v-if="free.intake && shownIntakeFields.length" class="space-y-3 rounded-lg border border-current/15 p-3">
            <legend class="px-1 text-sm font-semibold">{{ free.intake.name }}</legend>
            <p class="text-xs opacity-70">Please fill this in before booking.</p>
            <FormFieldList :fields="shownIntakeFields" :values="intakeValues" @update="(fieldName, value) => { intakeValues[fieldName] = value }" />
          </fieldset>
          <div class="absolute -left-[9999px] w-px h-px overflow-hidden" aria-hidden="true">
            <label :for="`${uid}-website`">Website</label>
            <input :id="`${uid}-website`" v-model="website" type="text" name="website" tabindex="-1" autocomplete="off">
          </div>
          <NuxtTurnstile v-if="site?.turnstileSiteKey" v-model="turnstileToken" :site-key="site.turnstileSiteKey" />
          <p v-if="paid && !free.service.canPayByCard" class="text-sm text-amber-700 dark:text-amber-400">Online payment isn't available right now, so this can't be booked here.</p>
          <p v-if="errorMessage" class="text-sm text-red-600 dark:text-red-400" role="alert">{{ errorMessage }}</p>
          <UButton type="submit" :loading="sending" :disabled="paid && !free.service.canPayByCard">
            {{ paid ? `Pay ${priceText} and book ${chosenTime.time}` : `Book ${chosenTime.time}` }}
          </UButton>
          <p v-if="cancelNote" class="text-xs opacity-70">{{ cancelNote }}</p>
          <p class="text-xs opacity-70">
            No account needed. Times are shown in the business's time zone ({{ free.timeZone }}).
            <NuxtLink to="/booking/my" class="underline">My bookings</NuxtLink>
          </p>
        </form>
      </template>
    </template>
  </div>
</template>
