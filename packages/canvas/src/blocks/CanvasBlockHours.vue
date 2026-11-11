<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import type { SpacingValue } from '../types'
import { spacingToCss } from '../utils/spacing'
import { businessContextKey } from '../utils/business-context'
import { canvasApiKey } from '../editor/canvasApi'
import {
  BUSINESS_DAYS,
  addressLine,
  dayName,
  formatSlots,
  hasAnyHours,
  openStatus,
  siteClock,
  statusText,
  upcomingExceptions,
} from '../utils/business-hours'

// Theme hooks: .canvas-hours, .canvas-hours-status[data-open], .canvas-hours-table,
// .canvas-hours-today, .canvas-hours-exceptions, .canvas-hours-contact.
//
// The hours come from Settings → Business (one place, also used for Google's LocalBusiness
// data). The week is server-rendered; "Open now" and today's highlight depend on the clock,
// and the page is cached, so they're worked out in the browser after it loads (and every
// minute after), never during SSR.

const props = withDefaults(defineProps<{
  title?: string
  showStatus?: boolean
  showAddress?: boolean
  showPhone?: boolean
  showExceptions?: boolean
  bgColor?: string
  textColor?: string
  padding?: SpacingValue
}>(), {
  title: 'Opening hours',
  showStatus: true,
  showAddress: true,
  showPhone: true,
  showExceptions: true,
  bgColor: '',
  textColor: '',
  padding: undefined,
})

const context = inject(businessContextKey, ref({ info: null, siteName: '', timeZone: 'UTC', locale: 'en' }))
const inEditor = inject(canvasApiKey, null) !== null
const info = computed(() => context.value.info)
const locale = computed(() => context.value.locale || 'en')
const hasHours = computed(() => hasAnyHours(info.value))

const now = ref<Date | null>(null)
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  now.value = new Date()
  timer = setInterval(() => { now.value = new Date() }, 60_000)
})
onBeforeUnmount(() => clearInterval(timer))

const clock = computed(() => (now.value ? siteClock(now.value, context.value.timeZone) : null))
const status = computed(() => (info.value && now.value && props.showStatus ? openStatus(info.value, context.value.timeZone, now.value) : null))
const rows = computed(() => (info.value
  ? BUSINESS_DAYS.map(day => ({ day, name: dayName(day, locale.value), hours: formatSlots(info.value!.hours[day], locale.value) }))
  : []))
const exceptions = computed(() => {
  if (!info.value || !props.showExceptions) return []
  // Before the clock is known (SSR) list every stored exception from today's UTC date;
  // the browser narrows it to the site's own today.
  const today = clock.value?.date ?? new Date().toISOString().slice(0, 10)
  return upcomingExceptions(info.value, today).map(e => ({
    ...e,
    label: new Intl.DateTimeFormat(locale.value, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${e.date}T12:00:00Z`)),
    hours: formatSlots(e.slots, locale.value),
  }))
})
const address = computed(() => (info.value && props.showAddress ? addressLine(info.value) : ''))
const phone = computed(() => (props.showPhone ? info.value?.phone ?? '' : ''))
const telHref = computed(() => `tel:${phone.value.replace(/[^\d+]/g, '')}`)

const containerStyle = computed(() => ({
  backgroundColor: props.bgColor || undefined,
  color: props.textColor || undefined,
  padding: spacingToCss(props.padding, '48px 24px'),
}))
</script>

<template>
  <section v-if="hasHours || inEditor" class="canvas-hours" :style="containerStyle">
    <div class="mx-auto max-w-md">
      <h2 v-if="title" class="text-2xl font-bold mb-3">{{ title }}</h2>

      <p v-if="!hasHours" class="text-sm opacity-60">
        Add your opening hours in Settings → Business, and they'll show here.
      </p>

      <template v-else>
        <p
          v-if="status"
          class="canvas-hours-status mb-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold"
          :class="status.open ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200'"
          :data-open="status.open ? 'true' : 'false'"
          role="status"
        >
          <span class="h-2 w-2 rounded-full" :class="status.open ? 'bg-green-500' : 'bg-gray-400'" aria-hidden="true" />
          {{ statusText(status, locale) }}
        </p>

        <table class="canvas-hours-table w-full text-sm">
          <tbody>
            <tr
              v-for="row in rows"
              :key="row.day"
              class="border-b border-current/10 last:border-0"
              :class="{ 'canvas-hours-today font-semibold': clock?.day === row.day }"
              :aria-current="clock?.day === row.day ? 'date' : undefined"
            >
              <th scope="row" class="py-1.5 pr-4 text-left font-medium">{{ row.name }}</th>
              <td class="py-1.5 text-right" :class="row.hours === 'Closed' ? 'opacity-60' : ''">{{ row.hours }}</td>
            </tr>
          </tbody>
        </table>

        <p v-if="info?.hoursNote" class="mt-3 text-sm opacity-75">{{ info.hoursNote }}</p>

        <div v-if="exceptions.length" class="canvas-hours-exceptions mt-5">
          <p class="text-sm font-semibold mb-1">Coming up</p>
          <ul class="space-y-1 text-sm">
            <li v-for="e in exceptions" :key="e.date" class="flex justify-between gap-4">
              <span>{{ e.label }}<span v-if="e.note" class="opacity-70"> · {{ e.note }}</span></span>
              <span :class="e.slots.length ? '' : 'opacity-60'">{{ e.hours }}</span>
            </li>
          </ul>
        </div>

        <div v-if="address || phone" class="canvas-hours-contact mt-5 space-y-1 text-sm">
          <p v-if="address">{{ address }}</p>
          <p v-if="phone"><a :href="telHref" class="underline">{{ phone }}</a></p>
        </div>
      </template>
    </div>
  </section>
</template>
