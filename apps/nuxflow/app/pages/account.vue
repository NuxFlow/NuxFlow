<script setup lang="ts">
definePageMeta({ layout: 'default', middleware: ['auth'] })

interface Tier {
  id: string
  name: string
  price: number
  currency: string
  interval: string
  features: string[]
}

interface Subscription {
  id: string
  status: 'active' | 'trialing' | 'past_due' | 'cancelled' | 'unpaid'
  provider: string
  currentPeriodEnd: string | null
  cancelledAt: string | null
}

interface AccountData {
  subscription: Subscription | null
  tier: Tier | null
}

const { user } = useUserSession()

const { data } = await useFetch<AccountData>('/api/v1/account/subscription', {
  headers: useRequestHeaders(['cookie']),
})

const subscription = computed(() => data.value?.subscription ?? null)
const tier = computed(() => data.value?.tier ?? null)

const managingBilling = ref(false)
const toast = useToast()

const statusColor = computed(() => {
  switch (subscription.value?.status) {
    case 'active': return 'green'
    case 'trialing': return 'blue'
    case 'past_due': return 'orange'
    case 'cancelled': return 'red'
    default: return 'gray'
  }
})

const statusLabel = computed(() => {
  switch (subscription.value?.status) {
    case 'active': return 'Active'
    case 'trialing': return 'Trial'
    case 'past_due': return 'Past due'
    case 'cancelled': return 'Cancelled'
    case 'unpaid': return 'Unpaid'
    default: return 'No subscription'
  }
})

async function manageBilling() {
  managingBilling.value = true
  try {
    const { url } = await $fetch<{ url: string }>('/api/v1/memberships/billing-portal', {
      method: 'POST',
      body: { returnUrl: window.location.href },
    })
    window.location.href = url
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Could not open billing portal'
    toast.add({ title: msg, color: 'red' })
  } finally {
    managingBilling.value = false
  }
}

function formatPrice(price: number, currency: string) {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).format(price)
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric' })
}
</script>

<template>
  <div class="max-w-2xl mx-auto px-4 py-12 space-y-8">
    <div>
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">My account</h1>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Manage your profile and membership</p>
    </div>

    <!-- Profile card -->
    <UCard>
      <template #header>
        <p class="text-sm font-semibold text-gray-900 dark:text-white">Profile</p>
      </template>
      <div class="flex items-center gap-4">
        <UAvatar :alt="(user as { name?: string })?.name ?? 'User'" size="lg" />
        <div>
          <p class="font-medium text-gray-900 dark:text-white">{{ (user as { name?: string })?.name }}</p>
          <p class="text-sm text-gray-500 dark:text-gray-400">{{ (user as { email?: string })?.email }}</p>
        </div>
      </div>
    </UCard>

    <!-- Subscription card -->
    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <p class="text-sm font-semibold text-gray-900 dark:text-white">Membership</p>
          <UBadge :color="statusColor" variant="soft">{{ statusLabel }}</UBadge>
        </div>
      </template>

      <div v-if="subscription && tier" class="space-y-4">
        <div class="flex items-start justify-between">
          <div>
            <p class="font-medium text-gray-900 dark:text-white">{{ tier.name }}</p>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              {{ formatPrice(tier.price, tier.currency) }} / {{ tier.interval }}
            </p>
          </div>
        </div>

        <div v-if="tier.features.length" class="space-y-1">
          <p class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Includes</p>
          <ul class="space-y-1">
            <li
              v-for="feat in tier.features"
              :key="feat"
              class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300"
            >
              <UIcon name="i-lucide-check" class="w-3.5 h-3.5 text-primary-500 shrink-0" />
              {{ feat }}
            </li>
          </ul>
        </div>

        <UDivider />

        <div class="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p class="text-gray-400 text-xs uppercase tracking-wide">Renews</p>
            <p class="mt-0.5 text-gray-700 dark:text-gray-300">{{ formatDate(subscription.currentPeriodEnd) }}</p>
          </div>
          <div v-if="subscription.cancelledAt">
            <p class="text-gray-400 text-xs uppercase tracking-wide">Cancelled</p>
            <p class="mt-0.5 text-gray-700 dark:text-gray-300">{{ formatDate(subscription.cancelledAt) }}</p>
          </div>
        </div>

        <div v-if="subscription.provider === 'stripe'">
          <UButton
            variant="outline"
            icon="i-lucide-credit-card"
            :loading="managingBilling"
            @click="manageBilling"
          >
            Manage billing
          </UButton>
        </div>
      </div>

      <div v-else class="py-6 text-center space-y-4">
        <div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800">
          <UIcon name="i-lucide-lock" class="w-6 h-6 text-gray-400" />
        </div>
        <div>
          <p class="font-medium text-gray-900 dark:text-white">No active membership</p>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Subscribe to unlock premium content</p>
        </div>
        <UButton to="/pricing" icon="i-lucide-star">View plans</UButton>
      </div>
    </UCard>

    <!-- Security -->
    <UCard>
      <template #header>
        <p class="text-sm font-semibold text-gray-900 dark:text-white">Security</p>
      </template>
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-medium text-gray-900 dark:text-white">Password</p>
          <p class="text-xs text-gray-400 mt-0.5">Change your account password</p>
        </div>
        <UButton variant="outline" size="sm" to="/forgot-password">Change password</UButton>
      </div>
    </UCard>
  </div>
</template>
