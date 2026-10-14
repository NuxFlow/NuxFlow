<script setup lang="ts">
import { PLAN_LIMITS, type PlanLimitColumn } from '#shared/lib/hosting-plan-limits'

definePageMeta({ layout: 'admin', middleware: ['auth'] })
useHead({ title: 'Plans' })

type Plan = {
  id: string
  name: string
  description: string
  priceText: string
  sortOrder: number
  siteCount: number
} & Record<PlanLimitColumn, number | null>

const { data, pending, error, refresh } = await useFetch<{ plans: Plan[] }>('/api/v1/admin/plans')
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

function setLimits(plan: Plan) {
  return PLAN_LIMITS.filter(l => plan[l.column] !== null)
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
  // Every limit as text, so an empty box can mean "unlimited".
  limits: {} as Record<PlanLimitColumn, string>,
  storageUnit: 'GB' as 'MB' | 'GB',
})

function openEditor(plan?: Plan) {
  editingId.value = plan?.id ?? null
  form.name = plan?.name ?? ''
  form.description = plan?.description ?? ''
  form.priceText = plan?.priceText ?? ''
  form.sortOrder = plan?.sortOrder ?? plans.value.length
  const storage = plan?.maxStorageBytes ?? null
  form.storageUnit = storage !== null && storage < GB ? 'MB' : 'GB'
  for (const l of PLAN_LIMITS) {
    const value = plan?.[l.column] ?? null
    form.limits[l.column] = value === null
      ? ''
      : l.unit === 'bytes' ? String(+(value / (form.storageUnit === 'GB' ? GB : MB)).toFixed(2)) : String(value)
  }
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
    if (l.unit === 'bytes') out[l.column] = Math.round(n * (form.storageUnit === 'GB' ? GB : MB))
    else if (!Number.isInteger(n)) return `${l.label} must be a whole number.`
    else out[l.column] = n
  }
  return out
}

async function savePlan() {
  const limits = parsedLimits()
  if (typeof limits === 'string') {
    saveError.value = limits
    return
  }
  saving.value = true
  saveError.value = ''
  try {
    const body = { name: form.name, description: form.description, priceText: form.priceText, sortOrder: form.sortOrder, ...limits }
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
            <UFormField label="Price" help="Shown only. Payment is separate.">
              <UInput v-model="form.priceText" placeholder="£5 a month" class="w-full" />
            </UFormField>
          </div>
          <UFormField label="Description">
            <UTextarea v-model="form.description" :rows="2" class="w-full" />
          </UFormField>

          <div class="space-y-3">
            <div>
              <p class="text-sm font-semibold text-gray-900 dark:text-white">Hard limits</p>
              <p class="text-xs text-gray-500">The action that would go over is refused with a clear message. Leave a box empty for unlimited.</p>
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <UFormField v-for="l in HARD" :key="l.key" :label="l.label" :help="l.hint">
                <div class="flex gap-2">
                  <UInput v-model="form.limits[l.column]" inputmode="decimal" placeholder="Unlimited" class="w-full" />
                  <USelect v-if="l.unit === 'bytes'" v-model="form.storageUnit" :items="['MB', 'GB']" class="w-24" />
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
              <UFormField v-for="l in SOFT" :key="l.key" :label="l.label">
                <UInput v-model="form.limits[l.column]" inputmode="numeric" placeholder="Unlimited" class="w-full" />
              </UFormField>
            </div>
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
