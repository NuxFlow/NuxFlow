<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })
useHead({ title: 'Class passes' })

interface Pass {
  id: string
  name: string
  description: string | null
  credits: number
  price: number
  currency: string
  validDays: number | null
  isActive: boolean
}

interface Holding {
  id: string
  passName: string
  email: string
  name: string
  creditsTotal: number
  creditsUsed: number
  expiresAt: string | null
  status: 'active' | 'refunded'
  amountPaid: number
  amountRefunded: number
  currency: string
  stripePaymentIntentId: string | null
  createdAt: string
}

const search = ref('')
const { data, error, refresh } = useFetch<{ passes: Pass[]; holdings: Holding[] }>('/api/v1/class-passes', {
  query: computed(() => ({ search: search.value || undefined })),
  server: false,
  watch: false,
})

const { run, isRunning } = useAdminAction()

// ── Passes on sale ────────────────────────────────────────────────────────

const passOpen = ref(false)
const editingId = ref<string | null>(null)
const emptyPass = () => ({ name: '', description: '', credits: 10, price: 50, currency: 'GBP', validDays: null as number | null })
const passForm = reactive(emptyPass())

function newPass() {
  editingId.value = null
  Object.assign(passForm, emptyPass())
  passOpen.value = true
}

function editPass(pass: Pass) {
  editingId.value = pass.id
  Object.assign(passForm, {
    name: pass.name,
    description: pass.description ?? '',
    credits: pass.credits,
    price: pass.price,
    currency: pass.currency,
    validDays: pass.validDays,
  })
  passOpen.value = true
}

async function savePass() {
  const fields = {
    name: passForm.name,
    description: passForm.description || null,
    credits: Number(passForm.credits),
    price: Number(passForm.price),
    currency: passForm.currency,
    validDays: passForm.validDays ? Number(passForm.validDays) : null,
  }
  await run(async () => {
    if (editingId.value) {
      const url: string = `/api/v1/class-passes/${editingId.value}`
      await $fetch<unknown, string>(url, { method: 'PATCH', body: { action: 'update', ...fields } })
    }
    else {
      await $fetch<unknown, string>('/api/v1/class-passes', { method: 'POST', body: { action: 'create', ...fields } })
    }
    passOpen.value = false
    await refresh()
  }, { key: 'save-pass', successTitle: 'Pass saved', errorTitle: 'Couldn\'t save the pass' })
}

async function setActive(pass: Pass, isActive: boolean) {
  const url: string = `/api/v1/class-passes/${pass.id}`
  await run(() => $fetch<unknown, string>(url, { method: 'PATCH', body: { action: 'update', isActive } }), {
    key: `pass:${pass.id}`,
    successTitle: isActive ? `${pass.name} is on sale` : `${pass.name} is off sale`,
    errorTitle: 'Couldn\'t change the pass',
  })
  await refresh()
}

const deletePass = ref<Pass | null>(null)
const deleteOpen = computed({
  get: () => Boolean(deletePass.value),
  set: (open) => {
    if (!open) deletePass.value = null
  },
})

async function confirmDeletePass() {
  const pass = deletePass.value
  if (!pass) return
  const url: string = `/api/v1/class-passes/${pass.id}`
  await run(() => $fetch<unknown, string>(url, { method: 'DELETE' }), {
    key: 'delete-pass',
    successTitle: `${pass.name} was deleted`,
    errorTitle: 'Couldn\'t delete the pass',
  })
  deletePass.value = null
  await refresh()
}

// ── Who holds what ────────────────────────────────────────────────────────

const grantOpen = ref(false)
const grantForm = reactive({ passId: '', name: '', email: '' })

const passOptions = computed(() => (data.value?.passes ?? []).map(p => ({ label: p.name, value: p.id })))

function openGrant() {
  Object.assign(grantForm, { passId: data.value?.passes[0]?.id ?? '', name: '', email: '' })
  grantOpen.value = true
}

async function grant() {
  await run(async () => {
    await $fetch<unknown, string>('/api/v1/class-passes', { method: 'POST', body: { action: 'grant', ...grantForm } })
    grantOpen.value = false
    await refresh()
  }, { key: 'grant', successTitle: 'Pass added, and they\'ve been emailed', errorTitle: 'Couldn\'t add the pass' })
}

const refundHolding = ref<Holding | null>(null)
const refundOpen = computed({
  get: () => Boolean(refundHolding.value),
  set: (open) => {
    if (!open) refundHolding.value = null
  },
})

const left = (h: Holding) => Math.max(0, h.creditsTotal - h.creditsUsed)
const refundValue = computed(() => {
  const h = refundHolding.value
  return h ? Math.round(((h.amountPaid - h.amountRefunded) * left(h) / h.creditsTotal) * 100) / 100 : 0
})

async function confirmRefund() {
  const h = refundHolding.value
  if (!h) return
  const url: string = `/api/v1/class-passes/${h.id}`
  await run(() => $fetch<unknown, string>(url, { method: 'PATCH', body: { action: 'refund-holding' } }), {
    key: 'refund',
    successTitle: h.stripePaymentIntentId ? 'Unused sessions refunded' : 'Pass closed',
    errorTitle: 'Couldn\'t refund the pass',
  })
  refundHolding.value = null
  await refresh()
}

const eraseHolding = ref<Holding | null>(null)
const eraseOpen = computed({
  get: () => Boolean(eraseHolding.value),
  set: (open) => {
    if (!open) eraseHolding.value = null
  },
})

async function confirmErase() {
  const h = eraseHolding.value
  if (!h) return
  const url: string = `/api/v1/class-passes/${h.id}?kind=holding`
  await run(() => $fetch<unknown, string>(url, { method: 'DELETE' }), {
    key: 'erase',
    successTitle: 'Their details were erased',
    errorTitle: 'Couldn\'t erase their details',
  })
  eraseHolding.value = null
  await refresh()
}

function holdingActions(h: Holding) {
  const actions = []
  if (h.status === 'active' && left(h) > 0) {
    actions.push({ label: h.stripePaymentIntentId ? 'Refund unused sessions' : 'Close this pass', icon: 'i-lucide-undo-2', onSelect: () => { refundHolding.value = h } })
  }
  actions.push({ label: 'Erase their details', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => { eraseHolding.value = h } })
  return [actions]
}

const holdingColumns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'email', header: 'Email' },
  { accessorKey: 'passName', header: 'Pass' },
  { id: 'left', header: 'Left' },
  { id: 'expires', header: 'Use by' },
  { id: 'paid', header: 'Paid' },
  { id: 'actions', header: actionsHeader },
]
</script>

<template>
  <div class="max-w-5xl mx-auto space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-bold text-gray-900 dark:text-white">Class passes</h1>
        <p class="text-sm text-gray-500 dark:text-gray-400">Blocks of sessions people buy without an account, and use on any paid event that allows them.</p>
      </div>
      <UButton size="sm" icon="i-lucide-plus" @click="newPass">New pass</UButton>
    </div>

    <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-circle-alert" :description="getErrorMessage(error, 'Could not load class passes')" />

    <div v-if="data" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <UCard v-for="pass in data.passes" :key="pass.id">
        <div class="flex items-start justify-between gap-2">
          <p class="font-semibold">{{ pass.name }}</p>
          <UBadge :color="pass.isActive ? 'success' : 'neutral'" variant="soft" size="xs">{{ pass.isActive ? 'On sale' : 'Off sale' }}</UBadge>
        </div>
        <p class="text-2xl font-bold mt-1">{{ formatPrice(pass.price, pass.currency) }}</p>
        <p class="text-sm text-gray-500 dark:text-gray-400">
          {{ pass.credits === 1 ? '1 session' : `${pass.credits} sessions` }}, {{ pass.validDays ? `valid ${pass.validDays} days` : 'never expires' }}
        </p>
        <div class="flex flex-wrap gap-2 mt-3">
          <UButton size="xs" variant="outline" color="neutral" @click="editPass(pass)">Edit</UButton>
          <UButton size="xs" variant="outline" color="neutral" :loading="isRunning(`pass:${pass.id}`)" @click="setActive(pass, !pass.isActive)">{{ pass.isActive ? 'Take off sale' : 'Put on sale' }}</UButton>
          <UButton size="xs" variant="ghost" color="error" @click="deletePass = pass">Delete</UButton>
        </div>
      </UCard>
    </div>
    <p v-if="data && data.passes.length === 0" class="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">No passes yet. Add one, then put the Class Passes block on a page.</p>

    <UCard>
      <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 class="font-semibold">Who holds what</h2>
        <div class="flex items-center gap-2">
          <form class="flex gap-2" @submit.prevent="refresh()">
            <UInput v-model="search" size="sm" placeholder="Name or email" aria-label="Search holders" />
            <UButton type="submit" size="sm" variant="outline" color="neutral">Search</UButton>
          </form>
          <UButton size="sm" variant="outline" icon="i-lucide-user-plus" :disabled="!data?.passes.length" @click="openGrant">Add for someone</UButton>
        </div>
      </div>
      <p v-if="data && data.holdings.length === 0" class="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">Nobody here yet.</p>
      <UTable v-else :data="data?.holdings ?? []" :columns="holdingColumns">
        <template #left-cell="{ row }">
          <UBadge v-if="row.original.status === 'refunded'" color="neutral" variant="soft" size="xs">Refunded</UBadge>
          <span v-else>{{ left(row.original) }} of {{ row.original.creditsTotal }}</span>
        </template>
        <template #expires-cell="{ row }">
          <span class="text-sm text-gray-400">{{ row.original.expiresAt ? formatLocalDate(row.original.expiresAt) : 'No limit' }}</span>
        </template>
        <template #paid-cell="{ row }">
          <span class="text-sm">{{ row.original.stripePaymentIntentId ? formatPrice(row.original.amountPaid, row.original.currency) : 'Added by hand' }}</span>
          <span v-if="row.original.amountRefunded > 0" class="block text-xs text-gray-400">{{ formatPrice(row.original.amountRefunded, row.original.currency) }} refunded</span>
        </template>
        <template #actions-cell="{ row }">
          <div class="flex justify-end">
            <UDropdownMenu :items="holdingActions(row.original)">
              <UButton variant="ghost" size="xs" icon="i-lucide-ellipsis" :aria-label="`Actions for ${row.original.name || row.original.email}`" />
            </UDropdownMenu>
          </div>
        </template>
      </UTable>
    </UCard>

    <UModal v-model:open="passOpen" :title="editingId ? 'Edit pass' : 'New pass'" description="People who already bought keep what they bought, whatever you change here.">
      <template #body>
        <form id="pass-form" class="space-y-3" @submit.prevent="savePass">
          <UFormField label="Name" required><UInput v-model="passForm.name" required maxlength="100" placeholder="10 class pass" class="w-full" /></UFormField>
          <UFormField label="Description"><UTextarea v-model="passForm.description" maxlength="500" :rows="2" class="w-full" /></UFormField>
          <div class="grid grid-cols-3 gap-3">
            <UFormField label="Sessions" required><UInput v-model.number="passForm.credits" type="number" min="1" max="1000" required class="w-full" /></UFormField>
            <UFormField label="Price" required><UInput v-model.number="passForm.price" type="number" min="0.5" step="0.01" required class="w-full" /></UFormField>
            <UFormField label="Currency" required><UInput v-model="passForm.currency" maxlength="3" required class="w-full uppercase" /></UFormField>
          </div>
          <UFormField label="Valid for (days)" hint="Blank: never expires"><UInput v-model.number="passForm.validDays" type="number" min="1" max="3650" class="w-32" /></UFormField>
        </form>
      </template>
      <template #footer>
        <UButton variant="outline" color="neutral" @click="passOpen = false">Cancel</UButton>
        <UButton type="submit" form="pass-form" :loading="isRunning('save-pass')">Save</UButton>
      </template>
    </UModal>

    <UModal v-model:open="grantOpen" title="Add a pass for someone" description="For a pass sold in person. No money is taken here, and they're emailed how to use it.">
      <template #body>
        <form id="grant-form" class="space-y-3" @submit.prevent="grant">
          <UFormField label="Pass" required><USelect v-model="grantForm.passId" :items="passOptions" class="w-full" /></UFormField>
          <UFormField label="Name" required><UInput v-model="grantForm.name" required maxlength="100" class="w-full" /></UFormField>
          <UFormField label="Email" required><UInput v-model="grantForm.email" type="email" required maxlength="254" class="w-full" /></UFormField>
        </form>
      </template>
      <template #footer>
        <UButton variant="outline" color="neutral" @click="grantOpen = false">Cancel</UButton>
        <UButton type="submit" form="grant-form" :loading="isRunning('grant')">Add</UButton>
      </template>
    </UModal>

    <UModal
      v-model:open="refundOpen"
      :title="refundHolding?.stripePaymentIntentId ? 'Refund unused sessions?' : 'Close this pass?'"
      :description="refundHolding?.stripePaymentIntentId
        ? `${refundHolding.name || refundHolding.email} gets ${formatPrice(refundValue, refundHolding.currency)} back for ${left(refundHolding)} unused ${left(refundHolding) === 1 ? 'session' : 'sessions'}, and the pass stops working.`
        : 'It was added by hand, so no money moves. The pass just stops working.'"
    >
      <template #footer>
        <UButton variant="outline" color="neutral" @click="refundOpen = false">Keep</UButton>
        <UButton color="error" :loading="isRunning('refund')" @click="confirmRefund">{{ refundHolding?.stripePaymentIntentId ? 'Refund' : 'Close it' }}</UButton>
      </template>
    </UModal>

    <UModal v-model:open="deleteOpen" title="Delete this pass?" :description="deletePass ? `${deletePass.name} comes off sale for good. People who already bought it keep what they bought.` : ''">
      <template #footer>
        <UButton variant="outline" color="neutral" @click="deleteOpen = false">Keep</UButton>
        <UButton color="error" :loading="isRunning('delete-pass')" @click="confirmDeletePass">Delete</UButton>
      </template>
    </UModal>

    <UModal v-model:open="eraseOpen" title="Erase these details?" :description="eraseHolding ? `${eraseHolding.name || eraseHolding.email}'s record of this pass will be removed for good.` : ''">
      <template #footer>
        <UButton variant="outline" color="neutral" @click="eraseOpen = false">Keep</UButton>
        <UButton color="error" :loading="isRunning('erase')" @click="confirmErase">Erase</UButton>
      </template>
    </UModal>
  </div>
</template>
