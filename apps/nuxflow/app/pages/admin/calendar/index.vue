<script setup lang="ts">
import { todayIn } from '@nuxflow/canvas/events'
import { canMoveItem, datesForDrop, itemTime, monthCells, type CalendarItem } from '~/utils/calendar'

definePageMeta({ layout: 'admin', middleware: ['auth'] })
useHead({ title: 'Calendar' })

const WEEK_START_KEY = 'nuxflow:calendar-week-start'

const now = new Date()
const viewYear = ref(now.getFullYear())
const viewMonth = ref(now.getMonth())
const view = ref<'month' | 'agenda'>('month')
const typeFilter = ref('all')
const statusFilter = ref('all')
const weekStart = ref<0 | 1>(1)

const access = await fetchAdminAccess()
const canCreate = computed(() => roleAtLeast(access?.role, 'author'))

const monthKey = computed(() => `${viewYear.value}-${String(viewMonth.value + 1).padStart(2, '0')}`)
const fromDate = computed(() => `${monthKey.value}-01`)
const toDate = computed(() => `${monthKey.value}-${String(new Date(Date.UTC(viewYear.value, viewMonth.value + 1, 0)).getUTCDate()).padStart(2, '0')}`)

// server: false — "today", the week start and the viewer's permissions are all the browser's
// business, and a second render on the server could only disagree with them.
const { data, error, status, refresh } = useFetch<{ items: CalendarItem[]; unscheduled: CalendarItem[]; timeZone: string }>(
  () => `/api/v1/content/calendar?from=${fromDate.value}&to=${toDate.value}`,
  { server: false },
)
const timeZone = computed(() => data.value?.timeZone ?? 'UTC')
const todayStr = computed(() => todayIn(timeZone.value))

onMounted(() => {
  try {
    const stored = localStorage.getItem(WEEK_START_KEY)
    if (stored === '0' || stored === '1') weekStart.value = Number(stored) as 0 | 1
    else {
      const locale = new Intl.Locale(navigator.language) as Intl.Locale & { weekInfo?: { firstDay: number }; getWeekInfo?: () => { firstDay: number } }
      const firstDay = locale.getWeekInfo?.().firstDay ?? locale.weekInfo?.firstDay
      if (firstDay === 7) weekStart.value = 0
    }
  }
  catch {
    // Storage blocked or an older browser: weeks start on Monday.
  }
})

function setWeekStart(value: 0 | 1) {
  weekStart.value = value
  try {
    localStorage.setItem(WEEK_START_KEY, String(value))
  }
  catch {
    // Storage blocked: it lasts until the page is reloaded.
  }
}

const typeOptions = computed(() => {
  const types = new Map<string, string>()
  for (const item of [...(data.value?.items ?? []), ...(data.value?.unscheduled ?? [])]) {
    if (item.type) types.set(item.type.slug, item.type.name)
  }
  return [{ label: 'All types', value: 'all' }, ...[...types].map(([value, label]) => ({ label, value }))]
})
const statusOptions = [
  { label: 'All statuses', value: 'all' },
  { label: 'Published', value: 'published' },
  { label: 'Scheduled', value: 'scheduled' },
  { label: 'Draft', value: 'draft' },
  { label: 'In review', value: 'review' },
  { label: 'Archived', value: 'archived' },
]
const viewTabs = [{ label: 'Month', value: 'month' }, { label: 'Agenda', value: 'agenda' }]

function passesFilters(item: CalendarItem) {
  return (typeFilter.value === 'all' || item.type?.slug === typeFilter.value)
    && (statusFilter.value === 'all' || item.status === statusFilter.value)
}

const unscheduled = computed(() => (data.value?.unscheduled ?? []).filter(passesFilters))

const itemsByDate = computed(() => {
  const map: Record<string, CalendarItem[]> = {}
  for (const item of data.value?.items ?? []) {
    if (!passesFilters(item) || !item.calendarDate) continue
    // On each day of a long event that falls in this month.
    const last = item.calendarEndDate && item.calendarEndDate > toDate.value ? toDate.value : item.calendarEndDate ?? item.calendarDate
    let day = item.calendarDate < fromDate.value ? fromDate.value : item.calendarDate
    while (day <= last) {
      ;(map[day] ??= []).push(item)
      day = nextDay(day)
    }
  }
  for (const items of Object.values(map)) items.sort((a, b) => itemTime(a, timeZone.value).localeCompare(itemTime(b, timeZone.value)))
  return map
})

function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

const cells = computed(() => monthCells(viewYear.value, viewMonth.value, weekStart.value))
const weekdays = computed(() => Array.from({ length: 7 }, (_, i) =>
  // 2023-01-01 was a Sunday.
  new Date(Date.UTC(2023, 0, 1 + i + weekStart.value)).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })))
const agendaDays = computed(() => Object.keys(itemsByDate.value).sort())

const monthLabel = computed(() => new Date(viewYear.value, viewMonth.value, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))
const dayLabel = (day: string) => new Date(`${day}T00:00:00.000Z`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

function prevMonth() {
  if (viewMonth.value === 0) { viewYear.value--; viewMonth.value = 11 }
  else viewMonth.value--
}

function nextMonth() {
  if (viewMonth.value === 11) { viewYear.value++; viewMonth.value = 0 }
  else viewMonth.value++
}

function goToday() {
  viewYear.value = Number(todayStr.value.slice(0, 4))
  viewMonth.value = Number(todayStr.value.slice(5, 7)) - 1
}

const statusClass: Record<string, string> = {
  published: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  scheduled: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  draft: 'bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-300',
  review: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  archived: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

const isEvent = (item: CalendarItem) => item.type?.slug === 'event'
const chipTitle = (item: CalendarItem) => [item.title, item.type?.name, item.status, item.eventLocation].filter(Boolean).join(' · ')

// ── Adding ───────────────────────────────────────────────────────────────────

const newItemOpen = ref(false)
const newItemDay = ref('')

function addOn(day: string) {
  newItemDay.value = day
  newItemOpen.value = true
}

// ── Moving by drag and drop ──────────────────────────────────────────────────

const { run } = useAdminAction()
const dragging = ref<CalendarItem | null>(null)
const dropTarget = ref<string | null>(null)

function onDragStart(event: DragEvent, item: CalendarItem) {
  dragging.value = item
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', item.title)
  }
}

function onDragEnd() {
  dragging.value = null
  dropTarget.value = null
}

async function onDrop(day: string) {
  const item = dragging.value
  onDragEnd()
  if (!item) return
  const dates = datesForDrop(item, day, timeZone.value)
  if (!dates) return
  // A plain string: see the matching comment in admin/content/[id].vue's save().
  const url: string = `/api/v1/content/${item.id}`
  await run(() => $fetch<unknown, string>(url, { method: 'PATCH', body: { ...dates, expectedVersion: item.version } }), {
    successTitle: `Moved to ${dayLabel(day)}`,
    errorTitle: `Couldn't move "${item.title}"`,
  })
  await refresh()
}
</script>

<template>
  <div class="p-6 max-w-7xl mx-auto">
    <!-- Header -->
    <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Calendar</h1>
        <p v-if="data" class="text-xs text-gray-400 mt-0.5">Dates and times are in {{ timeZone }}, the site's time zone.</p>
      </div>
      <div class="flex items-center gap-2">
        <UButton v-if="canCreate" size="sm" icon="i-lucide-plus" @click="addOn(todayStr)">Add</UButton>
        <UButton size="sm" variant="soft" label="Today" @click="goToday" />
        <UButton icon="i-lucide-chevron-left" size="sm" variant="ghost" aria-label="Previous month" @click="prevMonth" />
        <span class="text-base font-semibold w-44 text-center tabular-nums">{{ monthLabel }}</span>
        <UButton icon="i-lucide-chevron-right" size="sm" variant="ghost" aria-label="Next month" @click="nextMonth" />
      </div>
    </div>

    <!-- View and filters -->
    <div class="flex flex-wrap items-center gap-2 mb-4">
      <div class="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-xs" role="tablist" aria-label="Calendar view">
        <button
          v-for="tab in viewTabs"
          :key="tab.value"
          type="button"
          role="tab"
          :aria-selected="view === tab.value"
          class="px-3 py-1.5 transition-colors"
          :class="view === tab.value ? 'bg-primary-600 text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'"
          @click="view = tab.value as 'month' | 'agenda'"
        >
          {{ tab.label }}
        </button>
      </div>
      <USelect v-model="typeFilter" :items="typeOptions" size="sm" class="w-36" aria-label="Filter by type" />
      <USelect v-model="statusFilter" :items="statusOptions" size="sm" class="w-36" aria-label="Filter by status" />
      <USelect
        v-if="view === 'month'"
        :model-value="weekStart"
        :items="[{ label: 'Week starts Monday', value: 1 }, { label: 'Week starts Sunday', value: 0 }]"
        size="sm"
        class="w-44 ml-auto"
        aria-label="First day of the week"
        @update:model-value="setWeekStart($event as 0 | 1)"
      />
    </div>

    <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-circle-alert" class="mb-6" :description="getErrorMessage(error, 'Could not load the calendar')" />

    <div class="grid lg:grid-cols-[1fr_16rem] gap-4 items-start">
      <div class="min-w-0" :class="status === 'pending' ? 'opacity-60 transition-opacity' : ''">
        <template v-if="view === 'month'">
          <!-- Day-of-week headers -->
          <div class="grid grid-cols-7 gap-1 mb-1">
            <div
              v-for="dow in weekdays"
              :key="dow"
              class="py-2 text-center text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide"
            >
              {{ dow }}
            </div>
          </div>

          <!-- Calendar grid -->
          <div class="grid grid-cols-7 gap-1">
            <div
              v-for="(cell, idx) in cells"
              :key="idx"
              class="group min-h-28 rounded-xl p-1.5 sm:p-2 border transition-colors min-w-0"
              :class="[
                cell.date === todayStr
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/20'
                  : cell.date ? 'border-gray-100 dark:border-white/[0.07] bg-white dark:bg-white/[0.03]' : 'border-transparent',
                cell.date && dropTarget === cell.date ? 'ring-2 ring-primary-500' : '',
              ]"
              @dragover.prevent="dropTarget = cell.date"
              @drop.prevent="cell.date && onDrop(cell.date)"
            >
              <template v-if="cell.date">
                <div class="flex items-center justify-between mb-1.5">
                  <div
                    class="text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full"
                    :class="cell.date === todayStr ? 'bg-primary-500 text-white' : 'text-gray-400 dark:text-gray-500'"
                  >
                    {{ cell.day }}
                  </div>
                  <button
                    v-if="canCreate"
                    type="button"
                    class="w-6 h-6 flex items-center justify-center rounded-full text-gray-400 hover:bg-black/5 dark:hover:bg-white/10 lg:opacity-0 lg:group-hover:opacity-100 focus:opacity-100 transition-opacity"
                    :aria-label="`Add to ${dayLabel(cell.date)}`"
                    @click="addOn(cell.date!)"
                  >
                    <UIcon name="i-lucide-plus" class="w-3.5 h-3.5" />
                  </button>
                </div>
                <div class="space-y-0.5">
                  <NuxtLink
                    v-for="item in itemsByDate[cell.date] ?? []"
                    :key="item.id"
                    :to="`/admin/content/${item.id}`"
                    :title="chipTitle(item)"
                    :draggable="canMoveItem(item)"
                    class="flex items-center gap-1 text-[11px] leading-tight rounded px-1.5 py-1 hover:opacity-75 transition-opacity min-w-0"
                    :class="[statusClass[item.status] ?? statusClass.draft, canMoveItem(item) ? 'cursor-grab' : '', isEvent(item) ? 'font-semibold border-l-2 border-current' : '']"
                    @dragstart="onDragStart($event, item)"
                    @dragend="onDragEnd"
                  >
                    <UIcon v-if="isEvent(item)" name="i-lucide-calendar-check" class="w-3 h-3 shrink-0" />
                    <span class="truncate">{{ item.title }}</span>
                  </NuxtLink>
                </div>
              </template>
            </div>
          </div>
        </template>

        <!-- Agenda -->
        <div v-else class="space-y-4">
          <p v-if="data && agendaDays.length === 0" class="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">Nothing in {{ monthLabel }}.</p>
          <section v-for="day in agendaDays" :key="day">
            <h2 class="text-sm font-semibold mb-1.5" :class="day === todayStr ? 'text-primary-600 dark:text-primary-400' : 'text-gray-700 dark:text-gray-300'">{{ dayLabel(day) }}</h2>
            <ul class="space-y-1">
              <li v-for="item in itemsByDate[day]" :key="item.id">
                <NuxtLink :to="`/admin/content/${item.id}`" class="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 dark:border-white/[0.07] px-3 py-2 text-sm hover:border-primary-500/50 transition-colors">
                  <span class="text-xs text-gray-400 tabular-nums w-10">{{ itemTime(item, timeZone) || 'All day' }}</span>
                  <UIcon v-if="isEvent(item)" name="i-lucide-calendar-check" class="w-3.5 h-3.5 text-gray-400" />
                  <span class="font-medium text-gray-900 dark:text-white">{{ item.title }}</span>
                  <span v-if="item.eventLocation" class="text-xs text-gray-400">{{ item.eventLocation }}</span>
                  <span class="ml-auto text-[11px] rounded px-1.5 py-0.5 capitalize" :class="statusClass[item.status] ?? statusClass.draft">{{ item.status }}</span>
                </NuxtLink>
              </li>
            </ul>
          </section>
        </div>

        <!-- Legend -->
        <div class="flex flex-wrap items-center gap-x-5 gap-y-2 mt-5 text-xs text-gray-500 dark:text-gray-400">
          <span class="flex items-center gap-1.5"><span class="inline-block w-2.5 h-2.5 rounded-sm bg-green-400 dark:bg-green-600" /> Published</span>
          <span class="flex items-center gap-1.5"><span class="inline-block w-2.5 h-2.5 rounded-sm bg-blue-400 dark:bg-blue-600" /> Scheduled</span>
          <span class="flex items-center gap-1.5"><span class="inline-block w-2.5 h-2.5 rounded-sm bg-gray-300 dark:bg-gray-600" /> Draft</span>
          <span class="flex items-center gap-1.5"><span class="inline-block w-2.5 h-2.5 rounded-sm bg-orange-400 dark:bg-orange-600" /> In Review</span>
          <span class="flex items-center gap-1.5"><span class="inline-block w-2.5 h-2.5 rounded-sm bg-red-400 dark:bg-red-600" /> Archived</span>
          <span class="flex items-center gap-1.5"><UIcon name="i-lucide-calendar-check" class="w-3 h-3" /> Event</span>
          <span v-if="view === 'month'" class="hidden lg:inline">Drag an item to another day to move it.</span>
        </div>
      </div>

      <!-- Unscheduled: drafts with no date yet, ready to be dragged onto a day -->
      <aside class="lg:sticky lg:top-4 rounded-xl border border-gray-100 dark:border-white/[0.07] bg-white dark:bg-white/[0.03] p-3">
        <h2 class="text-sm font-semibold text-gray-900 dark:text-white">Unscheduled</h2>
        <p class="text-xs text-gray-400 mb-2">Drafts with no date yet. Drag one onto a day to plan it.</p>
        <p v-if="data && unscheduled.length === 0" class="text-xs text-gray-400 py-2">Nothing waiting.</p>
        <ul class="space-y-1 max-h-[28rem] overflow-y-auto">
          <li v-for="item in unscheduled" :key="item.id">
            <NuxtLink
              :to="`/admin/content/${item.id}`"
              :title="chipTitle(item)"
              :draggable="canMoveItem(item)"
              class="flex items-center gap-1.5 text-xs rounded px-2 py-1.5 hover:opacity-75 transition-opacity min-w-0"
              :class="[statusClass[item.status] ?? statusClass.draft, canMoveItem(item) ? 'cursor-grab' : '']"
              @dragstart="onDragStart($event, item)"
              @dragend="onDragEnd"
            >
              <UIcon :name="isEvent(item) ? 'i-lucide-calendar-check' : 'i-lucide-file-text'" class="w-3 h-3 shrink-0" />
              <span class="truncate">{{ item.title }}</span>
            </NuxtLink>
          </li>
        </ul>
      </aside>
    </div>

    <AdminCalendarNewItemModal v-model:open="newItemOpen" :day="newItemDay" />
  </div>
</template>
