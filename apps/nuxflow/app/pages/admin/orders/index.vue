<script setup lang="ts">
import { formatMoney, fromMinorUnits, toMinorUnits } from '#shared/lib/money'

definePageMeta({ layout: 'admin', middleware: ['auth'] })
useHead({ title: 'Orders' })

type OrderStatus = 'pending' | 'paid' | 'partially_refunded' | 'refunded' | 'expired' | 'cancelled'
type LineKind = 'product' | 'booking' | 'pass' | 'tier'

interface Order {
  id: string
  number: number
  status: OrderStatus
  email: string
  name: string
  currency: string
  subtotalMinor: number
  discountMinor: number
  shippingMinor: number
  taxMinor: number
  totalMinor: number
  refundedMinor: number
  stripePaymentIntentId: string | null
  paidAt: string | null
  createdAt: string
  lines: { kind: LineKind; name: string; quantity: number }[]
}

interface OrderLine {
  id: string
  kind: LineKind
  name: string
  description: string | null
  quantity: number
  unitMinor: number
  totalMinor: number
}

interface OrderRefund {
  id: string
  amountMinor: number
  reason: string | null
  createdBy: string | null
  createdAt: string
}

interface OrderDetail {
  order: Omit<Order, 'lines'>
  lines: OrderLine[]
  refunds: OrderRefund[]
  refundedElsewhereMinor: number
  refundNotes: string[]
}

const STATUS: Record<OrderStatus, { label: string; color: 'success' | 'warning' | 'neutral' | 'error' | 'info' }> = {
  pending: { label: 'Awaiting payment', color: 'info' },
  paid: { label: 'Paid', color: 'success' },
  partially_refunded: { label: 'Part refunded', color: 'warning' },
  refunded: { label: 'Refunded', color: 'neutral' },
  expired: { label: 'Not paid', color: 'neutral' },
  cancelled: { label: 'Cancelled', color: 'neutral' },
}

const KIND_LABELS: Record<LineKind, string> = {
  product: 'Product',
  booking: 'Booking',
  pass: 'Class pass',
  tier: 'Membership',
}

const filterItems = [
  { label: 'Sales', value: 'sales' },
  { label: 'Everything', value: 'all' },
  { label: 'Paid', value: 'paid' },
  { label: 'Part refunded', value: 'partially_refunded' },
  { label: 'Refunded', value: 'refunded' },
  { label: 'Awaiting payment', value: 'pending' },
  { label: 'Not paid', value: 'expired' },
]
const kindItems = [
  { label: 'Anything', value: 'any' },
  ...Object.entries(KIND_LABELS).map(([value, label]) => ({ label, value })),
]

const filter = ref('sales')
const kind = ref('any')
const search = ref('')
const page = ref(1)

const { data, error, refresh, status } = useFetch<{ orders: Order[]; total: number; page: number; perPage: number }>('/api/v1/orders', {
  query: computed(() => ({
    filter: filter.value,
    kind: kind.value === 'any' ? undefined : kind.value,
    search: search.value || undefined,
    page: page.value,
  })),
  server: false,
  watch: false,
})

watch([filter, kind], () => {
  page.value = 1
  refresh()
})
watch(page, () => refresh())

const money = (minor: number, currency: string) => formatMoney(minor, currency)

const columns = [
  { id: 'number', header: 'Order' },
  { id: 'customer', header: 'Customer' },
  { id: 'items', header: 'For' },
  { id: 'total', header: 'Total' },
  { id: 'status', header: 'Status' },
  { id: 'date', header: 'Date' },
]

function itemsSummary(order: Order): string {
  const first = order.lines[0]
  if (!first) return '—'
  const name = first.quantity > 1 ? `${first.name} × ${first.quantity}` : first.name
  return order.lines.length > 1 ? `${name} and ${order.lines.length - 1} more` : name
}

// ── One order ─────────────────────────────────────────────────────────────

const openId = ref<string | null>(null)
const detail = ref<OrderDetail | null>(null)
const detailOpen = computed({
  get: () => Boolean(openId.value),
  set: (open) => {
    if (!open) {
      openId.value = null
      detail.value = null
    }
  },
})

const { run, isRunning } = useAdminAction()

async function loadDetail(id: string) {
  const url: string = `/api/v1/orders?id=${encodeURIComponent(id)}`
  // Not useAdminAction(): a failed load shows inline in the panel.
  detail.value = await $fetch<OrderDetail, string>(url).catch(() => null)
}

async function openOrder(order: Order) {
  openId.value = order.id
  detail.value = null
  await loadDetail(order.id)
}

const refundLeft = computed(() => detail.value ? detail.value.order.totalMinor - detail.value.order.refundedMinor : 0)
const canRefund = computed(() => {
  const o = detail.value?.order
  return Boolean(o && (o.status === 'paid' || o.status === 'partially_refunded') && o.stripePaymentIntentId && refundLeft.value > 0)
})

const refundOpen = ref(false)
const refundForm = reactive({ amount: 0, reason: '' })

function startRefund() {
  const o = detail.value?.order
  if (!o) return
  refundForm.amount = fromMinorUnits(refundLeft.value, o.currency)
  refundForm.reason = ''
  refundOpen.value = true
}

const refundMinor = computed(() => detail.value ? toMinorUnits(Number(refundForm.amount) || 0, detail.value.order.currency) : 0)
const refundIsFull = computed(() => refundMinor.value >= refundLeft.value)

async function confirmRefund() {
  const o = detail.value?.order
  if (!o) return
  const amountMinor = refundIsFull.value ? undefined : refundMinor.value
  await run(async () => {
    await $fetch<unknown, string>('/api/v1/orders', { method: 'POST', body: { action: 'refund', id: o.id, amountMinor, reason: refundForm.reason || undefined } })
    refundOpen.value = false
    await Promise.all([loadDetail(o.id), refresh()])
  }, { key: 'refund', successTitle: 'Refund sent', errorTitle: 'Couldn\'t refund the order' })
}
</script>

<template>
  <div class="max-w-6xl mx-auto space-y-6">
    <div>
      <h1 class="text-xl font-bold text-gray-900 dark:text-white">Orders</h1>
      <p class="text-sm text-gray-500 dark:text-gray-400">Everything people have paid for on this site: bookings, class passes and memberships bought in one go.</p>
    </div>

    <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-circle-alert" :description="getErrorMessage(error, 'Could not load orders')" />

    <UCard>
      <div class="flex flex-wrap items-end gap-3 mb-4">
        <UFormField label="Show"><USelect v-model="filter" :items="filterItems" class="w-44" /></UFormField>
        <UFormField label="Bought"><USelect v-model="kind" :items="kindItems" class="w-40" /></UFormField>
        <form class="flex gap-2" @submit.prevent="page = 1; refresh()">
          <UInput v-model="search" placeholder="Name, email or order number" aria-label="Search orders" class="w-64" />
          <UButton type="submit" variant="outline" color="neutral">Search</UButton>
        </form>
      </div>

      <p v-if="data && data.orders.length === 0" class="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">No orders here yet.</p>
      <UTable v-else :data="data?.orders ?? []" :columns="columns" :loading="status === 'pending'">
        <template #number-cell="{ row }">
          <UButton variant="link" class="px-0" @click="openOrder(row.original)">#{{ row.original.number }}</UButton>
        </template>
        <template #customer-cell="{ row }">
          <span class="block">{{ row.original.name || row.original.email }}</span>
          <span v-if="row.original.name" class="block text-xs text-gray-400">{{ row.original.email }}</span>
        </template>
        <template #items-cell="{ row }">
          <span class="text-sm">{{ itemsSummary(row.original) }}</span>
          <span class="block text-xs text-gray-400">{{ [...new Set(row.original.lines.map(l => KIND_LABELS[l.kind]))].join(', ') }}</span>
        </template>
        <template #total-cell="{ row }">
          <span>{{ money(row.original.totalMinor, row.original.currency) }}</span>
          <span v-if="row.original.refundedMinor > 0" class="block text-xs text-gray-400">{{ money(row.original.refundedMinor, row.original.currency) }} refunded</span>
        </template>
        <template #status-cell="{ row }">
          <UBadge :color="STATUS[row.original.status].color" variant="soft" size="sm">{{ STATUS[row.original.status].label }}</UBadge>
        </template>
        <template #date-cell="{ row }">
          <span class="text-sm text-gray-500">{{ formatLocalDateTime(row.original.paidAt ?? row.original.createdAt) }}</span>
        </template>
      </UTable>

      <div v-if="data && data.total > data.perPage" class="flex justify-end mt-4">
        <UPagination v-model:page="page" :total="data.total" :items-per-page="data.perPage" />
      </div>
    </UCard>

    <USlideover v-model:open="detailOpen" :title="detail ? `Order #${detail.order.number}` : 'Order'">
      <template #body>
        <p v-if="!detail" class="text-sm text-gray-500">Loading…</p>
        <div v-else class="space-y-5">
          <div class="flex items-center justify-between gap-2">
            <UBadge :color="STATUS[detail.order.status].color" variant="soft">{{ STATUS[detail.order.status].label }}</UBadge>
            <span class="text-sm text-gray-500">{{ formatLocalDateTime(detail.order.paidAt ?? detail.order.createdAt) }}</span>
          </div>

          <div>
            <p class="font-medium">{{ detail.order.name || 'No name given' }}</p>
            <p class="text-sm text-gray-500">{{ detail.order.email || 'No email' }}</p>
          </div>

          <div class="divide-y divide-gray-100 dark:divide-gray-800 border-y border-gray-100 dark:border-gray-800">
            <div v-for="line in detail.lines" :key="line.id" class="flex justify-between gap-3 py-2">
              <div>
                <p class="text-sm font-medium">{{ line.name }}<span v-if="line.quantity > 1" class="text-gray-500"> × {{ line.quantity }}</span></p>
                <p class="text-xs text-gray-400">{{ KIND_LABELS[line.kind] }}<template v-if="line.description"> · {{ line.description }}</template></p>
              </div>
              <span class="text-sm">{{ money(line.totalMinor, detail.order.currency) }}</span>
            </div>
          </div>

          <dl class="text-sm space-y-1">
            <div v-if="detail.order.discountMinor" class="flex justify-between"><dt class="text-gray-500">Discount</dt><dd>−{{ money(detail.order.discountMinor, detail.order.currency) }}</dd></div>
            <div v-if="detail.order.shippingMinor" class="flex justify-between"><dt class="text-gray-500">Shipping</dt><dd>{{ money(detail.order.shippingMinor, detail.order.currency) }}</dd></div>
            <div v-if="detail.order.taxMinor" class="flex justify-between"><dt class="text-gray-500">Tax</dt><dd>{{ money(detail.order.taxMinor, detail.order.currency) }}</dd></div>
            <div class="flex justify-between font-semibold"><dt>Total</dt><dd>{{ money(detail.order.totalMinor, detail.order.currency) }}</dd></div>
            <div v-if="detail.order.refundedMinor" class="flex justify-between text-gray-500"><dt>Refunded</dt><dd>−{{ money(detail.order.refundedMinor, detail.order.currency) }}</dd></div>
          </dl>

          <div v-if="detail.refunds.length || detail.refundedElsewhereMinor" class="space-y-1">
            <p class="text-sm font-medium">Refunds</p>
            <p v-for="r in detail.refunds" :key="r.id" class="text-sm text-gray-500">
              {{ money(r.amountMinor, detail.order.currency) }} on {{ formatLocalDate(r.createdAt) }}<template v-if="r.reason"> · {{ r.reason }}</template>
            </p>
            <p v-if="detail.refundedElsewhereMinor" class="text-sm text-gray-500">{{ money(detail.refundedElsewhereMinor, detail.order.currency) }} refunded in Stripe's dashboard</p>
          </div>

          <UButton v-if="canRefund" color="error" variant="outline" icon="i-lucide-undo-2" @click="startRefund">Refund</UButton>
          <p v-else-if="detail.order.status === 'pending'" class="text-sm text-gray-500">The customer hasn't finished paying. If they don't, this closes by itself.</p>
        </div>
      </template>
    </USlideover>

    <UModal v-model:open="refundOpen" title="Refund this order?" description="The money goes back to the card they paid with. Stripe's fee isn't returned to you.">
      <template #body>
        <form v-if="detail" id="refund-form" class="space-y-3" @submit.prevent="confirmRefund">
          <UFormField :label="`Amount (${detail.order.currency})`" :hint="`Up to ${money(refundLeft, detail.order.currency)}`" required>
            <UInput v-model.number="refundForm.amount" type="number" min="0.01" step="0.01" :max="fromMinorUnits(refundLeft, detail.order.currency)" required class="w-40" />
          </UFormField>
          <UFormField label="Reason" hint="Only you and your team see this"><UInput v-model="refundForm.reason" maxlength="500" class="w-full" /></UFormField>
          <UAlert v-if="refundIsFull && detail.refundNotes.length" color="warning" variant="soft" icon="i-lucide-triangle-alert" :description="detail.refundNotes.join(' ')" />
          <p v-else-if="!refundIsFull" class="text-sm text-gray-500">A part refund only gives money back. What they bought stays as it is.</p>
        </form>
      </template>
      <template #footer>
        <UButton variant="outline" color="neutral" @click="refundOpen = false">Keep</UButton>
        <UButton type="submit" form="refund-form" color="error" :loading="isRunning('refund')" :disabled="refundMinor <= 0 || refundMinor > refundLeft">Refund {{ detail ? money(Math.min(refundMinor, refundLeft), detail.order.currency) : '' }}</UButton>
      </template>
    </UModal>
  </div>
</template>
