<script setup lang="ts">
import type { SiteSettingsResponse } from '#shared/lib/site-settings-types'
import { WEEKDAYS, emptyWeek, parseAppointmentSettings, type DayOff, type TimeRange, type Weekday } from '#shared/lib/appointments'

// Settings → Appointments: when one-to-one appointments can be booked (Appointment block,
// server/utils/appointments.ts). One JSON setting, `appointments.settings`, saved on its own —
// a PATCH /api/v1/settings carrying only that key, checked by normalizeAppointmentSetting() —
// never by the shared Settings save.

const KEY = 'appointments.settings'
const DAY_NAMES: Record<Weekday, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }

interface DayState { open: boolean; slots: TimeRange[] }

const { run, isRunning } = useAdminAction()
const { data, error, refresh } = await useFetch<SiteSettingsResponse>('/api/v1/settings')

const useOpeningHours = ref(true)
const days = reactive(Object.fromEntries(WEEKDAYS.map(d => [d, { open: false, slots: [] as TimeRange[] }])) as Record<Weekday, DayState>)
const daysOff = ref<Array<Required<DayOff>>>([])

watch(() => data.value?.settings[KEY], (value) => {
  const s = parseAppointmentSettings(value)
  useOpeningHours.value = s.useOpeningHours
  for (const d of WEEKDAYS) {
    const slots = s.hours[d]
    days[d] = { open: slots.length > 0, slots: slots.length ? slots.map(r => ({ ...r })) : [{ open: '09:00', close: '17:00' }] }
  }
  daysOff.value = s.daysOff.map(d => ({ from: d.from, to: d.to, note: d.note ?? '' }))
}, { immediate: true })

function copyToWeekdays() {
  for (const d of ['tue', 'wed', 'thu', 'fri'] as const) days[d] = { open: days.mon.open, slots: days.mon.slots.map(r => ({ ...r })) }
}

function addDayOff() {
  const date = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  daysOff.value.push({ from: date, to: date, note: '' })
}

async function save() {
  const hours = emptyWeek()
  for (const d of WEEKDAYS) hours[d] = days[d].open ? days[d].slots.map(r => ({ ...r })) : []
  const body = {
    useOpeningHours: useOpeningHours.value,
    hours,
    daysOff: daysOff.value.filter(d => d.from).map(d => ({ from: d.from, to: d.to || d.from, ...(d.note.trim() ? { note: d.note.trim() } : {}) })),
  }
  await run(async () => {
    await $fetch<unknown>('/api/v1/settings', { method: 'PATCH', body: { settings: { [KEY]: body } } })
    await refresh()
  }, { successTitle: 'Appointment hours saved', errorTitle: 'Couldn\'t save the appointment hours', key: 'save' })
}
</script>

<template>
  <div class="space-y-6">
    <p v-if="error" class="text-sm text-red-500">{{ getErrorMessage(error, 'Could not load the settings') }}</p>

    <UCard>
      <template #header>
        <p class="text-sm font-semibold text-gray-900 dark:text-white">When people can book</p>
        <p class="mt-1 text-xs text-gray-500">For the Book an Appointment block. Each block sets its own length, price and notice; these are the hours they share, in your site's time zone. Two appointments never overlap.</p>
      </template>
      <div class="flex items-center gap-3">
        <USwitch v-model="useOpeningHours" aria-label="Use my opening hours" />
        <span class="text-sm">Use my opening hours (Settings → Business), including holiday hours</span>
      </div>

      <div v-if="!useOpeningHours" class="mt-4 divide-y divide-gray-100 dark:divide-gray-800">
        <div v-for="d in WEEKDAYS" :key="d" class="flex flex-wrap items-start gap-3 py-3">
          <div class="flex w-40 items-center gap-2 pt-1.5">
            <USwitch v-model="days[d].open" :aria-label="`Appointments on ${DAY_NAMES[d]}`" />
            <span class="text-sm font-medium">{{ DAY_NAMES[d] }}</span>
          </div>
          <div v-if="days[d].open" class="flex-1 space-y-2">
            <div v-for="(slot, i) in days[d].slots" :key="i" class="flex items-center gap-2">
              <UInput v-model="slot.open" type="time" size="sm" :aria-label="`${DAY_NAMES[d]} from`" />
              <span class="text-gray-400">–</span>
              <UInput v-model="slot.close" type="time" size="sm" :aria-label="`${DAY_NAMES[d]} until`" />
              <UButton v-if="days[d].slots.length > 1" size="xs" variant="ghost" color="neutral" icon="i-lucide-x" :aria-label="`Remove these ${DAY_NAMES[d]} hours`" @click="days[d].slots.splice(i, 1)" />
            </div>
            <div class="flex gap-2">
              <UButton v-if="days[d].slots.length < 4" size="xs" variant="ghost" icon="i-lucide-plus" @click="days[d].slots.push({ open: days[d].slots.at(-1)?.close ?? '09:00', close: '17:00' })">Add hours</UButton>
              <UButton v-if="d === 'mon'" size="xs" variant="ghost" icon="i-lucide-copy" @click="copyToWeekdays">Copy to Tuesday–Friday</UButton>
            </div>
          </div>
          <span v-else class="pt-1.5 text-sm text-gray-400">No appointments</span>
        </div>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <p class="text-sm font-semibold text-gray-900 dark:text-white">Days off</p>
        <p class="mt-1 text-xs text-gray-500">Holidays, training days: no appointments from the first day to the last. Appointments already booked aren't touched.</p>
      </template>
      <div class="space-y-3">
        <div v-for="(d, i) in daysOff" :key="i" class="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-800 p-3">
          <UInput v-model="d.from" type="date" size="sm" aria-label="First day off" />
          <span class="text-gray-400">to</span>
          <UInput v-model="d.to" type="date" size="sm" :min="d.from" aria-label="Last day off" />
          <UInput v-model="d.note" size="sm" placeholder="Note, e.g. Holiday" class="min-w-40 flex-1" aria-label="Note" />
          <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" aria-label="Remove these days off" @click="daysOff.splice(i, 1)" />
        </div>
        <UButton size="sm" variant="outline" icon="i-lucide-plus" @click="addDayOff">Add days off</UButton>
      </div>
    </UCard>

    <div class="flex justify-end">
      <UButton :loading="isRunning('save')" @click="save">Save appointment hours</UButton>
    </div>
  </div>
</template>
