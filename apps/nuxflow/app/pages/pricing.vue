<script setup lang="ts">
interface Tier {
  id: string
  name: string
  description: string | null
  price: number
  currency: string
  interval: 'month' | 'year' | 'one_time'
  features: string[]
  isActive: boolean
}

const { data } = await useFetch<{ tiers: Tier[] }>('/api/public/memberships', {
  headers: useRequestHeaders(['host']),
})

useSeoMeta({ title: 'Membership Plans' })

const tiers = computed(() => data.value?.tiers ?? [])

const loadingTier = ref<string | null>(null)
const { loggedIn } = useUserSession()
const toast = useToast()

const intervalLabel: Record<string, string> = {
  month: 'mo',
  year: 'yr',
  one_time: 'once',
}

function formatPrice(price: number, currency: string) {
  return new Intl.NumberFormat('en', { style: 'currency', currency, minimumFractionDigits: 0 }).format(price)
}

async function subscribe(tierId: string) {
  if (!loggedIn.value) {
    await navigateTo(`/register?redirect=/pricing`)
    return
  }
  loadingTier.value = tierId
  try {
    const { url } = await $fetch<{ url: string }>('/api/v1/memberships/checkout', {
      method: 'POST',
      body: { tierId, returnUrl: window.location.href },
    })
    window.location.href = url
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Could not start checkout'
    toast.add({ title: msg, color: 'red' })
  } finally {
    loadingTier.value = null
  }
}
</script>

<template>
  <div class="max-w-5xl mx-auto px-4 py-16 space-y-12">
    <div class="text-center space-y-3">
      <h1 class="text-4xl font-bold text-gray-900 dark:text-white">Membership plans</h1>
      <p class="text-lg text-gray-500 dark:text-gray-400">Choose the plan that works for you</p>
    </div>

    <div v-if="!tiers.length" class="text-center py-16 text-gray-400">
      <UIcon name="i-lucide-package-x" class="w-12 h-12 mx-auto mb-4" />
      <p>No membership plans are available at this time.</p>
    </div>

    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      <div
        v-for="tier in tiers"
        :key="tier.id"
        class="relative bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 flex flex-col gap-5 shadow-sm"
      >
        <div class="space-y-1">
          <p class="text-lg font-semibold text-gray-900 dark:text-white">{{ tier.name }}</p>
          <p v-if="tier.description" class="text-sm text-gray-500 dark:text-gray-400">{{ tier.description }}</p>
        </div>

        <div class="flex items-end gap-1">
          <span class="text-3xl font-bold text-gray-900 dark:text-white">{{ formatPrice(tier.price, tier.currency) }}</span>
          <span class="text-sm text-gray-400 mb-1">/ {{ intervalLabel[tier.interval] ?? tier.interval }}</span>
        </div>

        <ul v-if="tier.features.length" class="flex-1 space-y-2">
          <li
            v-for="feat in tier.features"
            :key="feat"
            class="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-300"
          >
            <UIcon name="i-lucide-check" class="w-4 h-4 text-primary-500 shrink-0 mt-0.5" />
            {{ feat }}
          </li>
        </ul>

        <UButton
          block
          :loading="loadingTier === tier.id"
          :disabled="!!loadingTier && loadingTier !== tier.id"
          @click="subscribe(tier.id)"
        >
          Get started
        </UButton>
      </div>
    </div>

    <p class="text-center text-sm text-gray-400">
      Already a member?
      <NuxtLink to="/account" class="text-primary-500 hover:underline">Manage your subscription</NuxtLink>
    </p>
  </div>
</template>
