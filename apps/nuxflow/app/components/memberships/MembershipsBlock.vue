<script setup lang="ts">
import type { SpacingValue } from '@nuxflow/canvas'

interface Tier {
  id: string
  name: string
  description: string | null
  price: number
  currency: string
  interval: 'month' | 'year' | 'one_time'
  features: string[]
}

const props = withDefaults(defineProps<{
  title?: string
  subtitle?: string
  ctaLabel?: string
  highlightTierName?: string
  showAccountLink?: boolean
  bgColor?: string
  textColor?: string
  padding?: SpacingValue
}>(), {
  title: 'Membership Plans',
  subtitle: 'Choose the plan that works for you',
  ctaLabel: 'Get started',
  highlightTierName: '',
  showAccountLink: true,
  bgColor: '',
  textColor: '',
  padding: undefined,
})

const { data } = await useFetch<{ tiers: Tier[], signupsDisabled: boolean, signupsDisabledMessage: string }>('/api/public/memberships', {
  headers: useRequestHeaders(['host']),
})

const tiers = computed(() => data.value?.tiers ?? [])
const signupsDisabled = computed(() => data.value?.signupsDisabled ?? false)
const signupsDisabledMessage = computed(() => data.value?.signupsDisabledMessage ?? 'New signups are temporarily paused.')

const intervalLabel: Record<string, string> = {
  month: 'mo',
  year: 'yr',
  one_time: 'once',
}

function formatPrice(price: number, currency: string) {
  return new Intl.NumberFormat('en', { style: 'currency', currency, minimumFractionDigits: 0 }).format(price)
}

const { loggedIn } = useUserSession()
const loading = ref<string | null>(null)
const toast = useToast()

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
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Could not start checkout'
    toast.add({ title: msg, color: 'error' })
  } finally {
    loading.value = null
  }
}

const containerStyle = computed(() => {
  const p = props.padding
  return {
    backgroundColor: props.bgColor || 'transparent',
    color: props.textColor || 'inherit',
    padding: p ? `${p.top}${p.unit} ${p.right}${p.unit} ${p.bottom}${p.unit} ${p.left}${p.unit}` : '64px 24px',
  }
})
</script>

<template>
  <section class="memberships-block w-full" :style="containerStyle">
    <div class="max-w-5xl mx-auto space-y-10">
      <div v-if="title || subtitle" class="text-center space-y-3">
        <h2 v-if="title" class="text-3xl sm:text-4xl font-extrabold tracking-tight">{{ title }}</h2>
        <p v-if="subtitle" class="text-lg opacity-75 max-w-2xl mx-auto">{{ subtitle }}</p>
      </div>

      <div v-if="signupsDisabled" class="flex items-center gap-3 rounded-xl border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/40 px-4 py-3 text-sm text-orange-800 dark:text-orange-300">
        <span class="i-lucide-pause-circle w-4 h-4 shrink-0" />
        {{ signupsDisabledMessage }}
      </div>

      <div v-if="!tiers.length" class="text-center py-16 opacity-50">
        <span class="i-lucide-package-x w-12 h-12 mx-auto mb-4 block" />
        <p>No membership plans are available at this time.</p>
      </div>

      <div
        v-else
        class="grid grid-cols-1 gap-6"
        :class="{
          'sm:grid-cols-2 max-w-3xl mx-auto': tiers.length === 2,
          'sm:grid-cols-2 lg:grid-cols-3': tiers.length === 3,
          'sm:grid-cols-2 lg:grid-cols-4': tiers.length >= 4,
        }"
      >
        <div
          v-for="tier in tiers"
          :key="tier.id"
          class="relative flex flex-col gap-5 rounded-2xl border p-6 shadow-sm transition-all duration-300 hover:shadow-md bg-white dark:bg-gray-900"
          :class="[
            highlightTierName && tier.name === highlightTierName
              ? 'border-primary-500 ring-2 ring-primary-500 md:scale-[1.03] z-10'
              : 'border-gray-200 dark:border-gray-700',
          ]"
        >
          <div
            v-if="highlightTierName && tier.name === highlightTierName"
            class="absolute top-0 right-1/2 translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-500 px-4 py-1 text-xs font-bold text-gray-950 uppercase tracking-wider"
          >
            Popular
          </div>

          <div class="space-y-1">
            <p class="text-lg font-semibold text-gray-900 dark:text-white">{{ tier.name }}</p>
            <p v-if="tier.description" class="text-sm text-gray-500 dark:text-gray-400">{{ tier.description }}</p>
          </div>

          <div class="flex items-end gap-1">
            <span class="text-3xl font-bold text-gray-900 dark:text-white">{{ formatPrice(tier.price, tier.currency) }}</span>
            <span class="text-sm text-gray-400 mb-1">/ {{ intervalLabel[tier.interval] ?? tier.interval }}</span>
          </div>

          <ul v-if="tier.features.length" class="flex-1 space-y-2 border-t border-gray-100 dark:border-gray-800 pt-4">
            <li
              v-for="feat in tier.features"
              :key="feat"
              class="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-300"
            >
              <span class="i-lucide-check w-4 h-4 text-primary-500 shrink-0 mt-0.5" />
              {{ feat }}
            </li>
          </ul>

          <UButton
            block
            :loading="loading === tier.id"
            :disabled="signupsDisabled || (!!loading && loading !== tier.id)"
            @click="subscribe(tier.id)"
          >
            {{ ctaLabel || 'Get started' }}
          </UButton>
        </div>
      </div>

      <p v-if="showAccountLink && tiers.length" class="text-center text-sm opacity-60">
        Already a member?
        <NuxtLink to="/account" class="text-primary-500 hover:underline">Manage your subscription</NuxtLink>
      </p>
    </div>
  </section>
</template>
