<script setup lang="ts">
import { formatEventWhen } from '@nuxflow/canvas/events'

definePageMeta({ layout: 'admin', middleware: ['auth'] })

type RsvpStatus = 'pending' | 'confirmed' | 'waitlist' | 'cancelled'

interface Rsvp {
  id: string
  name: string
  email: string
  seats: number
  status: RsvpStatus
  createdAt: string
}

interface RsvpList {
  event: {
    id: string
    title: string
    eventStartAt: string | null
    eventEndAt: string | null
    eventAllDay: boolean | null
    eventRsvpEnabled: boolean | null
    eventRsvpCapacity: number | null
    timeZone: string
  }
  rsvps: Rsvp[]
  counts: Record<RsvpStatus, number>
}

const route = useRoute()
const id = computed(() => route.params.id as string)

const { data, error, refresh } = useFetch<RsvpList>('/api/v1/rsvps', {
  query: computed(() => ({ event: id.value })),
  server: false,
})

useHead({ title: computed(() => (data.value ? `Attendees: ${data.value.event.title}` : 'Attendees')) })

const when = computed(() => (data.value?.event.eventStartAt
  ? formatEventWhen({ eventStartAt: data.value.event.eventStartAt, eventEndAt: data.value.event.eventEndAt, eventAllDay: data.value.event.eventAllDay }, data.value.event.timeZone)
  : 'No date yet'))

const statusFilter = ref<RsvpStatus | 'all'>('all')
const filterOptions = [
  { label: 'Everyone', value: 'all' },
  { label: 'Coming', value: 'confirmed' },
  { label: 'Waitlist', value: 'waitlist' },
  { label: 'Not yet confirmed', value: 'pending' },
  { label: 'Cancelled', value: 'cancelled' },
]
const rows = computed(() => (data.value?.rsvps ?? []).filter(r => statusFilter.value === 'all' || r.status === statusFilter.value))

const statusLabel: Record<RsvpStatus, string> = { pending: 'Not yet confirmed', confirmed: 'Coming', waitlist: 'Waitlist', cancelled: 'Cancelled' }
const statusColor: Record<RsvpStatus, 'neutral' | 'success' | 'warning' | 'error'> = { pending: 'neutral', confirmed: 'success', waitlist: 'warning', cancelled: 'error' }

const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'email', header: 'Email' },
  { accessorKey: 'seats', header: 'Places' },
  { accessorKey: 'status', header: 'Status' },
  { accessorKey: 'createdAt', header: 'Asked' },
  { id: 'actions', header: actionsHeader },
]

const { run, isRunning } = useAdminAction()

async function setStatus(row: Rsvp, status: 'confirmed' | 'waitlist' | 'cancelled') {
  const url: string = `/api/v1/rsvps/${row.id}`
  await run(() => $fetch<unknown, string>(url, { method: 'PATCH', body: { status } }), {
    key: `row:${row.id}`,
    successTitle: `${row.name} is now: ${statusLabel[status]}`,
    errorTitle: `Couldn't update ${row.name}`,
  })
  await refresh()
}

function rowActions(row: Rsvp) {
  const actions = []
  if (row.status !== 'confirmed') actions.push({ label: 'Mark as coming', icon: 'i-lucide-check', onSelect: () => setStatus(row, 'confirmed') })
  if (row.status === 'confirmed') actions.push({ label: 'Move to waitlist', icon: 'i-lucide-clock', onSelect: () => setStatus(row, 'waitlist') })
  if (row.status !== 'cancelled') actions.push({ label: 'Cancel their place', icon: 'i-lucide-x', onSelect: () => setStatus(row, 'cancelled') })
  actions.push({ label: 'Erase their details', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => { eraseRow.value = row } })
  return [actions]
}

// Erasing removes the row for good, for when someone asks for their details to be removed.
const eraseRow = ref<Rsvp | null>(null)
const eraseOpen = computed({
  get: () => Boolean(eraseRow.value),
  set: (open) => {
    if (!open) eraseRow.value = null
  },
})

async function erase() {
  const row = eraseRow.value
  if (!row) return
  const url: string = `/api/v1/rsvps/${row.id}`
  await run(() => $fetch<unknown, string>(url, { method: 'DELETE' }), {
    key: 'erase',
    successTitle: `${row.name}'s details were erased`,
    errorTitle: `Couldn't erase ${row.name}'s details`,
  })
  eraseRow.value = null
  await refresh()
}

// Adding someone by hand, e.g. a booking taken over the phone.
const addOpen = ref(false)
const addForm = reactive({ name: '', email: '', seats: 1 })

async function addPerson() {
  await run(async () => {
    await $fetch<unknown, string>('/api/v1/rsvps', { method: 'POST', body: { event: id.value, ...addForm, seats: Number(addForm.seats) } })
    addOpen.value = false
    Object.assign(addForm, { name: '', email: '', seats: 1 })
    await refresh()
  }, { key: 'add', successTitle: 'Added to the list', errorTitle: 'Couldn\'t add them' })
}
</script>

<template>
  <div class="max-w-5xl mx-auto space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-3 min-w-0">
        <UButton :to="`/admin/content/${id}`" variant="ghost" icon="i-lucide-arrow-left" size="sm" aria-label="Back to the event" />
        <div class="min-w-0">
          <h1 class="text-xl font-bold text-gray-900 dark:text-white truncate">{{ data?.event.title ?? 'Attendees' }}</h1>
          <p v-if="data" class="text-sm text-gray-500 dark:text-gray-400">{{ when }}</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <!-- Not useAdminAction(): a plain download link, which the browser handles itself. -->
        <UButton :href="`/api/v1/rsvps?event=${id}&format=csv`" external variant="outline" color="neutral" size="sm" icon="i-lucide-download">Export CSV</UButton>
        <UButton size="sm" icon="i-lucide-user-plus" @click="addOpen = true">Add someone</UButton>
      </div>
    </div>

    <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-circle-alert" :description="getErrorMessage(error, 'Could not load the attendee list')" />
    <UAlert
      v-if="data && !data.event.eventRsvpEnabled"
      color="neutral"
      variant="soft"
      icon="i-lucide-info"
      description="RSVPs are switched off for this event, so visitors can't sign up on its page. Turn them on in the event's details."
    />

    <div v-if="data" class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <UCard>
        <p class="text-xs text-gray-500 dark:text-gray-400">Coming</p>
        <p class="text-2xl font-bold">{{ data.counts.confirmed }}<span v-if="data.event.eventRsvpCapacity" class="text-sm font-normal text-gray-400"> / {{ data.event.eventRsvpCapacity }}</span></p>
      </UCard>
      <UCard>
        <p class="text-xs text-gray-500 dark:text-gray-400">Waitlist</p>
        <p class="text-2xl font-bold">{{ data.counts.waitlist }}</p>
      </UCard>
      <UCard>
        <p class="text-xs text-gray-500 dark:text-gray-400">Not yet confirmed</p>
        <p class="text-2xl font-bold">{{ data.counts.pending }}</p>
      </UCard>
      <UCard>
        <p class="text-xs text-gray-500 dark:text-gray-400">Cancelled</p>
        <p class="text-2xl font-bold">{{ data.counts.cancelled }}</p>
      </UCard>
    </div>

    <UCard>
      <div class="flex justify-end mb-3">
        <USelect v-model="statusFilter" :items="filterOptions" size="sm" class="w-44" aria-label="Filter by status" />
      </div>
      <p v-if="data && rows.length === 0" class="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">Nobody here yet.</p>
      <UTable v-else :data="rows" :columns="columns">
        <template #status-cell="{ row }">
          <UBadge :color="statusColor[row.original.status]" variant="soft" size="xs">{{ statusLabel[row.original.status] }}</UBadge>
        </template>
        <template #createdAt-cell="{ row }">
          <span class="text-sm text-gray-400">{{ formatLocalDate(row.original.createdAt) }}</span>
        </template>
        <template #actions-cell="{ row }">
          <div class="flex justify-end">
            <UDropdownMenu :items="rowActions(row.original)">
              <UButton variant="ghost" size="xs" icon="i-lucide-ellipsis" :loading="isRunning(`row:${row.original.id}`)" :aria-label="`Actions for ${row.original.name}`" />
            </UDropdownMenu>
          </div>
        </template>
      </UTable>
      <p class="text-xs text-gray-400 mt-3">Moving someone or cancelling their place emails them. Places freed up go to the waitlist automatically.</p>
    </UCard>

    <UModal v-model:open="addOpen" title="Add someone" description="They're added as coming, even if the event is full. No email is sent.">
      <template #body>
        <form id="add-attendee" class="space-y-3" @submit.prevent="addPerson">
          <UFormField label="Name" required><UInput v-model="addForm.name" required maxlength="100" class="w-full" /></UFormField>
          <UFormField label="Email" required><UInput v-model="addForm.email" type="email" required maxlength="254" class="w-full" /></UFormField>
          <UFormField label="Places"><UInput v-model.number="addForm.seats" type="number" min="1" max="1000" class="w-24" /></UFormField>
        </form>
      </template>
      <template #footer>
        <UButton variant="outline" color="neutral" @click="addOpen = false">Cancel</UButton>
        <UButton type="submit" form="add-attendee" :loading="isRunning('add')">Add</UButton>
      </template>
    </UModal>

    <UModal v-model:open="eraseOpen" title="Erase these details?" :description="eraseRow ? `${eraseRow.name} (${eraseRow.email}) will be removed from this event for good.` : ''">
      <template #footer>
        <UButton variant="outline" color="neutral" @click="eraseOpen = false">Keep</UButton>
        <UButton color="error" :loading="isRunning('erase')" @click="erase">Erase</UButton>
      </template>
    </UModal>
  </div>
</template>
