<script setup lang="ts">
type Status = 'pending' | 'subscribed' | 'unsubscribed'

interface Subscriber {
  id: string
  email: string
  name: string | null
  status: Status
  source: string
  sourcePath: string | null
  confirmSentAt: string | null
  confirmedAt: string | null
  unsubscribedAt: string | null
  syncError: string | null
  createdAt: string
}

interface ListResponse {
  items: Subscriber[]
  total: number
  page: number
  perPage: number
  counts: Record<Status, number>
  canSendListEmail: boolean
  stats: { days: number; shown: number; dismissed: number; signups: number }
}

const { run, isRunning } = useAdminAction()
const status = ref<Status | 'all'>('all')
const q = ref('')
const search = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(q, (value) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { search.value = value.trim() }, 300)
})
onBeforeUnmount(() => clearTimeout(searchTimer))
const page = ref(1)

watch([status, search], () => { page.value = 1 })

const { data, pending, refresh } = await useFetch<ListResponse>('/api/v1/mailing-list', {
  query: computed(() => ({
    status: status.value === 'all' ? undefined : status.value,
    q: search.value || undefined,
    page: page.value,
  })),
})

const statusOptions = computed(() => [
  { label: `All (${(data.value?.counts.pending ?? 0) + (data.value?.counts.subscribed ?? 0) + (data.value?.counts.unsubscribed ?? 0)})`, value: 'all' },
  { label: `Subscribed (${data.value?.counts.subscribed ?? 0})`, value: 'subscribed' },
  { label: `Waiting to confirm (${data.value?.counts.pending ?? 0})`, value: 'pending' },
  { label: `Unsubscribed (${data.value?.counts.unsubscribed ?? 0})`, value: 'unsubscribed' },
])

const conversion = computed(() => {
  const s = data.value?.stats
  if (!s || s.shown === 0) return null
  return Math.round((s.signups / s.shown) * 1000) / 10
})

type Color = 'success' | 'warning' | 'neutral'
const STATUS_UI: Record<Status, { label: string; color: Color }> = {
  subscribed: { label: 'Subscribed', color: 'success' },
  pending: { label: 'Waiting to confirm', color: 'warning' },
  unsubscribed: { label: 'Unsubscribed', color: 'neutral' },
}

const columns = [
  { accessorKey: 'email', header: 'Email' },
  { accessorKey: 'status', header: 'Status' },
  { accessorKey: 'source', header: 'Signed up from' },
  { accessorKey: 'createdAt', header: 'Date' },
  { id: 'actions', header: actionsHeader },
]

const exportUrl = computed(() => `/api/v1/mailing-list/export${status.value === 'all' ? '' : `?status=${status.value}`}`)

// Runs are keyed by subscriber id, so each row's menu button shows its own spinner.
async function resend(row: Subscriber) {
  const url: string = `/api/v1/mailing-list/${row.id}/resend`
  await run(async () => {
    await $fetch<unknown>(url, { method: 'POST' })
    await refresh()
  }, { successTitle: `Confirmation email sent to ${row.email}`, errorTitle: "Couldn't send the email", key: row.id })
}

async function markUnsubscribed(row: Subscriber) {
  const url: string = `/api/v1/mailing-list/${row.id}`
  await run(async () => {
    await $fetch<unknown>(url, { method: 'PATCH', body: { status: 'unsubscribed' } })
    await refresh()
  }, { successTitle: `${row.email} unsubscribed`, errorTitle: "Couldn't unsubscribe", key: row.id })
}

const confirmDelete = ref<Subscriber | null>(null)

async function remove() {
  const row = confirmDelete.value
  if (!row) return
  const url: string = `/api/v1/mailing-list/${row.id}`
  await run(async () => {
    await $fetch<unknown>(url, { method: 'DELETE' })
    confirmDelete.value = null
    await refresh()
  }, { successTitle: `${row.email} deleted`, errorTitle: "Couldn't delete subscriber", key: row.id })
}

function rowActions(row: Subscriber) {
  const items = []
  if (row.status === 'pending') {
    items.push({ label: 'Resend confirmation email', icon: 'i-lucide-send', onSelect: () => resend(row) })
  }
  if (row.status !== 'unsubscribed') {
    items.push({ label: 'Unsubscribe', icon: 'i-lucide-user-minus', onSelect: () => markUnsubscribed(row) })
  }
  items.push({ label: 'Delete (erase their data)', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => { confirmDelete.value = row } })
  return [items]
}
</script>

<template>
  <div class="space-y-4">
    <UAlert
      v-if="data && !data.canSendListEmail && data.counts.pending > 0"
      color="warning"
      variant="subtle"
      icon="i-lucide-mail-warning"
      title="Confirmation emails can't be sent"
      description="Some people are waiting for a confirmation email, but this site has no third-party email provider (Resend, Brevo or ZeptoMail). List emails are never sent through Cloudflare. Set one up in Settings → Email, then resend from the menu on each row."
    />

    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <UCard>
        <p class="text-xs text-gray-500 dark:text-gray-400">Subscribed</p>
        <p class="text-2xl font-bold">{{ data?.counts.subscribed ?? 0 }}</p>
      </UCard>
      <UCard>
        <p class="text-xs text-gray-500 dark:text-gray-400">Popup shown ({{ data?.stats.days ?? 30 }} days)</p>
        <p class="text-2xl font-bold">{{ data?.stats.shown ?? 0 }}</p>
      </UCard>
      <UCard>
        <p class="text-xs text-gray-500 dark:text-gray-400">Popup signups ({{ data?.stats.days ?? 30 }} days)</p>
        <p class="text-2xl font-bold">{{ data?.stats.signups ?? 0 }}</p>
      </UCard>
      <UCard>
        <p class="text-xs text-gray-500 dark:text-gray-400">Signed up after seeing it</p>
        <p class="text-2xl font-bold">{{ conversion === null ? '—' : `${conversion}%` }}</p>
      </UCard>
    </div>

    <UCard>
      <div class="flex flex-col sm:flex-row gap-2 mb-4">
        <UInput v-model="q" icon="i-lucide-search" placeholder="Search email or name" class="flex-1" />
        <USelect v-model="status" :items="statusOptions" class="sm:w-60" />
        <UButton :to="exportUrl" external download icon="i-lucide-download" variant="outline">Export CSV</UButton>
      </div>

      <UTable
        :loading="pending"
        :columns="columns"
        :data="data?.items ?? []"
        :empty-state="{ icon: 'i-lucide-mail-plus', label: 'No one has signed up yet.' }"
      >
        <template #email-cell="{ row }">
          <div class="min-w-0">
            <p class="truncate">{{ row.original.email }}</p>
            <p v-if="row.original.name" class="text-xs text-gray-500 truncate">{{ row.original.name }}</p>
          </div>
        </template>
        <template #status-cell="{ row }">
          <div class="flex items-center gap-1.5">
            <UBadge :color="STATUS_UI[row.original.status].color" variant="subtle">
              {{ STATUS_UI[row.original.status].label }}
            </UBadge>
            <UTooltip v-if="row.original.syncError" :text="`Brevo sync failed: ${row.original.syncError}`">
              <UIcon name="i-lucide-triangle-alert" class="w-4 h-4 text-amber-500" />
            </UTooltip>
          </div>
        </template>
        <template #source-cell="{ row }">
          <span class="text-sm">{{ row.original.source === 'popup' ? 'Popup' : 'Signup box' }}</span>
          <span v-if="row.original.sourcePath" class="text-xs text-gray-500 block truncate">{{ row.original.sourcePath }}</span>
        </template>
        <template #createdAt-cell="{ row }">
          {{ formatLocalDate(row.original.createdAt) }}
        </template>
        <template #actions-cell="{ row }">
          <div class="flex justify-end">
            <UDropdownMenu :items="rowActions(row.original)">
              <UButton icon="i-lucide-ellipsis" variant="ghost" color="neutral" size="sm" :loading="isRunning(row.original.id)" aria-label="Actions" />
            </UDropdownMenu>
          </div>
        </template>
      </UTable>

      <div v-if="(data?.total ?? 0) > (data?.perPage ?? 50)" class="flex justify-end mt-4">
        <UPagination v-model:page="page" :total="data?.total ?? 0" :items-per-page="data?.perPage ?? 50" />
      </div>
    </UCard>

    <UModal :open="!!confirmDelete" title="Delete this subscriber?" @update:open="(v: boolean) => { if (!v) confirmDelete = null }">
      <template #body>
        <p class="text-sm">
          This erases <strong>{{ confirmDelete?.email }}</strong> and their signup record completely — use it when someone asks for their data to be deleted.
          To just stop emailing them, choose <em>Unsubscribe</em> instead, which remembers they left.
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton variant="ghost" @click="confirmDelete = null">Cancel</UButton>
          <UButton color="error" :loading="!!confirmDelete && isRunning(confirmDelete.id)" @click="remove">Delete</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
