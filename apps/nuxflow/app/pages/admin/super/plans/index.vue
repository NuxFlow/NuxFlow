<script setup lang="ts">
import { PLAN_FEATURES, PLAN_LIMITS, type PlanFeatureColumn, type PlanLimitColumn } from '#shared/lib/hosting-plan-limits'

definePageMeta({ layout: 'admin', middleware: ['auth'] })
useHead({ title: 'Plans' })

type Plan = {
  id: string
  name: string
  description: string
  priceText: string
  sortOrder: number
  siteCount: number
  isPublic: boolean
  priceMonthly: number | null
  priceYearly: number | null
  currency: string
  trialDays: number
  defaultPoolId: string | null
  stripePriceMonthlyId: string | null
  stripePriceYearlyId: string | null
} & Record<PlanLimitColumn, number | null> & Record<PlanFeatureColumn, boolean>

const { data, pending, error, refresh } = await useFetch<{ plans: Plan[] }>('/api/v1/admin/plans')
// Member pools a plan's sign-ups can get their site in (Super Admin → Pools).
const { data: siteData } = await useFetch<{ pools: string[] }>('/api/v1/admin/sites')
const HERE = '__control_panel__'
const poolItems = computed(() => [
  { label: 'This control panel', value: HERE },
  ...(siteData.value?.pools ?? []).map(id => ({ label: `Pool: ${id}`, value: id })),
])
const plans = computed(() => data.value?.plans ?? [])

const HARD = PLAN_LIMITS.filter(l => l.kind === 'hard')
const SOFT = PLAN_LIMITS.filter(l => l.kind === 'soft')

const GB = 1024 ** 3
const MB = 1024 ** 2

function formatLimit(limit: typeof PLAN_LIMITS[number], value: number | null): string {
  if (value === null) return 'Unlimited'
  if (limit.unit === 'bytes') return value >= GB ? `${+(value / GB).toFixed(2)} GB` : `${+(value / MB).toFixed(1)} MB`
  return value.toLocaleString()
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency.toUpperCase() }).format(amount)
  } catch {
    return `${amount} ${currency.toUpperCase()}`
  }
}

function setLimits(plan: Plan) {
  return PLAN_LIMITS.filter(l => plan[l.column] !== null)
}

function includedFeatures(plan: Plan) {
  return PLAN_FEATURES.filter(f => plan[f.column])
}

// ── Editor ────────────────────────────────────────────────────────────────────
const isEditOpen = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const saveError = ref('')
const form = reactive({
  name: '',
  description: '',
  priceText: '',
  sortOrder: 0,
  isPublic: false,
  priceMonthly: '',
  priceYearly: '',
  currency: 'gbp',
  trialDays: '0',
  defaultPool: '__control_panel__',
  // Every limit as text, so an empty box can mean "unlimited".
  limits: {} as Record<PlanLimitColumn, string>,
  // MB or GB, for each limit measured in bytes.
  units: {} as Record<PlanLimitColumn, 'MB' | 'GB'>,
  features: {} as Record<PlanFeatureColumn, boolean>,
})

function openEditor(plan?: Plan) {
  editingId.value = plan?.id ?? null
  form.name = plan?.name ?? ''
  form.description = plan?.description ?? ''
  form.priceText = plan?.priceText ?? ''
  form.sortOrder = plan?.sortOrder ?? plans.value.length
  form.isPublic = plan?.isPublic ?? false
  form.priceMonthly = plan?.priceMonthly != null ? String(plan.priceMonthly) : ''
  form.priceYearly = plan?.priceYearly != null ? String(plan.priceYearly) : ''
  form.currency = plan?.currency ?? 'gbp'
  form.trialDays = String(plan?.trialDays ?? 0)
  form.defaultPool = plan?.defaultPoolId ?? HERE
  for (const l of PLAN_LIMITS) {
    const value = plan?.[l.column] ?? null
    if (l.unit === 'bytes') form.units[l.column] = value !== null && value < GB ? 'MB' : 'GB'
    form.limits[l.column] = value === null
      ? ''
      : l.unit === 'bytes' ? String(+(value / (form.units[l.column] === 'GB' ? GB : MB)).toFixed(2)) : String(value)
  }
  for (const f of PLAN_FEATURES) form.features[f.column] = plan?.[f.column] ?? false
  saveError.value = ''
  isEditOpen.value = true
}

/** Blank → null (unlimited); otherwise a non-negative whole number (bytes for storage). */
function parsedLimits(): Record<PlanLimitColumn, number | null> | string {
  const out = {} as Record<PlanLimitColumn, number | null>
  for (const l of PLAN_LIMITS) {
    const raw = form.limits[l.column]?.trim() ?? ''
    if (raw === '') {
      out[l.column] = null
      continue
    }
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0) return `${l.label} must be a number, or blank for unlimited.`
    if (l.unit === 'bytes') out[l.column] = Math.round(n * (form.units[l.column] === 'GB' ? GB : MB))
    else if (!Number.isInteger(n)) return `${l.label} must be a whole number.`
    else out[l.column] = n
  }
  return out
}

/** Blank → null (not offered); otherwise a price with at most two decimals. */
function parsedPrice(raw: string, label: string): number | null | string {
  const v = raw.trim()
  if (v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0.5) return `${label} must be at least 0.50, or blank.`
  return Math.round(n * 100) / 100
}

async function savePlan() {
  const limits = parsedLimits()
  if (typeof limits === 'string') {
    saveError.value = limits
    return
  }
  const priceMonthly = parsedPrice(form.priceMonthly, 'Monthly price')
  const priceYearly = parsedPrice(form.priceYearly, 'Yearly price')
  const trialDays = Number(form.trialDays || 0)
  for (const v of [priceMonthly, priceYearly]) {
    if (typeof v === 'string') {
      saveError.value = v
      return
    }
  }
  if (!Number.isInteger(trialDays) || trialDays < 0 || trialDays > 90) {
    saveError.value = 'Free trial must be a whole number of days, 0 to 90.'
    return
  }
  if (form.isPublic && priceMonthly === null && priceYearly === null) {
    saveError.value = 'Give the plan a monthly or yearly price before offering it on the sign-up page.'
    return
  }
  saving.value = true
  saveError.value = ''
  try {
    const body = {
      name: form.name,
      description: form.description,
      priceText: form.priceText,
      sortOrder: form.sortOrder,
      isPublic: form.isPublic,
      priceMonthly,
      priceYearly,
      currency: form.currency,
      trialDays,
      defaultPoolId: form.defaultPool === HERE ? null : form.defaultPool,
      ...limits,
      ...form.features,
    }
    const url: string = editingId.value ? `/api/v1/admin/plans/${editingId.value}` : '/api/v1/admin/plans'
    await $fetch(url, { method: editingId.value ? 'PATCH' : 'POST', body })
    isEditOpen.value = false
    await refresh()
  } catch (e: unknown) {
    saveError.value = getErrorMessage(e, 'Could not save the plan')
  } finally {
    saving.value = false
  }
}

// ── Delete ────────────────────────────────────────────────────────────────────
const deleting = ref<Plan | null>(null)
const deleteBusy = ref(false)
const isDeleteOpen = computed({ get: () => !!deleting.value, set: (v) => { if (!v) deleting.value = null } })

async function deletePlan() {
  if (!deleting.value) return
  deleteBusy.value = true
  try {
    const url: string = `/api/v1/admin/plans/${deleting.value.id}`
    await $fetch(url, { method: 'DELETE' })
    deleting.value = null
    await refresh()
  } catch (e: unknown) {
    alert(getErrorMessage(e, 'Could not delete the plan'))
  } finally {
    deleteBusy.value = false
  }
}
</script>

<template>
  <div class="max-w-5xl mx-auto space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Plans</h1>
        <p class="text-sm text-gray-500 mt-0.5">Hosting plans you offer to site owners. A site with no plan is unlimited.</p>
      </div>
      <UButton icon="i-lucide-plus" @click="openEditor()">New plan</UButton>
    </div>

    <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-circle-alert" :description="getErrorMessage(error, 'Could not load plans')" />

    <UCard v-else-if="!pending && !plans.length">
      <div class="text-center py-6 space-y-2">
        <p class="font-medium text-gray-900 dark:text-white">No plans yet</p>
        <p class="text-sm text-gray-500 max-w-md mx-auto">
          Every site is on the built-in Unlimited plan. Create a plan, then choose it for a site in Super Admin → Sites.
          Super Admin → Usage shows what each site uses, to help you pick numbers.
        </p>
      </div>
    </UCard>

    <div v-else class="grid gap-4 md:grid-cols-2">
      <UCard v-for="plan in plans" :key="plan.id">
        <div class="space-y-3">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="font-semibold text-gray-900 dark:text-white">{{ plan.name }}</p>
              <p v-if="plan.priceText" class="text-sm text-gray-500">{{ plan.priceText }}</p>
              <div class="flex flex-wrap gap-1.5 mt-1.5">
                <UBadge v-if="plan.isPublic" size="sm" variant="subtle" color="success" icon="i-lucide-store">On sign-up page</UBadge>
                <UBadge v-if="plan.priceMonthly != null" size="sm" variant="outline" color="neutral">{{ money(plan.priceMonthly, plan.currency) }} / month</UBadge>
                <UBadge v-if="plan.priceYearly != null" size="sm" variant="outline" color="neutral">{{ money(plan.priceYearly, plan.currency) }} / year</UBadge>
                <UBadge v-if="plan.trialDays" size="sm" variant="outline" color="neutral">{{ plan.trialDays }}-day trial</UBadge>
              </div>
            </div>
            <UBadge variant="subtle" :color="plan.siteCount ? 'primary' : 'neutral'">
              {{ plan.siteCount }} {{ plan.siteCount === 1 ? 'site' : 'sites' }}
            </UBadge>
          </div>
          <p v-if="plan.description" class="text-sm text-gray-600 dark:text-gray-400">{{ plan.description }}</p>
          <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <template v-for="l in setLimits(plan)" :key="l.key">
              <dt class="text-gray-500">{{ l.label }}<span v-if="l.kind === 'soft'" class="text-xs text-gray-400"> (soft)</span></dt>
              <dd class="text-right tabular-nums text-gray-900 dark:text-white">{{ formatLimit(l, plan[l.column]) }}</dd>
            </template>
          </dl>
          <p v-if="!setLimits(plan).length" class="text-sm text-gray-400">No limits set — works like Unlimited.</p>
          <div v-if="includedFeatures(plan).length" class="flex flex-wrap gap-1.5">
            <UBadge v-for="f in includedFeatures(plan)" :key="f.key" size="sm" variant="subtle" color="neutral" icon="i-lucide-check">{{ f.label }}</UBadge>
          </div>
          <div class="flex justify-end gap-1.5 pt-1">
            <UButton variant="ghost" size="sm" icon="i-lucide-pencil" @click="openEditor(plan)">Edit</UButton>
            <UButton variant="ghost" size="sm" color="error" icon="i-lucide-trash-2" @click="deleting = plan">Delete</UButton>
          </div>
        </div>
      </UCard>
    </div>

    <UModal v-model:open="isEditOpen" :title="editingId ? 'Edit plan' : 'New plan'" :ui="{ content: 'sm:max-w-2xl' }">
      <template #body>
        <div class="space-y-5">
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="Name" required>
              <UInput v-model="form.name" placeholder="Starter" class="w-full" />
            </UFormField>
            <UFormField label="Price label" help="Optional text shown with the plan, e.g. &quot;Most popular&quot;.">
              <UInput v-model="form.priceText" placeholder="Most popular" class="w-full" />
            </UFormField>
          </div>
          <UFormField label="Description">
            <UTextarea v-model="form.description" :rows="2" class="w-full" />
          </UFormField>

          <div class="space-y-3 rounded-lg border border-gray-200 dark:border-gray-800 p-4">
            <div>
              <p class="text-sm font-semibold text-gray-900 dark:text-white">Selling this plan</p>
              <p class="text-xs text-gray-500">
                NuxFlow creates the product and prices in your Stripe account (the main site's Settings → Payments keys).
                Leave a price blank to not offer that option. Changing a price only affects new sign-ups; existing customers keep their price.
              </p>
            </div>
            <div class="grid gap-3 sm:grid-cols-4">
              <UFormField label="Monthly price">
                <UInput v-model="form.priceMonthly" inputmode="decimal" placeholder="e.g. 5" class="w-full" />
              </UFormField>
              <UFormField label="Yearly price">
                <UInput v-model="form.priceYearly" inputmode="decimal" placeholder="e.g. 50" class="w-full" />
              </UFormField>
              <UFormField label="Currency">
                <USelect v-model="form.currency" :items="[{ label: 'GBP £', value: 'gbp' }, { label: 'EUR €', value: 'eur' }, { label: 'USD $', value: 'usd' }]" class="w-full" />
              </UFormField>
              <UFormField label="Free trial (days)" help="Card taken at sign-up.">
                <UInput v-model="form.trialDays" inputmode="numeric" placeholder="0" class="w-full" />
              </UFormField>
            </div>
            <UCheckbox v-model="form.isPublic" label="Offer on the sign-up page" description="Customers can choose this plan themselves. Untick to keep it for sites you set up by hand." />
            <UFormField
              v-if="poolItems.length > 1"
              label="Sign-ups get their site in"
              help="Where a customer who signs up on this plan gets their site. If that pool isn't connected, they get it here and you're told."
            >
              <USelect v-model="form.defaultPool" :items="poolItems" class="w-full" />
            </UFormField>
          </div>

          <div class="space-y-3">
            <div>
              <p class="text-sm font-semibold text-gray-900 dark:text-white">Hard limits</p>
              <p class="text-xs text-gray-500">The action that would go over is refused with a clear message. Leave a box empty for unlimited.</p>
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <UFormField v-for="l in HARD" :key="l.key" :label="l.label" :help="l.hint">
                <div class="flex gap-2">
                  <UInput v-model="form.limits[l.column]" inputmode="decimal" placeholder="Unlimited" class="w-full" />
                  <USelect v-if="l.unit === 'bytes'" v-model="form.units[l.column]" :items="['MB', 'GB']" class="w-24" />
                </div>
              </UFormField>
            </div>
          </div>

          <div class="space-y-3">
            <div>
              <p class="text-sm font-semibold text-gray-900 dark:text-white">Soft limits</p>
              <p class="text-xs text-gray-500">Never blocked. You get a notification when a site reaches 80% and 100% in a month.</p>
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <UFormField v-for="l in SOFT" :key="l.key" :label="l.label" :help="l.hint">
                <div class="flex gap-2">
                  <UInput v-model="form.limits[l.column]" inputmode="decimal" placeholder="Unlimited" class="w-full" />
                  <USelect v-if="l.unit === 'bytes'" v-model="form.units[l.column]" :items="['MB', 'GB']" class="w-24" />
                </div>
              </UFormField>
            </div>
          </div>

          <div class="space-y-3">
            <div>
              <p class="text-sm font-semibold text-gray-900 dark:text-white">Included features</p>
              <p class="text-xs text-gray-500">Features that cost you money per use. Off unless ticked.</p>
            </div>
            <UCheckbox v-for="f in PLAN_FEATURES" :key="f.key" v-model="form.features[f.column]" :label="f.label" :description="f.hint" />
          </div>

          <UAlert v-if="saveError" color="error" variant="soft" :description="saveError" />
        </div>
      </template>
      <template #footer>
        <UButton variant="ghost" @click="isEditOpen = false">Cancel</UButton>
        <UButton :loading="saving" :disabled="!form.name.trim()" @click="savePlan">{{ editingId ? 'Save changes' : 'Create plan' }}</UButton>
      </template>
    </UModal>

    <UModal v-model:open="isDeleteOpen" title="Delete plan">
      <template #body>
        <p class="text-sm text-gray-600 dark:text-gray-300">
          Delete <strong class="text-gray-900 dark:text-white">{{ deleting?.name }}</strong>?
          <template v-if="deleting?.siteCount">
            Its {{ deleting.siteCount }} {{ deleting.siteCount === 1 ? 'site goes' : 'sites go' }} back to the Unlimited plan.
          </template>
        </p>
      </template>
      <template #footer>
        <UButton variant="ghost" @click="deleting = null">Cancel</UButton>
        <UButton color="error" :loading="deleteBusy" @click="deletePlan">Delete plan</UButton>
      </template>
    </UModal>
  </div>
</template>
