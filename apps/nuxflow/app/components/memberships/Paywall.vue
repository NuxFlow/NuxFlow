<script setup lang="ts">
defineProps<{
  tiers?: Array<{ id: string; name: string; price: number; currency: string; interval: 'month' | 'year'; features: string[] }>
}>()

const { loggedIn } = useUserSession()
const loading = ref<string | null>(null)

async function subscribe(tierId: string) {
  if (!loggedIn.value) {
    window.location.href = `/register?redirect=${encodeURIComponent(window.location.pathname)}`
    return
  }
  loading.value = tierId
  try {
    const { url } = await $fetch<{ url: string }>('/api/v1/memberships/checkout', {
      method: 'POST',
      body: { tierId, returnUrl: window.location.href },
    })
    window.location.href = url
  } catch (err) {
    console.error('[paywall] Checkout error:', err)
  } finally {
    loading.value = null
  }
}
</script>

<template>
  <div class="max-w-2xl mx-auto text-center space-y-6 py-12">
    <div class="inline-flex items-center justify-center w-14 h-14 rounded-full bg-gray-100 dark:bg-gray-800">
      <UIcon name="i-lucide-lock" class="w-7 h-7 text-gray-400" />
    </div>

    <div>
      <h2 class="text-xl font-bold text-gray-900 dark:text-white">Members only</h2>
      <p class="text-sm text-gray-500 mt-1">Subscribe to access this content.</p>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
      <div
        v-for="tier in tiers"
        :key="tier.id"
        class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-3"
      >
        <div>
          <p class="font-semibold text-gray-900 dark:text-white">{{ tier.name }}</p>
          <p class="text-2xl font-bold text-primary-500 mt-1">
            {{ tier.currency }}{{ tier.price }}
            <span class="text-sm font-normal text-gray-400">/ {{ tier.interval }}</span>
          </p>
        </div>
        <ul class="space-y-1">
          <li v-for="feat in tier.features" :key="feat" class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <UIcon name="i-lucide-check" class="w-3.5 h-3.5 text-primary-500 shrink-0" />
            {{ feat }}
          </li>
        </ul>
        <UButton block :loading="loading === tier.id" @click="subscribe(tier.id)">Subscribe</UButton>
      </div>
    </div>
  </div>
</template>
