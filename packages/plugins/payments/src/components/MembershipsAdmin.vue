<script setup lang="ts">
const toast = useToast()

// ── Types ────────────────────────────────────────────────────────────────────

interface Tier {
  id: string
  name: string
  description: string | null
  price: number
  currency: string
  interval: 'month' | 'year' | 'one_time'
  features: string[]
  isActive: boolean
  createdAt: string
}

interface Subscriber {
  id: string
  userName: string | null
  userEmail: string | null
  tierName: string | null
  provider: string
  status: string
  currentPeriodEnd: string | null
  createdAt: string
}

// ── State ─────────────────────────────────────────────────────────────────────

const activeTab = ref<'tiers' | 'subscribers'>('tiers')

const { data: tiersData, refresh: refreshTiers } = await useFetch<{ tiers: Tier[] }>('/api/v1/memberships')
const tiers = computed(() => tiersData.value?.tiers ?? [])

const { data: subsData, refresh: refreshSubs } = await useFetch<{ subscribers: Subscriber[] }>('/api/v1/memberships/subscribers')
const subscribers = computed(() => subsData.value?.subscribers ?? [])

// ── Tier form ─────────────────────────────────────────────────────────────────

const showTierModal = ref(false)
const editingTier = ref<Tier | null>(null)
const tierLoading = ref(false)

const tierForm = reactive({
  name: '',
  description: '',
  price: 0,
  currency: 'USD',
  interval: 'month' as 'month' | 'year' | 'one_time',
  features: [] as string[],
  isActive: true,
})

const featureInput = ref('')

function openNewTier() {
  editingTier.value = null
  Object.assign(tierForm, { name: '', description: '', price: 0, currency: 'USD', interval: 'month', features: [], isActive: true })
  showTierModal.value = true
}

function openEditTier(tier: Tier) {
  editingTier.value = tier
  Object.assign(tierForm, {
    name: tier.name,
    description: tier.description ?? '',
    price: tier.price,
    currency: tier.currency,
    interval: tier.interval,
    features: [...tier.features],
    isActive: tier.isActive,
  })
  showTierModal.value = true
}

function addFeature() {
  const f = featureInput.value.trim()
  if (f && !tierForm.features.includes(f)) tierForm.features.push(f)
  featureInput.value = ''
}

function removeFeature(idx: number) {
  tierForm.features.splice(idx, 1)
}

async function saveTier() {
  tierLoading.value = true
  try {
    const body = {
      name: tierForm.name,
      description: tierForm.description || undefined,
      price: tierForm.price,
      currency: tierForm.currency,
      interval: tierForm.interval,
      features: tierForm.features,
      isActive: tierForm.isActive,
    }
    if (editingTier.value) {
      await $fetch(`/api/v1/memberships/${editingTier.value.id}`, { method: 'PATCH', body })
      toast.add({ title: 'Tier updated', color: 'green' })
    } else {
      await $fetch('/api/v1/memberships', { method: 'POST', body })
      toast.add({ title: 'Tier created', color: 'green' })
    }
    await refreshTiers()
    showTierModal.value = false
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Save failed'
    toast.add({ title: msg, color: 'red' })
  } finally {
    tierLoading.value = false
  }
}

async function deleteTier(tier: Tier) {
  if (!confirm(`Delete "${tier.name}"? Existing subscribers will not be affected.`)) return
  try {
    await $fetch(`/api/v1/memberships/${tier.id}`, { method: 'DELETE' })
    await refreshTiers()
    toast.add({ title: 'Tier deleted', color: 'green' })
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Delete failed'
    toast.add({ title: msg, color: 'red' })
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const INTERVAL_LABELS: Record<string, string> = { month: 'mo', year: 'yr', one_time: 'once' }

const statusColor: Record<string, 'green' | 'yellow' | 'red' | 'neutral'> = {
  active: 'green',
  trialing: 'yellow',
  past_due: 'red',
  cancelled: 'neutral',
  unpaid: 'red',
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

const tabs = [
  { key: 'tiers', label: 'Tiers', icon: 'i-lucide-credit-card' },
  { key: 'subscribers', label: 'Subscribers', icon: 'i-lucide-users' },
] as const
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-bold text-gray-900 dark:text-white">Memberships</h1>
    </div>

    <!-- Tabs -->
    <div class="flex gap-1 border-b border-gray-200 dark:border-gray-700">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px"
        :class="activeTab === tab.key
          ? 'border-primary-500 text-primary-600 dark:text-primary-400'
          : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'"
        @click="activeTab = tab.key"
      >
        <UIcon :name="tab.icon" class="w-4 h-4" />
        {{ tab.label }}
      </button>
    </div>

    <!-- Tiers tab -->
    <div v-if="activeTab === 'tiers'" class="space-y-4">
      <div class="flex justify-end">
        <UButton icon="i-lucide-plus" size="sm" @click="openNewTier">New tier</UButton>
      </div>

      <div v-if="tiers.length === 0" class="text-center py-16 text-gray-400">
        <UIcon name="i-lucide-credit-card" class="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p class="text-sm">No membership tiers yet. Create one to get started.</p>
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <UCard v-for="tier in tiers" :key="tier.id">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <p class="font-semibold text-gray-900 dark:text-white">{{ tier.name }}</p>
                <UBadge :color="tier.isActive ? 'green' : 'neutral'" variant="soft" size="xs">
                  {{ tier.isActive ? 'Active' : 'Inactive' }}
                </UBadge>
              </div>
              <p class="text-2xl font-bold text-primary-500 mt-1">
                {{ tier.currency }}{{ tier.price.toFixed(2) }}
                <span class="text-sm font-normal text-gray-400">/ {{ INTERVAL_LABELS[tier.interval] }}</span>
              </p>
              <p v-if="tier.description" class="text-xs text-gray-400 mt-1">{{ tier.description }}</p>
              <ul v-if="tier.features.length" class="mt-2 space-y-0.5">
                <li v-for="feat in tier.features" :key="feat" class="flex items-center gap-1.5 text-xs text-gray-500">
                  <UIcon name="i-lucide-check" class="w-3 h-3 text-primary-500 shrink-0" />
                  {{ feat }}
                </li>
              </ul>
            </div>
            <div class="flex gap-1 shrink-0">
              <UButton size="xs" variant="ghost" icon="i-lucide-pencil" @click="openEditTier(tier)" />
              <UButton size="xs" variant="ghost" color="red" icon="i-lucide-trash-2" @click="deleteTier(tier)" />
            </div>
          </div>
        </UCard>
      </div>
    </div>

    <!-- Subscribers tab -->
    <div v-if="activeTab === 'subscribers'">
      <div v-if="subscribers.length === 0" class="text-center py-16 text-gray-400">
        <UIcon name="i-lucide-users" class="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p class="text-sm">No subscribers yet.</p>
      </div>

      <div v-else class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700">
              <th class="text-left py-2 px-3 font-medium text-gray-500">User</th>
              <th class="text-left py-2 px-3 font-medium text-gray-500">Tier</th>
              <th class="text-left py-2 px-3 font-medium text-gray-500">Provider</th>
              <th class="text-left py-2 px-3 font-medium text-gray-500">Status</th>
              <th class="text-left py-2 px-3 font-medium text-gray-500">Renews</th>
              <th class="text-left py-2 px-3 font-medium text-gray-500">Joined</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="sub in subscribers"
              :key="sub.id"
              class="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900/30"
            >
              <td class="py-2 px-3">
                <p class="font-medium text-gray-900 dark:text-white">{{ sub.userName ?? '—' }}</p>
                <p class="text-xs text-gray-400">{{ sub.userEmail }}</p>
              </td>
              <td class="py-2 px-3 text-gray-600 dark:text-gray-300">{{ sub.tierName ?? '—' }}</td>
              <td class="py-2 px-3">
                <UBadge color="neutral" variant="soft" size="xs" class="capitalize">{{ sub.provider }}</UBadge>
              </td>
              <td class="py-2 px-3">
                <UBadge :color="statusColor[sub.status] ?? 'neutral'" variant="soft" size="xs" class="capitalize">{{ sub.status }}</UBadge>
              </td>
              <td class="py-2 px-3 text-gray-500">{{ formatDate(sub.currentPeriodEnd) }}</td>
              <td class="py-2 px-3 text-gray-500">{{ formatDate(sub.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Tier modal -->
    <UModal v-model:open="showTierModal" :title="editingTier ? 'Edit tier' : 'New membership tier'" :ui="{ content: 'max-w-lg' }">
      <template #body>
        <form class="space-y-4" @submit.prevent="saveTier">
          <UFormField label="Name" required>
            <UInput v-model="tierForm.name" placeholder="e.g. Pro" class="w-full" required />
          </UFormField>

          <UFormField label="Description">
            <UInput v-model="tierForm.description" placeholder="Optional description" class="w-full" />
          </UFormField>

          <div class="grid grid-cols-3 gap-3">
            <UFormField label="Price" required>
              <UInput v-model.number="tierForm.price" type="number" min="0" step="0.01" class="w-full" required />
            </UFormField>
            <UFormField label="Currency">
              <UInput v-model="tierForm.currency" placeholder="USD" maxlength="3" class="w-full" />
            </UFormField>
            <UFormField label="Interval">
              <USelect
                v-model="tierForm.interval"
                :items="[{ label: 'Monthly', value: 'month' }, { label: 'Yearly', value: 'year' }, { label: 'One-time', value: 'one_time' }]"
                class="w-full"
              />
            </UFormField>
          </div>

          <UFormField label="Features">
            <div class="space-y-2">
              <div class="flex gap-2">
                <UInput v-model="featureInput" placeholder="Add a feature" class="flex-1" @keydown.enter.prevent="addFeature" />
                <UButton type="button" variant="outline" icon="i-lucide-plus" @click="addFeature" />
              </div>
              <div class="flex flex-wrap gap-1">
                <UBadge
                  v-for="(feat, idx) in tierForm.features"
                  :key="feat"
                  color="neutral"
                  variant="soft"
                  class="cursor-pointer"
                  @click="removeFeature(idx)"
                >
                  {{ feat }} <UIcon name="i-lucide-x" class="w-3 h-3 ml-1" />
                </UBadge>
              </div>
            </div>
          </UFormField>

          <UFormField>
            <UCheckbox v-model="tierForm.isActive" label="Active (visible to users)" />
          </UFormField>

          <div class="flex justify-end gap-2 pt-2">
            <UButton variant="ghost" type="button" @click="showTierModal = false">Cancel</UButton>
            <UButton type="submit" :loading="tierLoading">{{ editingTier ? 'Save changes' : 'Create tier' }}</UButton>
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
