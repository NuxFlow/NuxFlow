<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { SpacingValue } from '../types'

const props = withDefaults(defineProps<{
  title?: string
  description?: string
  displayMode?: 'list' | 'month'
  limit?: number
  bgColor?: string
  textColor?: string
  padding?: SpacingValue
}>(), {
  title: 'Upcoming Events',
  description: 'Join us at our upcoming meetups, webinars, and workshops.',
  displayMode: 'list',
  limit: 10,
})

const containerStyle = computed(() => {
  const p = props.padding
  return {
    backgroundColor: props.bgColor || 'transparent',
    color: props.textColor || 'inherit',
    padding: p ? `${p.top}${p.unit} ${p.right}${p.unit} ${p.bottom}${p.unit} ${p.left}${p.unit}` : '60px 24px',
  }
})

// Fetch events
const events = ref<any[]>([])
const loading = ref(true)

async function loadEvents() {
  try {
    const res = await fetch(`/api/public/events?limit=${props.limit}`)
    if (res.ok) {
      const data = await res.json()
      events.value = data.events || []
    }
  } catch (err) {
    console.error('Failed to load events:', err)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadEvents()
})

// Date Formatting Helpers
function formatDate(dateStr: string, allDay: boolean) {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }
  if (!allDay) {
    options.hour = '2-digit'
    options.minute = '2-digit'
  }
  return new Date(dateStr).toLocaleDateString('en-US', options)
}

function getEventDay(dateStr: string) {
  return new Date(dateStr).getDate()
}

function getEventMonth(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short' })
}

// Client-Side iCal (.ics) Generator
function downloadIcal(event: any) {
  const cleanStamp = (dStr: string) => dStr.replace(/[-:]/g, '').split('.')[0] + 'Z'
  const start = cleanStamp(event.eventStartAt)
  const end = event.eventEndAt ? cleanStamp(event.eventEndAt) : start
  const icsLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NuxFlow//NuxFlow Events//EN',
    'BEGIN:VEVENT',
    `UID:${event.id}@nuxflow`,
    `DTSTAMP:${cleanStamp(new Date().toISOString())}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${event.title}`,
  ]
  if (event.excerpt) icsLines.push(`DESCRIPTION:${event.excerpt.replace(/\n/g, '\\n')}`)
  if (event.eventLocation) icsLines.push(`LOCATION:${event.eventLocation}`)
  if (event.eventUrl) icsLines.push(`URL:${event.eventUrl}`)
  icsLines.push('END:VEVENT', 'END:VCALENDAR')

  const blob = new Blob([icsLines.join('\r\n')], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${event.slug || 'event'}.ics`
  link.click()
  URL.revokeObjectURL(url)
}

// ── Calendar Month View State & Logic ──────────────────────────────────────────
const today = new Date()
const currentYear = ref(today.getFullYear())
const currentMonth = ref(today.getMonth())
const selectedDate = ref<string | null>(null)

const monthLabel = computed(() =>
  new Date(currentYear.value, currentMonth.value, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
)

const calendarDays = computed(() => {
  const year = currentYear.value
  const month = currentMonth.value
  const firstDow = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells: Array<{ date: string | null; day: number | null; isToday: boolean; hasEvents: boolean }> = []

  for (let i = 0; i < firstDow; i++) {
    cells.push({ date: null, day: null, isToday: false, hasEvents: false })
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const isT = dateStr === today.toISOString().substring(0, 10)
    const hasEv = events.value.some(e => e.eventStartAt && e.eventStartAt.startsWith(dateStr))
    cells.push({ date: dateStr, day: d, isToday: isT, hasEvents: hasEv })
  }

  return cells
})

function prevMonth() {
  if (currentMonth.value === 0) { currentYear.value--; currentMonth.value = 11 }
  else currentMonth.value--
}

function nextMonth() {
  if (currentMonth.value === 11) { currentYear.value++; currentMonth.value = 0 }
  else currentMonth.value++
}

const activeEvents = computed(() => {
  if (props.displayMode === 'list') return events.value
  if (!selectedDate.value) return events.value
  return events.value.filter(e => e.eventStartAt && e.eventStartAt.startsWith(selectedDate.value!))
})
</script>

<template>
  <section class="canvas-calendar w-full" :style="containerStyle">
    <div class="mx-auto max-w-5xl px-6">
      <!-- Section Header -->
      <div v-if="title || description" class="text-center mb-12 space-y-3">
        <h2 v-if="title" class="text-3xl font-extrabold tracking-tight leading-tight md:text-4xl text-gray-900 dark:text-white">{{ title }}</h2>
        <p v-if="description" class="text-lg text-gray-500 dark:text-gray-400 max-w-2xl mx-auto whitespace-pre-wrap">{{ description }}</p>
      </div>

      <!-- Loading State -->
      <div v-if="loading" class="flex justify-center py-12">
        <div class="animate-spin rounded-full h-8 w-8 border-2 border-primary-500 border-t-transparent"></div>
      </div>

      <!-- Empty State -->
      <div v-else-if="events.length === 0" class="text-center py-12 bg-gray-50 dark:bg-white/[0.02] border border-gray-100 dark:border-white/[0.08] rounded-2xl">
        <span class="text-3xl">📅</span>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-2">No upcoming events scheduled at this time.</p>
      </div>

      <div v-else>
        <!-- 📅 DISPLAY MODE: MONTH GRID -->
        <div v-if="displayMode === 'month'" class="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start mb-8">
          <!-- Calendar Month UI -->
          <div class="lg:col-span-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 shadow-sm">
            <div class="flex items-center justify-between mb-4">
              <span class="text-sm font-semibold text-gray-900 dark:text-white">{{ monthLabel }}</span>
              <div class="flex gap-1">
                <button @click="prevMonth" class="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors" aria-label="Previous Month">
                  <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
                </button>
                <button @click="nextMonth" class="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors" aria-label="Next Month">
                  <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
                </button>
              </div>
            </div>

            <div class="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
              <div>Su</div><div>Mo</div><div>Tu</div><div>We</div><div>Th</div><div>Fr</div><div>Sa</div>
            </div>

            <div class="grid grid-cols-7 gap-1">
              <div
                v-for="(cell, idx) in calendarDays"
                :key="idx"
                class="aspect-square flex flex-col items-center justify-center rounded-lg text-sm transition-all relative"
                :class="[
                  cell.date ? 'cursor-pointer hover:bg-primary-50 dark:hover:bg-primary-950/20' : '',
                  selectedDate === cell.date ? 'ring-2 ring-primary-500 bg-primary-50 dark:bg-primary-950/30' : '',
                  cell.isToday ? 'bg-primary-500 text-white font-bold hover:bg-primary-600' : 'text-gray-700 dark:text-gray-300'
                ]"
                @click="cell.date && (selectedDate = selectedDate === cell.date ? null : cell.date)"
              >
                <span v-if="cell.day">{{ cell.day }}</span>
                <span v-if="cell.hasEvents && !cell.isToday" class="absolute bottom-1 w-1.5 h-1.5 rounded-full bg-primary-500"></span>
              </div>
            </div>
          </div>

          <!-- Highlighted Events List -->
          <div class="space-y-4">
            <h3 class="text-sm font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
              {{ selectedDate ? `Events for ${selectedDate}` : 'All Events' }}
            </h3>
            <div v-if="activeEvents.length === 0" class="text-sm text-gray-500 dark:text-gray-400">
              No events scheduled on this date. Select another date.
            </div>
            <div
              v-for="event in activeEvents"
              :key="event.id"
              class="border border-gray-100 dark:border-white/[0.08] bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm rounded-xl p-4 shadow-sm hover:border-primary-500/50 transition-colors"
            >
              <h4 class="font-bold text-gray-900 dark:text-white">{{ event.title }}</h4>
              <p class="text-xs text-primary-500 font-semibold mt-1">
                {{ formatDate(event.eventStartAt, !!event.eventAllDay) }}
              </p>
              <p v-if="event.eventLocation" class="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                📍 {{ event.eventLocation }}
              </p>
              <div class="mt-3 flex gap-2">
                <button @click="downloadIcal(event)" class="text-[11px] font-semibold text-gray-600 dark:text-gray-400 hover:text-primary-500 cursor-pointer flex items-center gap-1">
                  📅 Add to Calendar
                </button>
                <a v-if="event.eventUrl" :href="event.eventUrl" target="_blank" class="text-[11px] font-semibold text-primary-500 hover:underline">
                  Register →
                </a>
              </div>
            </div>
          </div>
        </div>

        <!-- 📝 DISPLAY MODE: LIST VIEW -->
        <div v-else class="space-y-6 max-w-3xl mx-auto">
          <div
            v-for="event in events"
            :key="event.id"
            class="flex flex-col sm:flex-row gap-5 border border-gray-100 dark:border-white/[0.08] bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm rounded-2xl p-6 shadow-sm hover:shadow-md hover:border-primary-500/30 transition-all"
          >
            <!-- Date Box -->
            <div class="flex sm:flex-col items-center justify-center bg-primary-50 dark:bg-primary-950/30 border border-primary-100/50 dark:border-primary-900/30 rounded-xl px-4 py-3 sm:w-20 text-center flex-shrink-0">
              <span class="text-2xl font-black text-primary-600 dark:text-primary-400">{{ getEventDay(event.eventStartAt) }}</span>
              <span class="text-xs font-bold text-primary-500 uppercase tracking-widest sm:mt-1 ml-2 sm:ml-0">{{ getEventMonth(event.eventStartAt) }}</span>
            </div>

            <!-- Event Details -->
            <div class="flex-1 space-y-2">
              <h3 class="text-xl font-bold text-gray-900 dark:text-white leading-snug">{{ event.title }}</h3>
              <p class="text-xs font-semibold text-gray-400 dark:text-gray-500 flex flex-wrap items-center gap-3">
                <span class="flex items-center gap-1">
                  🕒 {{ formatDate(event.eventStartAt, !!event.eventAllDay) }}
                </span>
                <span v-if="event.eventLocation" class="flex items-center gap-1">
                  📍 {{ event.eventLocation }}
                </span>
              </p>
              <p v-if="event.excerpt" class="text-sm text-gray-500 dark:text-gray-400 line-clamp-2">{{ event.excerpt }}</p>
              
              <div class="pt-2 flex items-center gap-4">
                <button
                  @click="downloadIcal(event)"
                  class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-800 text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-primary-500 transition-colors cursor-pointer select-none"
                >
                  📅 Add to Calendar
                </button>
                <a
                  v-if="event.eventUrl"
                  :href="event.eventUrl"
                  target="_blank"
                  class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary-500 text-xs font-semibold text-white hover:bg-primary-600 transition-colors cursor-pointer select-none"
                >
                  Register / RSVP
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
