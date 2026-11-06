<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import type { SpacingValue } from '../types'
import { safeHref } from '../utils/sanitize-html'
import { spacingToCss } from '../utils/spacing'
import { addDays, eventDays, formatEventWhen, eventDay, todayIn, utcToZoned } from '../utils/event-dates'
import { useCanvasHost, type CanvasEventItem } from '../host'

const props = withDefaults(defineProps<{
  title?: string
  description?: string
  displayMode?: 'list' | 'month' | 'week'
  weekStartsOn?: 'monday' | 'sunday'
  /** Weekly timetable: a taxonomy whose terms become filter buttons. */
  filterTaxonomy?: string
  /** List view only: what's coming up, or what has finished. */
  timeframe?: 'upcoming' | 'past'
  limit?: number
  showSubscribe?: boolean
  bgColor?: string
  textColor?: string
  padding?: SpacingValue
}>(), {
  title: 'Upcoming Events',
  description: 'Join us at our upcoming meetups, webinars, and workshops.',
  displayMode: 'list',
  weekStartsOn: 'monday',
  filterTaxonomy: undefined,
  timeframe: 'upcoming',
  limit: 10,
  showSubscribe: true,
  bgColor: undefined,
  textColor: undefined,
  padding: undefined,
})

const containerStyle = computed(() => {
  const p = props.padding
  return {
    backgroundColor: props.bgColor || 'transparent',
    color: props.textColor || 'inherit',
    padding: spacingToCss(p, '60px 24px'),
  }
})

const host = useCanvasHost()

const events = ref<CanvasEventItem[]>([])
const timeZone = ref('UTC')
const feedUrl = ref<string | undefined>()
const loading = ref(true)

// Most events one month of the grid asks for.
const MONTH_LIMIT = 100

const now = new Date()
const currentYear = ref(now.getFullYear())
const currentMonth = ref(now.getMonth())
const selectedDate = ref<string | null>(null)

const monthPrefix = computed(() => `${currentYear.value}-${String(currentMonth.value + 1).padStart(2, '0')}`)

// Only the latest request counts: paging quickly mustn't let a slow answer overwrite it.
let latestLoad = 0

async function loadEvents() {
  const thisLoad = ++latestLoad
  loading.value = true
  try {
    let query: Parameters<typeof host.listEvents>[0]
    if (props.displayMode === 'week') {
      query = {
        limit: MONTH_LIMIT,
        from: `${addDays(weekStart.value, -1)}T00:00:00.000Z`,
        to: `${addDays(weekStart.value, 7)}T23:59:59.999Z`,
        taxonomy: props.filterTaxonomy || undefined,
      }
    }
    else if (props.displayMode === 'month') {
      // A day either side covers every time zone; each event then lands on its own dates.
      const lastDay = new Date(currentYear.value, currentMonth.value + 1, 0).getDate()
      query = {
        limit: MONTH_LIMIT,
        from: `${addDays(`${monthPrefix.value}-01`, -1)}T00:00:00.000Z`,
        to: `${addDays(`${monthPrefix.value}-${String(lastDay).padStart(2, '0')}`, 1)}T23:59:59.999Z`,
      }
    }
    else {
      query = { limit: props.limit, past: props.timeframe === 'past' }
    }
    const result = await host.listEvents(query)
    if (thisLoad !== latestLoad) return
    events.value = result.events
    timeZone.value = result.timeZone
    feedUrl.value = result.feedUrl
  }
  catch (err) {
    console.error('Failed to load events:', err)
  }
  finally {
    if (thisLoad === latestLoad) loading.value = false
  }
}

// ── Weekly timetable ──────────────────────────────────────────────────────

function weekContaining(day: string): string {
  const dow = new Date(`${day}T00:00:00.000Z`).getUTCDay()
  return addDays(day, -((dow - (props.weekStartsOn === 'sunday' ? 0 : 1) + 7) % 7))
}

// The site's own week: a visitor in another zone sees the same week as the venue. Set when
// mounted, because the site's zone arrives with the first load and the page itself is cached.
const weekStart = ref(weekContaining(now.toISOString().slice(0, 10)))
const activeTerm = ref('')

const weekTerms = computed(() => {
  const terms = new Map<string, string>()
  for (const event of events.value) for (const term of event.terms ?? []) terms.set(term.slug, term.name)
  return [...terms].map(([slug, name]) => ({ slug, name }))
})

const weekDays = computed(() => {
  const today = todayIn(timeZone.value)
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart.value, i)
    const label = new Date(`${date}T00:00:00.000Z`)
    return {
      date,
      weekday: label.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' }),
      day: label.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
      isToday: date === today,
      events: events.value
        .filter(e => dayOf(e) === date && (!activeTerm.value || e.terms?.some(t => t.slug === activeTerm.value)))
        .sort((a, b) => a.eventStartAt.localeCompare(b.eventStartAt)),
    }
  })
})

const weekLabel = computed(() => {
  const format = (day: string) => new Date(`${day}T00:00:00.000Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return `${format(weekStart.value)} – ${format(addDays(weekStart.value, 6))}`
})

// Once a visitor has moved, the week is theirs: the correction below must not undo it.
let weekChosen = false

function moveWeek(weeks: number) {
  weekChosen = true
  weekStart.value = addDays(weekStart.value, weeks * 7)
}

function startTime(event: CanvasEventItem): string {
  if (event.eventAllDay) return 'All day'
  return utcToZoned(event.eventStartAt, timeZone.value).slice(11)
}

function priceLabel(event: CanvasEventItem): string {
  if (!event.price) return ''
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: event.currency || 'USD', minimumFractionDigits: Number.isInteger(event.price) ? 0 : 2 }).format(event.price)
  }
  catch {
    return `${event.price} ${event.currency ?? ''}`
  }
}

onMounted(async () => {
  await loadEvents()
  // Now the site's zone is known, the week might be a different one from the guess above.
  const siteWeek = weekContaining(todayIn(timeZone.value))
  if (props.displayMode === 'week' && !weekChosen && siteWeek !== weekStart.value) weekStart.value = siteWeek
})
watch(() => [props.displayMode, props.timeframe, props.limit, monthPrefix.value, weekStart.value, props.filterTaxonomy], loadEvents)
watch(() => props.weekStartsOn, () => { weekStart.value = weekContaining(weekStart.value) })

function when(event: CanvasEventItem) {
  return formatEventWhen(event, timeZone.value)
}

function dayOf(event: CanvasEventItem) {
  return eventDay(event.eventStartAt, event.eventAllDay, timeZone.value)
}

function getEventDay(event: CanvasEventItem) {
  return Number(dayOf(event).slice(8, 10))
}

function getEventMonth(event: CanvasEventItem) {
  return new Date(`${dayOf(event)}T00:00:00.000Z`).toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' })
}

// webcal:// opens the visitor's calendar app and offers to subscribe.
const subscribeUrl = computed(() => (feedUrl.value && props.showSubscribe ? `webcal://${window.location.host}${feedUrl.value}` : null))

// ── Calendar Month View State & Logic ──────────────────────────────────────────

const monthLabel = computed(() =>
  new Date(currentYear.value, currentMonth.value, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
)

const weekdays = computed(() => {
  // 2023-01-01 was a Sunday.
  return Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2023, 0, 1 + i)).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' }).slice(0, 2))
})

const daysWithEvents = computed(() => {
  const days = new Set<string>()
  for (const event of events.value) for (const day of eventDays(event, timeZone.value)) days.add(day)
  return days
})

const calendarDays = computed(() => {
  const year = currentYear.value
  const month = currentMonth.value
  const firstDow = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const today = todayIn(timeZone.value)

  const cells: Array<{ date: string | null; day: number | null; isToday: boolean; hasEvents: boolean }> = []

  for (let i = 0; i < firstDow; i++) {
    cells.push({ date: null, day: null, isToday: false, hasEvents: false })
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${monthPrefix.value}-${String(d).padStart(2, '0')}`
    cells.push({ date: dateStr, day: d, isToday: dateStr === today, hasEvents: daysWithEvents.value.has(dateStr) })
  }

  return cells
})

function prevMonth() {
  selectedDate.value = null
  if (currentMonth.value === 0) { currentYear.value--; currentMonth.value = 11 }
  else currentMonth.value--
}

function nextMonth() {
  selectedDate.value = null
  if (currentMonth.value === 11) { currentYear.value++; currentMonth.value = 0 }
  else currentMonth.value++
}

const monthEvents = computed(() => {
  const inView = (day: string) => (selectedDate.value ? day === selectedDate.value : day.startsWith(monthPrefix.value))
  return events.value.filter(e => eventDays(e, timeZone.value).some(inView))
})

const selectedLabel = computed(() => selectedDate.value
  ? new Date(`${selectedDate.value}T00:00:00.000Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', timeZone: 'UTC' })
  : '')
</script>

<template>
  <section class="canvas-calendar w-full" :style="containerStyle">
    <div class="mx-auto max-w-5xl px-6">
      <!-- Section Header -->
      <div v-if="title || description" class="text-center mb-12 space-y-3">
        <h2 v-if="title" class="text-3xl font-extrabold tracking-tight leading-tight md:text-4xl text-gray-900 dark:text-white">{{ title }}</h2>
        <p v-if="description" class="text-lg text-gray-500 dark:text-gray-400 max-w-2xl mx-auto whitespace-pre-wrap">{{ description }}</p>
      </div>

      <!-- 🗓 DISPLAY MODE: WEEKLY TIMETABLE — stays on screen while another week loads. -->
      <div v-if="displayMode === 'week'" class="canvas-timetable mb-8">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div class="flex items-center gap-2">
            <button type="button" class="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors" aria-label="Previous week" @click="moveWeek(-1)">
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
            </button>
            <span class="text-sm font-semibold text-gray-900 dark:text-white" aria-live="polite">{{ weekLabel }}</span>
            <button type="button" class="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors" aria-label="Next week" @click="moveWeek(1)">
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
            </button>
          </div>
          <div v-if="weekTerms.length" class="flex flex-wrap gap-1.5" role="group" aria-label="Filter by type">
            <button
              type="button"
              class="px-3 py-1 rounded-full border text-xs font-semibold transition-colors"
              :class="!activeTerm ? 'bg-primary-500 border-primary-500 text-white' : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400'"
              :aria-pressed="!activeTerm"
              @click="activeTerm = ''"
            >
              All
            </button>
            <button
              v-for="term in weekTerms"
              :key="term.slug"
              type="button"
              class="px-3 py-1 rounded-full border text-xs font-semibold transition-colors"
              :class="activeTerm === term.slug ? 'bg-primary-500 border-primary-500 text-white' : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400'"
              :aria-pressed="activeTerm === term.slug"
              @click="activeTerm = term.slug"
            >
              {{ term.name }}
            </button>
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-7 gap-2">
          <div
            v-for="day in weekDays"
            :key="day.date"
            class="canvas-timetable-day rounded-xl border border-gray-100 dark:border-white/[0.08] p-2 min-h-24"
            :class="day.isToday ? 'ring-1 ring-primary-500' : ''"
          >
            <p class="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">{{ day.weekday }} <span class="font-normal">{{ day.day }}</span></p>
            <a
              v-for="event in day.events"
              :key="`${event.id}:${event.date ?? ''}`"
              :href="event.path"
              class="canvas-timetable-class block rounded-lg bg-primary-50 dark:bg-primary-950/30 hover:ring-1 hover:ring-primary-500 p-2 mb-1.5 transition-shadow"
            >
              <span class="block text-xs font-bold text-primary-600 dark:text-primary-400">{{ startTime(event) }}</span>
              <span class="block text-sm font-semibold leading-snug text-gray-900 dark:text-white">{{ event.title }}</span>
              <span v-if="event.eventLocation" class="block text-xs text-gray-500 dark:text-gray-400">{{ event.eventLocation }}</span>
              <span v-if="event.price" class="block text-xs text-gray-500 dark:text-gray-400">{{ priceLabel(event) }}</span>
            </a>
            <p v-if="!loading && day.events.length === 0" class="text-xs text-gray-300 dark:text-gray-700 md:hidden">Nothing on</p>
          </div>
        </div>
      </div>

      <!-- 📅 DISPLAY MODE: MONTH GRID — stays on screen while another month loads. -->
      <div v-else-if="displayMode === 'month'" class="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start mb-8">
        <!-- Calendar Month UI -->
        <div class="lg:col-span-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 shadow-sm">
          <div class="flex items-center justify-between mb-4">
            <span class="text-sm font-semibold text-gray-900 dark:text-white">{{ monthLabel }}</span>
            <div class="flex gap-1">
              <button class="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors" aria-label="Previous Month" @click="prevMonth">
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
              </button>
              <button class="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors" aria-label="Next Month" @click="nextMonth">
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
              </button>
            </div>
          </div>

          <div class="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
            <div v-for="weekday in weekdays" :key="weekday">{{ weekday }}</div>
          </div>

          <div class="grid grid-cols-7 gap-1">
            <template v-for="(cell, idx) in calendarDays" :key="idx">
              <button
                v-if="cell.date"
                type="button"
                class="aspect-square flex flex-col items-center justify-center rounded-lg text-sm transition-all relative cursor-pointer"
                :class="[
                  selectedDate === cell.date ? 'ring-2 ring-primary-500 bg-primary-50 dark:bg-primary-950/30' : '',
                  cell.isToday ? 'bg-primary-500 text-white font-bold hover:bg-primary-600' : 'text-gray-700 dark:text-gray-300 hover:bg-primary-50 dark:hover:bg-primary-950/20',
                ]"
                :aria-pressed="selectedDate === cell.date"
                :aria-label="cell.hasEvents ? `${cell.date}, has events` : cell.date"
                @click="selectedDate = selectedDate === cell.date ? null : cell.date"
              >
                <span>{{ cell.day }}</span>
                <span v-if="cell.hasEvents" class="absolute bottom-1 w-1.5 h-1.5 rounded-full" :class="cell.isToday ? 'bg-white' : 'bg-primary-500'"/>
              </button>
              <div v-else class="aspect-square"/>
            </template>
          </div>
        </div>

        <!-- Highlighted Events List -->
        <div class="space-y-4">
          <h3 class="text-sm font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
            {{ selectedDate ? `Events on ${selectedLabel}` : `Events in ${monthLabel}` }}
          </h3>
          <div v-if="loading" class="flex justify-center py-6">
            <div class="animate-spin rounded-full h-6 w-6 border-2 border-primary-500 border-t-transparent"/>
          </div>
          <div v-else-if="monthEvents.length === 0" class="text-sm text-gray-500 dark:text-gray-400">
            {{ selectedDate ? 'No events on this date.' : 'No events this month.' }}
          </div>
          <div
            v-for="event in loading ? [] : monthEvents"
            :key="`${event.id}:${event.date ?? ''}`"
            class="border border-gray-100 dark:border-white/[0.08] bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm rounded-xl p-4 shadow-sm hover:border-primary-500/50 transition-colors"
          >
            <h4 class="font-bold text-gray-900 dark:text-white">
              <a v-if="event.path" :href="event.path" class="hover:text-primary-500">{{ event.title }}</a>
              <template v-else>{{ event.title }}</template>
            </h4>
            <p class="text-xs text-primary-500 font-semibold mt-1">{{ when(event) }}</p>
            <p v-if="event.eventLocation" class="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
              📍 {{ event.eventLocation }}
            </p>
            <div class="mt-3 flex gap-3">
              <a v-if="event.icsUrl" :href="event.icsUrl" class="text-[11px] font-semibold text-gray-600 dark:text-gray-400 hover:text-primary-500 flex items-center gap-1">
                📅 Add to Calendar
              </a>
              <a v-if="event.rsvp && event.path" :href="event.path" class="text-[11px] font-semibold text-primary-500 hover:underline">
                RSVP →
              </a>
              <a v-else-if="event.eventUrl" :href="safeHref(event.eventUrl)" target="_blank" rel="noopener" class="text-[11px] font-semibold text-primary-500 hover:underline">
                Register →
              </a>
            </div>
          </div>
        </div>
      </div>

      <template v-else>
        <!-- Loading State -->
        <div v-if="loading" class="flex justify-center py-12">
          <div class="animate-spin rounded-full h-8 w-8 border-2 border-primary-500 border-t-transparent"/>
        </div>

        <!-- Empty State -->
        <div v-else-if="events.length === 0" class="text-center py-12 bg-gray-50 dark:bg-white/[0.02] border border-gray-100 dark:border-white/[0.08] rounded-2xl">
          <span class="text-3xl">📅</span>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-2">
            {{ timeframe === 'past' ? 'No past events yet.' : 'No upcoming events scheduled at this time.' }}
          </p>
        </div>

        <!-- 📝 DISPLAY MODE: LIST VIEW -->
        <div v-else class="space-y-6 max-w-3xl mx-auto">
          <div
            v-for="event in events"
            :key="`${event.id}:${event.date ?? ''}`"
            class="flex flex-col sm:flex-row gap-5 border border-gray-100 dark:border-white/[0.08] bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm rounded-2xl p-6 shadow-sm hover:shadow-md hover:border-primary-500/30 transition-all"
          >
            <!-- Date Box -->
            <div class="flex sm:flex-col items-center justify-center bg-primary-50 dark:bg-primary-950/30 border border-primary-100/50 dark:border-primary-900/30 rounded-xl px-4 py-3 sm:w-20 text-center flex-shrink-0">
              <span class="text-2xl font-black text-primary-600 dark:text-primary-400">{{ getEventDay(event) }}</span>
              <span class="text-xs font-bold text-primary-500 uppercase tracking-widest sm:mt-1 ml-2 sm:ml-0">{{ getEventMonth(event) }}</span>
            </div>

            <!-- Event Details -->
            <div class="flex-1 space-y-2">
              <h3 class="text-xl font-bold text-gray-900 dark:text-white leading-snug">
                <a v-if="event.path" :href="event.path" class="hover:text-primary-500">{{ event.title }}</a>
                <template v-else>{{ event.title }}</template>
              </h3>
              <p class="text-xs font-semibold text-gray-400 dark:text-gray-500 flex flex-wrap items-center gap-3">
                <span class="flex items-center gap-1">🕒 {{ when(event) }}</span>
                <span v-if="event.eventLocation" class="flex items-center gap-1">📍 {{ event.eventLocation }}</span>
              </p>
              <p v-if="event.excerpt" class="text-sm text-gray-500 dark:text-gray-400 line-clamp-2">{{ event.excerpt }}</p>

              <div v-if="timeframe !== 'past'" class="pt-2 flex items-center gap-4">
                <a
                  v-if="event.icsUrl"
                  :href="event.icsUrl"
                  class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-800 text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-primary-500 transition-colors select-none"
                >
                  📅 Add to Calendar
                </a>
                <a
                  v-if="event.rsvp && event.path"
                  :href="event.path"
                  class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary-500 text-xs font-semibold text-white hover:bg-primary-600 transition-colors select-none"
                >
                  RSVP
                </a>
                <a
                  v-else-if="event.eventUrl"
                  :href="safeHref(event.eventUrl)"
                  target="_blank"
                  rel="noopener"
                  class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary-500 text-xs font-semibold text-white hover:bg-primary-600 transition-colors select-none"
                >
                  Register
                </a>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- Subscribe to every event in a calendar app -->
      <p v-if="subscribeUrl && !loading" class="mt-8 text-center text-sm">
        <a :href="subscribeUrl" class="font-semibold text-primary-500 hover:underline">Subscribe to this calendar</a>
      </p>
    </div>
  </section>
</template>
