<script setup lang="ts">
import type { SiteSettingsResponse } from '#shared/lib/site-settings-types'
import { BUSINESS_DAYS, BUSINESS_KINDS, dayName, emptyHours, parseBusinessInfo, type BusinessDay, type BusinessInfo, type HoursSlot } from '@nuxflow/canvas/business'

// Settings → Business: address, phone and opening hours, one JSON setting
// (`business.profile`). Saved on its own — a PATCH /api/v1/settings carrying only that key,
// checked by normalizeBusinessSetting() — never by the shared Settings save. Read by the
// Opening Hours block and the LocalBusiness data on every public page.

const KEY = 'business.profile'
// The Google Places API key is a separate, encrypted setting; GET shows it masked, and sending
// the mask back keeps it (settings.ts).
const PLACES_KEY = 'integrations.google_places_key'
const placesKey = ref('')

interface DayState { open: boolean; slots: HoursSlot[] }
interface ExceptionState { date: string; closed: boolean; slots: HoursSlot[]; note: string }

const { run, isRunning } = useAdminAction()
const { data, error, refresh } = await useFetch<SiteSettingsResponse>('/api/v1/settings')
const stored = computed(() => data.value ? parseBusinessInfo(data.value.settings[KEY]) ?? { kind: 'LocalBusiness', hours: emptyHours(), exceptions: [] } : null)

const details = reactive({
  kind: 'LocalBusiness', name: '', phone: '', email: '', street: '', locality: '', region: '', postcode: '', country: '',
  latitude: '', longitude: '', priceRange: '', hoursNote: '', googlePlaceId: '',
})
const days = reactive(Object.fromEntries(BUSINESS_DAYS.map(d => [d, { open: false, slots: [] as HoursSlot[] }])) as Record<BusinessDay, DayState>)
const exceptions = ref<ExceptionState[]>([])

function load(info: BusinessInfo) {
  Object.assign(details, {
    kind: info.kind, name: info.name ?? '', phone: info.phone ?? '', email: info.email ?? '', street: info.street ?? '',
    locality: info.locality ?? '', region: info.region ?? '', postcode: info.postcode ?? '', country: info.country ?? '',
    latitude: info.latitude != null ? String(info.latitude) : '', longitude: info.longitude != null ? String(info.longitude) : '', priceRange: info.priceRange ?? '', hoursNote: info.hoursNote ?? '', googlePlaceId: info.googlePlaceId ?? '',
  })
  for (const d of BUSINESS_DAYS) {
    const slots = info.hours[d] ?? []
    days[d] = { open: slots.length > 0, slots: slots.length ? slots.map(s => ({ ...s })) : [{ open: '09:00', close: '17:00' }] }
  }
  exceptions.value = info.exceptions.map(e => ({
    date: e.date, closed: e.slots.length === 0, note: e.note ?? '',
    slots: e.slots.length ? e.slots.map(s => ({ ...s })) : [{ open: '10:00', close: '14:00' }],
  }))
}
watch(stored, info => info && load(info), { immediate: true })
watch(() => data.value?.settings[PLACES_KEY], (v) => { placesKey.value = typeof v === 'string' ? v : '' }, { immediate: true })

const kindItems = BUSINESS_KINDS.map(k => ({ label: k.label, value: k.value }))

function addSlot(list: HoursSlot[]) {
  const last = list.at(-1)
  list.push(last ? { open: last.close, close: last.close } : { open: '09:00', close: '17:00' })
}

function copyToWeekdays(from: BusinessDay) {
  for (const d of ['mon', 'tue', 'wed', 'thu', 'fri'] as const) {
    if (d === from) continue
    days[d] = { open: days[from].open, slots: days[from].slots.map(s => ({ ...s })) }
  }
}

function addException() {
  const date = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  exceptions.value.push({ date, closed: true, note: '', slots: [{ open: '10:00', close: '14:00' }] })
}

function toNumber(v: string): number | null {
  if (!v.trim()) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

async function save() {
  const hours = emptyHours()
  for (const d of BUSINESS_DAYS) hours[d] = days[d].open ? days[d].slots.map(s => ({ ...s })) : []
  const body = {
    ...details,
    country: details.country.trim().toUpperCase(),
    latitude: toNumber(details.latitude),
    longitude: toNumber(details.longitude),
    hours,
    exceptions: exceptions.value
      .filter(e => e.date)
      .map(e => ({ date: e.date, slots: e.closed ? [] : e.slots.map(s => ({ ...s })), ...(e.note.trim() ? { note: e.note.trim() } : {}) })),
  }
  await run(async () => {
    await $fetch<unknown>('/api/v1/settings', { method: 'PATCH', body: { settings: { [KEY]: body, [PLACES_KEY]: placesKey.value.trim() } } })
    await refresh()
  }, { successTitle: 'Business details saved', errorTitle: 'Couldn\'t save the business details', key: 'save' })
}
</script>

<template>
  <div class="space-y-6">
    <p v-if="error" class="text-sm text-red-500">{{ getErrorMessage(error, 'Could not load the business details') }}</p>
    <UButton v-if="error" size="sm" variant="outline" @click="refresh()">Try again</UButton>

    <UCard>
      <template #header>
        <p class="text-sm font-semibold text-gray-900 dark:text-white">Business details</p>
        <p class="mt-1 text-xs text-gray-500">Used by the Opening Hours block and told to Google, so your address, phone and hours can show in search results and maps. Leave anything you don't want public empty.</p>
      </template>
      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField label="Type of business" class="sm:col-span-2">
          <USelect v-model="details.kind" :items="kindItems" class="w-full" />
        </UFormField>
        <UFormField label="Trading name" hint="If different from the site name">
          <UInput v-model="details.name" class="w-full" />
        </UFormField>
        <UFormField label="Phone">
          <UInput v-model="details.phone" type="tel" class="w-full" placeholder="01904 123456" />
        </UFormField>
        <UFormField label="Email">
          <UInput v-model="details.email" type="email" class="w-full" />
        </UFormField>
        <UFormField label="Price range" hint="Optional, e.g. ££">
          <UInput v-model="details.priceRange" class="w-full" />
        </UFormField>
        <UFormField label="Street address" class="sm:col-span-2">
          <UInput v-model="details.street" class="w-full" placeholder="10 High Street" />
        </UFormField>
        <UFormField label="Town or city">
          <UInput v-model="details.locality" class="w-full" />
        </UFormField>
        <UFormField label="County, state or region">
          <UInput v-model="details.region" class="w-full" />
        </UFormField>
        <UFormField label="Postcode">
          <UInput v-model="details.postcode" class="w-full" />
        </UFormField>
        <UFormField label="Country code" hint="Two letters, e.g. GB">
          <UInput v-model="details.country" maxlength="2" class="w-full" />
        </UFormField>
        <UFormField label="Latitude" hint="Optional, for an exact map pin">
          <UInput v-model="details.latitude" type="number" step="0.00001" class="w-full" />
        </UFormField>
        <UFormField label="Longitude">
          <UInput v-model="details.longitude" type="number" step="0.00001" class="w-full" />
        </UFormField>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <p class="text-sm font-semibold text-gray-900 dark:text-white">Opening hours</p>
        <p class="mt-1 text-xs text-gray-500">In your site's time zone. For hours past midnight, set the closing time earlier than the opening time (18:00 – 02:00). Add a second set of hours for a break in the day.</p>
      </template>
      <div class="divide-y divide-gray-100 dark:divide-gray-800">
        <div v-for="d in BUSINESS_DAYS" :key="d" class="flex flex-wrap items-start gap-3 py-3">
          <div class="flex w-40 items-center gap-2 pt-1.5">
            <USwitch v-model="days[d].open" :aria-label="`Open on ${dayName(d)}`" />
            <span class="text-sm font-medium">{{ dayName(d) }}</span>
          </div>
          <div v-if="days[d].open" class="flex-1 space-y-2">
            <div v-for="(slot, i) in days[d].slots" :key="i" class="flex items-center gap-2">
              <UInput v-model="slot.open" type="time" size="sm" :aria-label="`${dayName(d)} opens`" />
              <span class="text-gray-400">–</span>
              <UInput v-model="slot.close" type="time" size="sm" :aria-label="`${dayName(d)} closes`" />
              <UButton v-if="days[d].slots.length > 1" size="xs" variant="ghost" color="neutral" icon="i-lucide-x" :aria-label="`Remove these ${dayName(d)} hours`" @click="days[d].slots.splice(i, 1)" />
            </div>
            <div class="flex gap-2">
              <UButton v-if="days[d].slots.length < 4" size="xs" variant="ghost" icon="i-lucide-plus" @click="addSlot(days[d].slots)">Add hours</UButton>
              <UButton v-if="d === 'mon'" size="xs" variant="ghost" icon="i-lucide-copy" @click="copyToWeekdays('mon')">Copy to Tuesday–Friday</UButton>
            </div>
          </div>
          <span v-else class="pt-1.5 text-sm text-gray-400">Closed</span>
        </div>
      </div>
      <UFormField label="Note under the hours" class="mt-4" hint="Optional">
        <UInput v-model="details.hoursNote" class="w-full" placeholder="Kitchen closes 30 minutes before we do." />
      </UFormField>
    </UCard>

    <UCard>
      <template #header>
        <p class="text-sm font-semibold text-gray-900 dark:text-white">Google reviews</p>
        <p class="mt-1 text-xs text-gray-500">For the Google Reviews block: your star rating and recent reviews, straight from Google. You need your business's Place ID and an API key from your own Google Cloud account (each look-up is billed to it; NuxFlow asks at most once an hour).</p>
      </template>
      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField label="Google Place ID" hint="Starts ChIJ…">
          <UInput v-model="details.googlePlaceId" class="w-full" placeholder="ChIJ…" />
        </UFormField>
        <UFormField label="Google Places API key" hint="Kept encrypted">
          <UInput v-model="placesKey" type="password" autocomplete="off" class="w-full" />
        </UFormField>
      </div>
      <p class="mt-3 text-xs text-gray-500">
        Find your Place ID with Google's
        <a href="https://developers.google.com/maps/documentation/places/web-service/place-id" target="_blank" rel="noopener" class="underline">Place ID finder</a>.
        Create the key in Google Cloud with the "Places API (New)" switched on, and restrict it to that API.
      </p>
    </UCard>

    <UCard>
      <template #header>
        <p class="text-sm font-semibold text-gray-900 dark:text-white">Holiday and special hours</p>
        <p class="mt-1 text-xs text-gray-500">Days that differ from the usual week, such as bank holidays. Past dates stop showing on their own.</p>
      </template>
      <div class="space-y-3">
        <div v-for="(e, i) in exceptions" :key="i" class="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-800 p-3">
          <UInput v-model="e.date" type="date" size="sm" aria-label="Date" />
          <div class="flex items-center gap-2">
            <USwitch v-model="e.closed" :aria-label="`Closed on ${e.date}`" />
            <span class="text-sm">Closed all day</span>
          </div>
          <template v-if="!e.closed">
            <div v-for="(slot, j) in e.slots" :key="j" class="flex items-center gap-2">
              <UInput v-model="slot.open" type="time" size="sm" aria-label="Opens" />
              <span class="text-gray-400">–</span>
              <UInput v-model="slot.close" type="time" size="sm" aria-label="Closes" />
            </div>
          </template>
          <UInput v-model="e.note" size="sm" placeholder="Note, e.g. Christmas Day" class="min-w-48 flex-1" aria-label="Note" />
          <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" aria-label="Remove this day" @click="exceptions.splice(i, 1)" />
        </div>
        <UButton size="sm" variant="outline" icon="i-lucide-plus" @click="addException">Add a day</UButton>
      </div>
    </UCard>

    <div class="flex justify-end">
      <UButton :loading="isRunning('save')" @click="save">Save business details</UButton>
    </div>
  </div>
</template>
