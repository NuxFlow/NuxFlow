<script setup lang="ts">
// "My hosting", on the accounts origin of a hosting platform: the customer's sites, their
// plan and billing state, and the way into Stripe's Customer Portal for card, invoices,
// plan changes and cancelling. Arriving from Stripe Checkout (?welcome=<id>) shows the
// site being set up until the webhook has created it.
definePageMeta({ layout: false, middleware: ['auth'], authWide: true })
useHead({ title: 'My hosting' })

interface HostedSite {
  id: string
  status: string
  interval: 'month' | 'year'
  plan: { id: string; name: string } | null
  site: { id: string; name: string; domain: string; status: string } | null
  requestedSiteName: string
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  pastDueSince: string | null
  paused: boolean
}

const { isAccountsHost, accountsLink } = useAccounts()
if (!isAccountsHost) await navigateTo(accountsLink('/account/hosting'), { external: true })

const route = useRoute()
const toast = useToast()
const headers = useRequestHeaders(['cookie'])
const { data, refresh } = await useFetch<{ subscriptions: HostedSite[] }>('/api/accounts/hosting/subscriptions', {
  headers,
  default: () => ({ subscriptions: [] }),
})

const welcomeId = computed(() => typeof route.query.welcome === 'string' ? route.query.welcome : null)
const welcoming = computed(() => {
  if (!welcomeId.value) return null
  return data.value.subscriptions.find(s => s.id === welcomeId.value) ?? null
})
// Stripe redirects back before (or just after) its webhook arrives — keep checking for a
// minute or so until the site exists.
const settingUp = computed(() => !!welcomeId.value && !welcoming.value?.site)
let polls = 0
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  if (!settingUp.value) return
  timer = setInterval(async () => {
    polls++
    await refresh()
    if (!settingUp.value || polls > 30) clearInterval(timer)
  }, 3000)
})
onBeforeUnmount(() => clearInterval(timer))

type BadgeColor = 'success' | 'warning' | 'error' | 'neutral' | 'info'
function statusOf(s: HostedSite): { label: string; color: BadgeColor; note: string } {
  if (s.paused || s.site?.status === 'maintenance') {
    return { label: 'Paused', color: 'error', note: s.status === 'canceled'
      ? 'Your plan has ended, so visitors see a "back soon" page. Nothing has been deleted. Contact us to restart it.'
      : 'Visitors see a "back soon" page. Pay the outstanding invoice under Billing and it reopens by itself. Nothing has been deleted.' }
  }
  if (s.site?.status === 'suspended') return { label: 'Suspended', color: 'error', note: 'Please contact us about this site.' }
  if (s.status === 'past_due') return { label: 'Payment failing', color: 'warning', note: 'Your last payment didn\'t go through. Please check your card under Billing.' }
  if (s.status === 'trialing') return { label: 'Free trial', color: 'info', note: s.currentPeriodEnd ? `First payment on ${formatDate(s.currentPeriodEnd)}.` : '' }
  if (s.status === 'canceled' || s.status === 'unpaid') return { label: 'Ended', color: 'neutral', note: '' }
  if (s.cancelAtPeriodEnd) return { label: 'Cancelling', color: 'warning', note: `Ends on ${formatDate(s.currentPeriodEnd)}. You can undo this under Billing.` }
  if (!s.site) return { label: 'Setting up', color: 'info', note: 'Your site is being created.' }
  return { label: 'Active', color: 'success', note: s.currentPeriodEnd ? `Renews on ${formatDate(s.currentPeriodEnd)}.` : '' }
}

function adminLink(domain: string): string {
  return `https://${domain}/_nuxflow/auth/start?${new URLSearchParams({ return_to: '/admin' })}`
}

const opening = ref<string | null>(null)
async function openBilling(id: string) {
  opening.value = id
  try {
    const { url } = await $fetch<{ url: string }>('/api/accounts/hosting/billing-portal', { method: 'POST', body: { id } })
    window.location.href = url
  } catch (e: unknown) {
    toast.add({ title: getErrorMessage(e, 'Could not open billing'), color: 'error' })
    opening.value = null
  }
}
</script>

<template>
  <NuxtLayout name="auth">
    <div class="space-y-6">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <NuxtLink to="/account" class="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">← Your account</NuxtLink>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white mt-1">My hosting</h1>
          <p class="text-sm text-gray-500">Your sites, plans and billing.</p>
        </div>
        <UButton to="/account/hosting/new" icon="i-lucide-plus">Start a new site</UButton>
      </div>

      <UCard v-if="settingUp">
        <div class="flex items-center gap-4 py-2">
          <UIcon name="i-lucide-loader-circle" class="size-8 animate-spin text-primary-500 shrink-0" />
          <div>
            <p class="font-semibold text-gray-900 dark:text-white">Thank you! Setting up your site…</p>
            <p class="text-sm text-gray-500">This usually takes a few seconds. We'll also email you when it's ready.</p>
          </div>
        </div>
      </UCard>
      <UAlert
        v-else-if="welcoming?.site"
        color="success"
        variant="soft"
        icon="i-lucide-party-popper"
        :title="`${welcoming.site.name} is ready`"
        description="Open the admin to choose a design and add your pages."
      />

      <UCard v-if="!data.subscriptions.length && !settingUp">
        <div class="text-center py-6 space-y-3">
          <p class="font-medium text-gray-900 dark:text-white">No sites yet</p>
          <p class="text-sm text-gray-500">Pick a plan and choose your address. Your site is ready a few seconds after you pay.</p>
          <UButton to="/account/hosting/new">See plans</UButton>
        </div>
      </UCard>

      <UCard v-for="s in data.subscriptions" :key="s.id">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="min-w-0 space-y-1">
            <div class="flex items-center gap-2">
              <p class="font-semibold text-gray-900 dark:text-white truncate">{{ s.site?.name ?? s.requestedSiteName }}</p>
              <UBadge :color="statusOf(s).color" variant="subtle" size="sm">{{ statusOf(s).label }}</UBadge>
            </div>
            <a v-if="s.site" :href="`https://${s.site.domain}`" target="_blank" class="text-sm text-primary-500 hover:underline">{{ s.site.domain }}</a>
            <p class="text-sm text-gray-500">
              {{ s.plan?.name ?? 'Plan' }} · billed {{ s.interval === 'year' ? 'yearly' : 'monthly' }}
            </p>
            <p v-if="statusOf(s).note" class="text-xs text-gray-500">{{ statusOf(s).note }}</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <UButton v-if="s.site" :to="adminLink(s.site.domain)" external variant="soft" trailing-icon="i-lucide-arrow-up-right">Open admin</UButton>
            <UButton variant="outline" color="neutral" icon="i-lucide-credit-card" :loading="opening === s.id" @click="openBilling(s.id)">Billing</UButton>
          </div>
        </div>
        <div v-if="s.site && !s.paused" class="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
          <AccountsHostingDomains :subscription-id="s.id" />
        </div>
      </UCard>

      <p class="text-xs text-gray-500 text-center">
        Billing opens Stripe, where you can update your card, download invoices, change plan or cancel.
        You can always take your site with you: Admin → Import → Backup.
      </p>
    </div>
  </NuxtLayout>
</template>
