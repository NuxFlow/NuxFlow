<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })
useHead({ title: 'Editorial Calendar' })

type CalendarItem = {
  id: string
  title: string
  slug: string
  status: string
  typeId: string
  type: { id: string; slug: string; name: string; icon: string } | null
  publishedAt: string | null
  scheduledAt: string | null
  calendarDate: string
}

const today = new Date()
const todayStr = today.toISOString().substring(0, 10)

const viewYear = ref(today.getFullYear())
const viewMonth = ref(today.getMonth())

const fromDate = computed(() => {
  const d = new Date(viewYear.value, viewMonth.value, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
})

const toDate = computed(() => {
  const last = new Date(viewYear.value, viewMonth.value + 1, 0)
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`
})

const { data } = await useFetch<{ items: CalendarItem[] }>(
  () => `/api/v1/content/calendar?from=${fromDate.value}&to=${toDate.value}`,
)

const itemsByDate = computed(() => {
  const map: Record<string, CalendarItem[]> = {}
  for (const item of data.value?.items ?? []) {
    ;(map[item.calendarDate] ??= []).push(item)
  }
  return map
})

const calendarDays = computed(() => {
  const year = viewYear.value
  const month = viewMonth.value
  const firstDow = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells: Array<{ date: string | null; day: number | null; isToday: boolean }> = []

  for (let i = 0; i < firstDow; i++) cells.push({ date: null, day: null, isToday: false })

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    cells.push({ date: dateStr, day: d, isToday: dateStr === todayStr })
  }

  return cells
})

const monthLabel = computed(() =>
  new Date(viewYear.value, viewMonth.value, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
)

function prevMonth() {
  if (viewMonth.value === 0) { viewYear.value--; viewMonth.value = 11 }
  else viewMonth.value--
}

function nextMonth() {
  if (viewMonth.value === 11) { viewYear.value++; viewMonth.value = 0 }
  else viewMonth.value++
}

function goToday() {
  viewYear.value = today.getFullYear()
  viewMonth.value = today.getMonth()
}

const statusClass: Record<string, string> = {
  published: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  scheduled: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  draft: 'bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-300',
  review: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  archived: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}
</script>

<template>
  <div class="p-6 max-w-7xl mx-auto">
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Editorial Calendar</h1>
      <div class="flex items-center gap-2">
        <UButton size="sm" variant="soft" label="Today" @click="goToday" />
        <UButton icon="i-lucide-chevron-left" size="sm" variant="ghost" aria-label="Previous month" @click="prevMonth" />
        <span class="text-base font-semibold w-44 text-center tabular-nums">{{ monthLabel }}</span>
        <UButton icon="i-lucide-chevron-right" size="sm" variant="ghost" aria-label="Next month" @click="nextMonth" />
      </div>
    </div>

    <!-- Day-of-week headers -->
    <div class="grid grid-cols-7 gap-1 mb-1">
      <div
        v-for="dow in ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']"
        :key="dow"
        class="py-2 text-center text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide"
      >
        {{ dow }}
      </div>
    </div>

    <!-- Calendar grid -->
    <div class="grid grid-cols-7 gap-1">
      <div
        v-for="(cell, idx) in calendarDays"
        :key="idx"
        class="min-h-28 rounded-xl p-2 border transition-colors"
        :class="cell.isToday
          ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/20'
          : 'border-gray-100 dark:border-white/[0.07] bg-white dark:bg-white/[0.03]'"
      >
        <template v-if="cell.date">
          <div
            class="text-xs font-semibold mb-1.5 w-6 h-6 flex items-center justify-center rounded-full"
            :class="cell.isToday
              ? 'bg-primary-500 text-white'
              : 'text-gray-400 dark:text-gray-500'"
          >
            {{ cell.day }}
          </div>
          <div class="space-y-0.5">
            <NuxtLink
              v-for="item in itemsByDate[cell.date] ?? []"
              :key="item.id"
              :to="`/admin/content/${item.id}`"
              :title="`${item.title} · ${item.status}`"
              class="block text-[11px] leading-tight rounded px-1.5 py-1 truncate hover:opacity-75 transition-opacity"
              :class="statusClass[item.status] ?? statusClass.draft"
            >
              {{ item.title }}
            </NuxtLink>
          </div>
        </template>
      </div>
    </div>

    <!-- Legend -->
    <div class="flex flex-wrap items-center gap-x-5 gap-y-2 mt-5 text-xs text-gray-500 dark:text-gray-400">
      <span class="flex items-center gap-1.5">
        <span class="inline-block w-2.5 h-2.5 rounded-sm bg-green-400 dark:bg-green-600" />
        Published
      </span>
      <span class="flex items-center gap-1.5">
        <span class="inline-block w-2.5 h-2.5 rounded-sm bg-blue-400 dark:bg-blue-600" />
        Scheduled
      </span>
      <span class="flex items-center gap-1.5">
        <span class="inline-block w-2.5 h-2.5 rounded-sm bg-gray-300 dark:bg-gray-600" />
        Draft
      </span>
      <span class="flex items-center gap-1.5">
        <span class="inline-block w-2.5 h-2.5 rounded-sm bg-orange-400 dark:bg-orange-600" />
        In Review
      </span>
      <span class="flex items-center gap-1.5">
        <span class="inline-block w-2.5 h-2.5 rounded-sm bg-red-400 dark:bg-red-600" />
        Archived
      </span>
    </div>
  </div>
</template>
