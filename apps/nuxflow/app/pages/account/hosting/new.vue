<script setup lang="ts">
// Hosting sign-up, on the accounts origin: choose a plan, a name and an address, then pay
// through Stripe Checkout. Someone without an account creates one here first (the only
// place passwords are typed), signs in, and comes straight back to this form.
definePageMeta({ layout: false, authWide: true })
useHead({ title: 'Start your site' })

interface PublicPlan {
  id: string
  name: string
  description: string
  priceText: string
  currency: string
  priceMonthly: number | null
  priceYearly: number | null
  trialDays: number
  limits: {
    maxStorageBytes: number | null
    maxContentItems: number | null
    maxTeamMembers: number | null
    maxAiCallsPerMonth: number | null
    maxEmailsPerMonth: number | null
    maxPlugins: number | null
    maxCustomDomains: number | null
  }
}

const { isAccountsHost, accountsLink } = useAccounts()
if (!isAccountsHost) await navigateTo(accountsLink('/account/hosting/new'), { external: true })

const route = useRoute()
const { loggedIn, user } = useUserSession()
const { data } = await useFetch<{ enabled: boolean; sitesDomain: string | null; plans: PublicPlan[] }>('/api/accounts/hosting', {
  default: () => ({ enabled: false, sitesDomain: null, plans: [] }),
})
const plans = computed(() => data.value.plans)

const hasYearly = computed(() => plans.value.some(p => p.priceYearly != null))
const interval = ref<'month' | 'year'>(route.query.interval === 'year' ? 'year' : 'month')
const planId = ref<string>(typeof route.query.plan === 'string' ? route.query.plan : '')
const selected = computed(() => plans.value.find(p => p.id === planId.value) ?? null)

function priceFor(plan: PublicPlan): number | null {
  return interval.value === 'year' ? plan.priceYearly : plan.priceMonthly
}
watch(interval, () => {
  // A plan without a price at the new interval can't stay selected.
  if (selected.value && priceFor(selected.value) == null) planId.value = ''
})

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: Number.isInteger(amount) ? 0 : 2 }).format(amount)
  } catch {
    return `${amount} ${currency.toUpperCase()}`
  }
}

function gb(bytes: number): string {
  const v = bytes / 1024 ** 3
  return v >= 1 ? `${+v.toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`
}

function features(plan: PublicPlan): string[] {
  const l = plan.limits
  const out: string[] = []
  out.push(l.maxStorageBytes == null ? 'Unlimited storage' : `${gb(l.maxStorageBytes)} storage`)
  out.push(l.maxContentItems == null ? 'Unlimited pages and posts' : `${l.maxContentItems.toLocaleString()} pages and posts`)
  out.push(l.maxTeamMembers == null ? 'Unlimited team members' : `${l.maxTeamMembers} team ${l.maxTeamMembers === 1 ? 'member' : 'members'}`)
  // maxAiCallsPerMonth holds AI credits (ai-allowance.ts). Own-key AI is always available.
  out.push(l.maxAiCallsPerMonth === 0
    ? 'AI tools with your own AI key'
    : l.maxAiCallsPerMonth == null ? 'Built-in AI tools' : `Built-in AI tools (${l.maxAiCallsPerMonth.toLocaleString()} credits a month)`)
  if (l.maxPlugins !== 0) out.push('Plugins')
  if (l.maxCustomDomains !== 0) out.push(l.maxCustomDomains === 1 ? 'Connect your own domain' : 'Connect your own domains')
  out.push('Free SSL, backups you can take with you')
  return out
}

// ── Site details ──────────────────────────────────────────────────────────────
// Prefilled from the query, so choices survive the round trip through sign-in.
const siteName = ref(typeof route.query.name === 'string' ? route.query.name.slice(0, 100) : '')
const subdomain = ref(typeof route.query.sub === 'string' ? route.query.sub.slice(0, 32) : '')
const subdomainTouched = ref(!!subdomain.value)
const TEMPLATE_VALUES = ['landing', 'blog', 'portfolio', 'blank'] as const
type Template = typeof TEMPLATE_VALUES[number]
const template = ref<Template>(TEMPLATE_VALUES.find(t => t === route.query.template) ?? 'landing')
const TEMPLATES = [
  { value: 'landing', label: 'Business', icon: 'i-lucide-store', description: 'A home page with services and a contact section' },
  { value: 'blog', label: 'Blog', icon: 'i-lucide-pen-line', description: 'Posts first, with a welcome post to edit' },
  { value: 'portfolio', label: 'Portfolio', icon: 'i-lucide-images', description: 'Show your work in a gallery' },
  { value: 'blank', label: 'Blank', icon: 'i-lucide-file', description: 'Start from an empty page' },
] as const

function slugify(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '')
}
watch(siteName, (name) => {
  if (!subdomainTouched.value) subdomain.value = slugify(name)
})

interface SubdomainCheck { available: boolean; domain: string; reason?: string }
const availability = ref<SubdomainCheck | null>(null)
const checking = ref(false)
let checkTimer: ReturnType<typeof setTimeout> | undefined
async function checkAvailability(value: string) {
  try {
    availability.value = await $fetch<SubdomainCheck>('/api/accounts/hosting/subdomain', { query: { name: value } })
  } catch {
    availability.value = null
  } finally {
    checking.value = false
  }
}
watch(subdomain, (value) => {
  availability.value = null
  clearTimeout(checkTimer)
  if (!value) return
  checking.value = true
  checkTimer = setTimeout(() => checkAvailability(value), 400)
})
onMounted(() => {
  if (subdomain.value) {
    checking.value = true
    void checkAvailability(subdomain.value)
  }
})

// ── Account (when signed out) ─────────────────────────────────────────────────
const account = reactive({ name: '', email: '', password: '' })
const registering = ref(false)
const registerError = ref('')
const signInLink = computed(() => {
  const back = new URLSearchParams({ interval: interval.value, template: template.value })
  if (planId.value) back.set('plan', planId.value)
  if (siteName.value) back.set('name', siteName.value)
  if (subdomain.value) back.set('sub', subdomain.value)
  return `/login?${new URLSearchParams({ next: `/account/hosting/new?${back}` })}`
})

async function createAccount() {
  registering.value = true
  registerError.value = ''
  try {
    await $fetch<{ success: boolean }>('/api/accounts/hosting/register', { method: 'POST', body: account })
    // Sign in (with the password just chosen), then back to this form.
    await navigateTo(signInLink.value)
  } catch (e: unknown) {
    registerError.value = getErrorMessage(e, 'Could not create your account')
  } finally {
    registering.value = false
  }
}

// ── Checkout ──────────────────────────────────────────────────────────────────
const paying = ref(false)
const payError = ref('')
const canPay = computed(() => loggedIn.value && !!selected.value && priceFor(selected.value) != null && siteName.value.trim().length > 0 && availability.value?.available === true)

async function continueToPayment() {
  if (!selected.value) return
  paying.value = true
  payError.value = ''
  try {
    const { url } = await $fetch<{ url: string }>('/api/accounts/hosting/checkout', {
      method: 'POST',
      body: { planId: selected.value.id, interval: interval.value, subdomain: subdomain.value, siteName: siteName.value, template: template.value },
    })
    window.location.href = url
  } catch (e: unknown) {
    payError.value = getErrorMessage(e, 'Could not start the payment')
    paying.value = false
  }
}
</script>

<template>
  <NuxtLayout name="auth">
    <div class="space-y-6">
      <div class="text-center space-y-1">
        <h1 class="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Start your website</h1>
        <p class="text-sm text-gray-500">Pick a plan, choose your address, and your site is ready in seconds. Cancel any time.</p>
      </div>

      <UCard v-if="!data.enabled || !plans.length">
        <div class="text-center py-6 space-y-2">
          <p class="font-medium text-gray-900 dark:text-white">Sign-up isn't open yet</p>
          <p class="text-sm text-gray-500">Please check back soon.</p>
        </div>
      </UCard>

      <template v-else>
        <!-- 1. Plan -->
        <section class="space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="font-semibold text-gray-900 dark:text-white">1. Choose a plan</h2>
            <div v-if="hasYearly" class="inline-flex rounded-lg bg-gray-100 dark:bg-gray-800 p-1 text-sm">
              <button type="button" class="px-3 py-1 rounded-md" :class="interval === 'month' ? 'bg-white dark:bg-gray-900 shadow-sm font-medium' : 'text-gray-500'" @click="interval = 'month'">Monthly</button>
              <button type="button" class="px-3 py-1 rounded-md" :class="interval === 'year' ? 'bg-white dark:bg-gray-900 shadow-sm font-medium' : 'text-gray-500'" @click="interval = 'year'">Yearly</button>
            </div>
          </div>
          <div class="grid gap-3 md:grid-cols-3">
            <button
              v-for="plan in plans"
              :key="plan.id"
              type="button"
              :disabled="priceFor(plan) == null"
              class="text-left rounded-xl border-2 bg-white/80 dark:bg-gray-900/80 p-4 transition disabled:opacity-40 disabled:cursor-not-allowed"
              :class="planId === plan.id ? 'border-primary-500 ring-2 ring-primary-500/20' : 'border-gray-200 dark:border-gray-800 hover:border-gray-300'"
              :aria-pressed="planId === plan.id"
              @click="planId = plan.id"
            >
              <div class="flex items-center justify-between gap-2">
                <p class="font-semibold text-gray-900 dark:text-white">{{ plan.name }}</p>
                <UBadge v-if="plan.priceText" size="sm" variant="subtle">{{ plan.priceText }}</UBadge>
              </div>
              <p class="mt-2 text-2xl font-bold text-gray-900 dark:text-white">
                <template v-if="priceFor(plan) != null">{{ money(priceFor(plan)!, plan.currency) }}<span class="text-sm font-normal text-gray-500"> / {{ interval }}</span></template>
                <span v-else class="text-sm font-normal text-gray-500">Not available {{ interval === 'year' ? 'yearly' : 'monthly' }}</span>
              </p>
              <p v-if="plan.trialDays" class="text-xs text-primary-600 dark:text-primary-400 font-medium mt-1">{{ plan.trialDays }} days free</p>
              <p v-if="plan.description" class="text-sm text-gray-500 mt-2">{{ plan.description }}</p>
              <ul class="mt-3 space-y-1">
                <li v-for="f in features(plan)" :key="f" class="flex gap-2 text-sm text-gray-600 dark:text-gray-300">
                  <UIcon name="i-lucide-check" class="size-4 text-primary-500 shrink-0 mt-0.5" />{{ f }}
                </li>
              </ul>
            </button>
          </div>
        </section>

        <!-- 2. Site -->
        <UCard>
          <div class="space-y-4">
            <h2 class="font-semibold text-gray-900 dark:text-white">2. Your site</h2>
            <UFormField label="Site name" help="You can change this later.">
              <UInput v-model="siteName" placeholder="The Corner Café" class="w-full" maxlength="100" />
            </UFormField>
            <UFormField label="Address">
              <div class="flex items-center gap-2">
                <UInput v-model="subdomain" placeholder="cornercafe" class="flex-1" maxlength="32" autocomplete="off" @input="subdomainTouched = true" />
                <span class="text-sm text-gray-500 shrink-0">.{{ data.sitesDomain }}</span>
              </div>
              <p v-if="checking" class="text-xs text-gray-400 mt-1">Checking…</p>
              <p v-else-if="availability?.available" class="text-xs text-green-600 dark:text-green-400 mt-1">{{ availability.domain }} is available</p>
              <p v-else-if="availability" class="text-xs text-red-600 dark:text-red-400 mt-1">{{ availability.reason }}</p>
              <p class="text-xs text-gray-400 mt-1">Want your own domain, like cornercafe.co.uk? You can connect one later.</p>
            </UFormField>
            <div>
              <p class="text-sm font-medium text-gray-900 dark:text-white mb-2">Start with</p>
              <div class="grid gap-2 sm:grid-cols-2">
                <button
                  v-for="t in TEMPLATES"
                  :key="t.value"
                  type="button"
                  class="flex gap-3 text-left rounded-lg border p-3 transition"
                  :class="template === t.value ? 'border-primary-500 bg-primary-50/60 dark:bg-primary-950/30' : 'border-gray-200 dark:border-gray-800 hover:border-gray-300'"
                  :aria-pressed="template === t.value"
                  @click="template = t.value"
                >
                  <UIcon :name="t.icon" class="size-5 text-primary-500 shrink-0 mt-0.5" />
                  <span>
                    <span class="block text-sm font-medium text-gray-900 dark:text-white">{{ t.label }}</span>
                    <span class="block text-xs text-gray-500">{{ t.description }}</span>
                  </span>
                </button>
              </div>
            </div>
          </div>
        </UCard>

        <!-- 3. Account + pay -->
        <UCard>
          <div class="space-y-4">
            <h2 class="font-semibold text-gray-900 dark:text-white">3. {{ loggedIn ? 'Payment' : 'Your account' }}</h2>

            <template v-if="!loggedIn">
              <p class="text-sm text-gray-500">
                Create an account to manage your site and billing.
                Already have one? <NuxtLink :to="signInLink" class="text-primary-500 hover:underline">Sign in</NuxtLink>.
              </p>
              <div class="grid gap-3 sm:grid-cols-3">
                <UFormField label="Your name"><UInput v-model="account.name" autocomplete="name" class="w-full" /></UFormField>
                <UFormField label="Email"><UInput v-model="account.email" type="email" autocomplete="email" class="w-full" /></UFormField>
                <UFormField label="Password" help="At least 8 characters"><UInput v-model="account.password" type="password" autocomplete="new-password" class="w-full" /></UFormField>
              </div>
              <UAlert v-if="registerError" color="error" variant="soft" :description="registerError" />
              <UButton block size="lg" :loading="registering" :disabled="!account.name || !account.email || account.password.length < 8" @click="createAccount">
                Create account and continue
              </UButton>
              <p class="text-xs text-gray-400 text-center">You'll sign in once, then come straight back here. Your choices above are kept.</p>
            </template>

            <template v-else>
              <p class="text-sm text-gray-500">
                Signed in as <strong class="text-gray-900 dark:text-white">{{ user?.email }}</strong>.
                <template v-if="selected?.trialDays">Your card is needed now, but you won't be charged for {{ selected.trialDays }} days.</template>
                Payment is handled securely by Stripe.
              </p>
              <UAlert v-if="payError" color="error" variant="soft" :description="payError" />
              <UButton block size="lg" :loading="paying" :disabled="!canPay" trailing-icon="i-lucide-arrow-right" @click="continueToPayment">
                Continue to payment
              </UButton>
              <p v-if="!canPay" class="text-xs text-gray-400 text-center">Choose a plan, a site name and an available address first.</p>
            </template>
          </div>
        </UCard>
      </template>
    </div>
  </NuxtLayout>
</template>
