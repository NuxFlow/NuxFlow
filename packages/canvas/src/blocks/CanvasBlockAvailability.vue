<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue'
import type { SpacingValue } from '../types'
import { spacingToCss } from '../utils/spacing'
import { availabilityMonths } from '../utils/availability-calendar'
import { useCanvasHost, type CanvasAvailability } from '../host'
import { canvasApiKey } from '../editor/canvasApi'

// Theme hooks: .canvas-availability, .canvas-availability-month, .canvas-availability-day,
// [data-booked], [data-past], .canvas-availability-legend.
// A holiday let's calendar: the coming months with booked nights crossed out. The nights come
// from the page's Availability panel in the editor (Airbnb / Booking.com calendars it follows,
// plus dates added by hand), fetched in the browser because the page itself is cached.

const props = withDefaults(defineProps<{
  title?: string
  intro?: string
  months?: number | string
  weekStart?: string
  bgColor?: string
  textColor?: string
  bookedColor?: string
  padding?: SpacingValue
}>(), {
  title: 'Availability',
  intro: '',
  months: 6,
  weekStart: 'monday',
  bgColor: '',
  textColor: '',
  bookedColor: '',
  padding: undefined,
})

const host = useCanvasHost()
const inEditor = inject(canvasApiKey, null) !== null
const data = ref<CanvasAvailability | null>(null)
const failed = ref(false)

function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

onMounted(async () => {
  if (inEditor || !host.availability) {
    data.value = { today: todayLocal(), booked: [] }
    return
  }
  try {
    const path = window.location.pathname.replace(/^\/+|\/+$/g, '')
    data.value = await host.availability(path)
  }
  catch {
    failed.value = true
  }
})

const monthCount = computed(() => Math.max(1, Math.min(12, Number(props.months) || 6)))
const firstDay = computed<0 | 1>(() => (props.weekStart === 'sunday' ? 0 : 1))
const grid = computed(() => data.value ? availabilityMonths(data.value.today, monthCount.value, data.value.booked, firstDay.value) : [])

const locale = typeof navigator !== 'undefined' ? navigator.language : 'en-GB'
const monthName = (year: number, month: number) => new Date(Date.UTC(year, month, 1)).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
const dayLabel = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
const weekdays = computed(() => Array.from({ length: 7 }, (_, i) => {
  // 2023-01-01 was a Sunday.
  const d = new Date(Date.UTC(2023, 0, 1 + ((i + firstDay.value) % 7)))
  return d.toLocaleDateString(locale, { weekday: 'narrow', timeZone: 'UTC' })
}))

const containerStyle = computed(() => ({
  backgroundColor: props.bgColor || undefined,
  color: props.textColor || undefined,
  padding: spacingToCss(props.padding, '48px 24px'),
}))
const bookedStyle = computed(() => (props.bookedColor ? { backgroundColor: props.bookedColor } : undefined))
</script>

<template>
  <section class="canvas-availability" :style="containerStyle">
    <div class="mx-auto max-w-5xl">
      <h2 v-if="title" class="mb-2 text-center text-3xl font-bold">{{ title }}</h2>
      <p v-if="intro" class="mb-6 text-center opacity-80 whitespace-pre-line">{{ intro }}</p>

      <p v-if="inEditor" class="mb-4 text-center text-sm opacity-60">
        Booked nights come from this page's Availability panel (in the sidebar) and show on the published page.
      </p>
      <p v-if="failed" class="text-center text-sm opacity-60">The calendar couldn't be loaded. Please get in touch to check dates.</p>

      <div v-if="grid.length" class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <div v-for="m in grid" :key="m.key" class="canvas-availability-month">
          <h3 class="mb-2 text-center font-semibold">{{ monthName(m.year, m.month) }}</h3>
          <div class="grid grid-cols-7 gap-1 text-center text-xs">
            <span v-for="(w, i) in weekdays" :key="`w${i}`" class="py-1 font-medium opacity-60" aria-hidden="true">{{ w }}</span>
            <span v-for="n in m.offset" :key="`b${n}`" aria-hidden="true" />
            <span
              v-for="d in m.days"
              :key="d.date"
              class="canvas-availability-day rounded py-1.5"
              :class="d.past ? 'opacity-30' : d.booked ? 'bg-gray-300/70 line-through opacity-70 dark:bg-gray-600/70' : 'bg-emerald-500/10'"
              :style="d.booked && !d.past ? bookedStyle : undefined"
              :data-date="d.date"
              :data-booked="d.booked ? '' : undefined"
              :data-past="d.past ? '' : undefined"
              :aria-label="`${dayLabel(d.date)}: ${d.past ? 'past' : d.booked ? 'booked' : 'available'}`"
            >{{ d.day }}</span>
          </div>
        </div>
      </div>

      <p v-if="grid.length" class="canvas-availability-legend mt-6 flex flex-wrap items-center justify-center gap-4 text-sm opacity-80">
        <span class="inline-flex items-center gap-2"><span class="inline-block h-4 w-4 rounded bg-emerald-500/10 ring-1 ring-current/20" aria-hidden="true" />Available</span>
        <span class="inline-flex items-center gap-2"><span class="inline-block h-4 w-4 rounded bg-gray-300/70 dark:bg-gray-600/70" :style="bookedStyle" aria-hidden="true" />Booked</span>
      </p>
    </div>
  </section>
</template>
