<script setup lang="ts">
// Holiday lets (server/utils/availability.ts): the calendars this page follows (Airbnb,
// Booking.com… export links, synced hourly), the nights blocked by hand, and this page's own
// export link to paste back into those sites. Shown when the page has an Availability
// calendar block. Read and changed through /_nuxflow/availability (not /api; see that route).

interface Feed {
  id: string
  url: string
  label: string
  lastSyncedAt: string | null
  lastError: string | null
  eventCount: number
}
interface OwnBlock { id: string; startDate: string; endDate: string; note: string }
interface Availability { itemId: string; feeds: Feed[]; blocks: OwnBlock[]; exportUrl: string }

const props = defineProps<{ itemId: string; disabled?: boolean }>()
const { run, isRunning } = useAdminAction()
const toast = useToast()

const url: string = `/_nuxflow/availability?item=${encodeURIComponent(props.itemId)}`
const { data, refresh, pending, error } = useFetch<Availability>(url, { server: false })
const feeds = computed(() => data.value?.feeds ?? [])
const blocks = computed(() => data.value?.blocks ?? [])
const exportUrl = computed(() => data.value?.exportUrl ?? '')

const feedUrl = ref('')
const feedLabel = ref('')
const blockStart = ref('')
const blockEnd = ref('')
const blockNote = ref('')

function post<T>(body: Record<string, unknown>) {
  return $fetch<T>('/_nuxflow/availability', { method: 'POST', body: { item: props.itemId, ...body } })
}

async function addFeed() {
  const res = await run(() => post<{ feed: { ok: boolean; error: string | null; eventCount: number } }>({ action: 'add-feed', url: feedUrl.value, label: feedLabel.value }), {
    successTitle: r => (r.feed.ok ? `Calendar added: ${r.feed.eventCount} ${r.feed.eventCount === 1 ? 'booking' : 'bookings'} found` : undefined),
    errorTitle: 'Couldn\'t add the calendar',
    key: 'add-feed',
  })
  if (!res) return
  // Not useAdminAction()'s error toast: the calendar was added, only its first sync failed.
  if (!res.feed.ok) toast.add({ title: 'Calendar added, but it couldn\'t be read yet', description: res.feed.error ?? undefined, color: 'warning' })
  feedUrl.value = ''
  feedLabel.value = ''
  await refresh()
}

async function removeFeed(f: Feed) {
  const ok = await run(() => post<{ success: boolean }>({ action: 'remove-feed', id: f.id }), { successTitle: 'Calendar removed', errorTitle: 'Couldn\'t remove the calendar', key: `feed:${f.id}` })
  if (ok) await refresh()
}

async function syncNow() {
  const res = await run(() => post<{ feeds: Array<{ ok: boolean }> }>({ action: 'sync' }), {
    successTitle: r => (r.feeds.every(f => f.ok) ? 'Calendars synced' : 'Synced, but some calendars couldn\'t be read'),
    errorTitle: 'Couldn\'t sync the calendars',
    key: 'sync',
  })
  if (res) await refresh()
}

async function addBlock() {
  const ok = await run(() => post<{ id: string }>({ action: 'add-block', start: blockStart.value, end: blockEnd.value, note: blockNote.value }), {
    successTitle: 'Dates blocked',
    errorTitle: 'Couldn\'t block those dates',
    key: 'add-block',
  })
  if (!ok) return
  blockStart.value = ''
  blockEnd.value = ''
  blockNote.value = ''
  await refresh()
}

async function removeBlock(b: OwnBlock) {
  const ok = await run(() => post<{ success: boolean }>({ action: 'remove-block', id: b.id }), { successTitle: 'Dates freed', errorTitle: 'Couldn\'t remove those dates', key: `block:${b.id}` })
  if (ok) await refresh()
}

async function copyExport() {
  if (!exportUrl.value) return
  try {
    await navigator.clipboard.writeText(exportUrl.value)
    toast.add({ title: 'Link copied', color: 'success' })
  }
  catch {
    // Not useAdminAction(): a clipboard refusal isn't a request that failed.
    toast.add({ title: 'Couldn\'t copy. Select the link instead.', color: 'error' })
  }
}

function feedName(f: Feed): string {
  if (f.label) return f.label
  try {
    return new URL(f.url).hostname.replace(/^www\./, '')
  }
  catch {
    return 'Calendar'
  }
}

/** "3 Dec 2026 → 7 Dec (4 nights)" */
function rangeText(b: OwnBlock): string {
  const nights = Math.round((Date.parse(`${b.endDate}T00:00:00Z`) - Date.parse(`${b.startDate}T00:00:00Z`)) / 86_400_000)
  return `${formatDate(b.startDate)} → ${formatDate(b.endDate)} (${nights} ${nights === 1 ? 'night' : 'nights'})`
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide">Availability</p>
      <UButton size="xs" variant="ghost" icon="i-lucide-refresh-cw" :loading="pending" aria-label="Reload availability" @click="refresh()" />
    </div>

    <p v-if="error" class="text-xs text-red-600">{{ getErrorMessage(error, 'Couldn\'t load availability.') }}</p>

    <template v-else-if="data">
      <section class="space-y-2">
        <p class="text-sm font-medium text-gray-900 dark:text-white">Booking sites</p>
        <p class="text-xs text-gray-500">
          Paste each listing's calendar export link (Airbnb: Availability → Connect calendars; Booking.com: Rates &amp; availability → Sync calendars). Booked nights are fetched every hour.
        </p>
        <ul v-if="feeds.length" class="space-y-2">
          <li v-for="f in feeds" :key="f.id" class="rounded-lg border border-gray-200 dark:border-gray-800 p-2">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="text-sm font-medium truncate">{{ feedName(f) }}</p>
                <p class="text-xs text-gray-500">
                  {{ f.eventCount }} {{ f.eventCount === 1 ? 'booking' : 'bookings' }} ·
                  {{ f.lastSyncedAt ? `synced ${formatLocalDateTime(f.lastSyncedAt)}` : 'not synced yet' }}
                </p>
                <p v-if="f.lastError" class="text-xs text-red-600">{{ f.lastError }}</p>
              </div>
              <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" :disabled="disabled" :loading="isRunning(`feed:${f.id}`)" :aria-label="`Stop following ${feedName(f)}`" @click="removeFeed(f)" />
            </div>
          </li>
        </ul>
        <form class="space-y-2" @submit.prevent="addFeed">
          <UInput v-model="feedUrl" size="sm" placeholder="https://www.airbnb.co.uk/calendar/ical/…" aria-label="Calendar export link" :disabled="disabled" class="w-full" />
          <div class="flex gap-2">
            <UInput v-model="feedLabel" size="sm" placeholder="Name (e.g. Airbnb)" aria-label="Calendar name" :disabled="disabled" class="flex-1" />
            <UButton type="submit" size="sm" icon="i-lucide-plus" :disabled="disabled || !feedUrl.trim()" :loading="isRunning('add-feed')">Add</UButton>
          </div>
        </form>
        <UButton v-if="feeds.length" size="xs" variant="outline" icon="i-lucide-refresh-ccw" :disabled="disabled" :loading="isRunning('sync')" @click="syncNow">Sync now</UButton>
      </section>

      <section class="space-y-2">
        <p class="text-sm font-medium text-gray-900 dark:text-white">Your own blocked dates</p>
        <p class="text-xs text-gray-500">Direct bookings, your own stays, maintenance. Choose the first night and the day they leave.</p>
        <ul v-if="blocks.length" class="space-y-1">
          <li v-for="b in blocks" :key="b.id" class="flex items-center justify-between gap-2 text-xs">
            <span class="min-w-0">
              <span class="block">{{ rangeText(b) }}</span>
              <span v-if="b.note" class="block text-gray-500 truncate">{{ b.note }}</span>
            </span>
            <UButton size="xs" variant="ghost" color="error" icon="i-lucide-x" :disabled="disabled" :loading="isRunning(`block:${b.id}`)" :aria-label="`Free ${rangeText(b)}`" @click="removeBlock(b)" />
          </li>
        </ul>
        <form class="space-y-2" @submit.prevent="addBlock">
          <div class="grid grid-cols-2 gap-2">
            <label class="text-xs text-gray-500">First night
              <input v-model="blockStart" type="date" required :disabled="disabled" class="mt-1 w-full rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-2 py-1 text-sm">
            </label>
            <label class="text-xs text-gray-500">Leaving
              <input v-model="blockEnd" type="date" required :min="blockStart || undefined" :disabled="disabled" class="mt-1 w-full rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-2 py-1 text-sm">
            </label>
          </div>
          <div class="flex gap-2">
            <UInput v-model="blockNote" size="sm" placeholder="Note (only you see it)" aria-label="Note" :disabled="disabled" class="flex-1" />
            <UButton type="submit" size="sm" icon="i-lucide-plus" :disabled="disabled || !blockStart || !blockEnd" :loading="isRunning('add-block')">Block</UButton>
          </div>
        </form>
      </section>

      <section class="space-y-2">
        <p class="text-sm font-medium text-gray-900 dark:text-white">Send your dates to the booking sites</p>
        <p class="text-xs text-gray-500">
          Paste this link into Airbnb and Booking.com as an imported calendar, so your own blocked dates close those nights there too. Keep it private.
        </p>
        <div class="flex gap-2">
          <UInput :model-value="exportUrl" readonly size="sm" aria-label="Your calendar export link" class="flex-1" />
          <UButton size="sm" variant="outline" icon="i-lucide-copy" aria-label="Copy your calendar export link" @click="copyExport" />
        </div>
      </section>
    </template>
  </div>
</template>
