<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })
useHead({ title: 'Platform' })

interface PlatformState {
  build: { commit: string | null; release: string | null }
  hostingEnabled: boolean
  primarySite: { id: string; name: string; domain: string } | null
  centralAuth: boolean
  sitesDomain: string | null
  stripeConfigured: boolean
  webhookSecretSet: boolean
  webhookUrl: string | null
  signUpUrl: string | null
  customDomains: { zoneId: string | null; tokenSet: boolean; target: string | null }
  ai: { dailyCap: number | null; creditsToday: number }
  analytics: { recording: boolean; dataset: string; tokenSet: boolean; accountId: string | null }
}

// Every event the hosting webhook acts on — the operator ticks these in Stripe.
const WEBHOOK_EVENTS = ['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.paused', 'customer.subscription.resumed', 'customer.subscription.deleted']

const { data, error, refresh } = await useFetch<PlatformState>('/api/v1/admin/platform')
const access = useAdminAccessState()
const { run, isRunning, toast } = useAdminAction()

const saving = computed(() => isRunning('save'))
const confirmOpen = ref(false)
const webhookSecret = ref('')

async function save(body: Record<string, unknown>, message: string): Promise<boolean> {
  const done = await run(async () => {
    await $fetch<unknown>('/api/v1/admin/platform', { method: 'PUT', body })
    await refresh()
    return true
  }, { successTitle: message, errorTitle: "Couldn't save", key: 'save' })
  return done === true
}

async function setHosting(enabled: boolean) {
  const ok = await save({ hostingEnabled: enabled }, enabled ? 'Hosting platform turned on' : 'Hosting platform turned off')
  confirmOpen.value = false
  // The sidebar reads the shared access state, so Plans/Usage appear or go at once.
  if (ok && access.value) access.value = { ...access.value, hostingPlatform: enabled }
}

function onToggle(enabled: boolean) {
  // Turning it off lifts every site's limits, so ask first; turning it on changes
  // nothing until a site is given a plan.
  if (enabled) void setHosting(true)
  else confirmOpen.value = true
}

// Customers' own domains (Cloudflare for SaaS).
const cf = reactive({ zoneId: '', token: '', target: '' })
watch(() => data.value?.customDomains, (d) => {
  cf.zoneId = d?.zoneId ?? ''
  cf.target = d?.target ?? ''
}, { immediate: true })
async function saveCustomDomains() {
  const body: Record<string, string> = { cfZoneId: cf.zoneId.trim(), customDomainTarget: cf.target.trim() }
  if (cf.token.trim()) body.cfApiToken = cf.token.trim()
  if (await save(body, 'Custom domain settings saved')) cf.token = ''
}

// Platform-wide daily AI brake. Blank = no cap.
const aiCap = ref('')
watch(() => data.value?.ai.dailyCap, (cap) => {
  aiCap.value = cap == null ? '' : String(cap)
}, { immediate: true })
const aiCapInvalid = computed(() => aiCap.value.trim() !== '' && !/^\d+$/.test(aiCap.value.trim()))
async function saveAiCap() {
  const v = aiCap.value.trim()
  await save({ aiDailyCreditCap: v === '' ? null : Number(v) }, v === '' ? 'Daily AI cap removed' : 'Daily AI cap saved')
}

// Visitor analytics (Admin → Analytics on every site).
const analytics = reactive({ accountId: '', token: '' })
watch(() => data.value?.analytics.accountId, (id) => {
  analytics.accountId = id ?? ''
}, { immediate: true })
const accountIdInvalid = computed(() => analytics.accountId.trim() !== '' && !/^[a-f0-9]{32}$/i.test(analytics.accountId.trim()))
const analyticsReady = computed(() => !!data.value && data.value.analytics.recording && data.value.analytics.tokenSet && !!data.value.analytics.accountId)
async function saveAnalytics() {
  const body: Record<string, string> = { cloudflareAccountId: analytics.accountId.trim() }
  if (analytics.token.trim()) body.analyticsApiToken = analytics.token.trim()
  if (await save(body, 'Visitor analytics settings saved')) analytics.token = ''
}

async function saveWebhookSecret() {
  if (await save({ stripeWebhookSecret: webhookSecret.value }, 'Signing secret saved')) webhookSecret.value = ''
}

const checklist = computed(() => {
  const d = data.value
  if (!d) return []
  return [
    { done: d.centralAuth, label: 'Central sign-in domain is set', help: 'NUXT_PUBLIC_ACCOUNTS_URL in wrangler.toml. Customers sign up and manage billing there.' },
    { done: !!d.sitesDomain, label: d.sitesDomain ? `Customer sites go under ${d.sitesDomain}` : 'Domain for customer sites is set', help: 'NUXT_HOSTING_SITES_DOMAIN in wrangler.toml, e.g. nuxflow.site, with a wildcard route for it.' },
    { done: d.stripeConfigured, label: 'Stripe is connected', help: `Your Stripe secret key, in Settings → Payments on ${d.primarySite?.domain ?? 'the main site'}.` },
    { done: d.webhookSecretSet, label: 'Stripe webhook is set up', help: 'See below.' },
  ]
})
const ready = computed(() => checklist.value.every(c => c.done))

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({ title: 'Copied', color: 'success' })
  } catch {
    toast.add({ title: 'Could not copy — select the text instead', color: 'warning' })
  }
}
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6">
    <div>
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Platform</h1>
      <p class="text-sm text-gray-500 mt-0.5">Settings for this whole NuxFlow install, not one site</p>
    </div>

    <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-circle-alert" :description="getErrorMessage(error, 'Could not load platform settings')" />

    <template v-else-if="data">
      <UCard>
        <div class="flex items-start justify-between gap-6">
          <div class="space-y-2">
            <h2 class="font-semibold text-gray-900 dark:text-white">Run this install as a hosting platform</h2>
            <p class="text-sm text-gray-500">
              For selling sites to other people. When on, Super Admin gets <strong>Plans</strong> and <strong>Usage</strong>,
              each site's hosting plan limits apply, and customers can sign up and pay for a site themselves.
              When off, every site is unlimited and none of this is shown.
            </p>
            <p class="text-sm text-gray-500">
              Most installs (your own site, or a few sites you run yourself) should leave this off.
            </p>
            <p v-if="data.primarySite" class="text-xs text-gray-400">
              Stored on the primary site, {{ data.primarySite.name }} ({{ data.primarySite.domain }}).
            </p>
          </div>
          <USwitch
            :model-value="data.hostingEnabled"
            :loading="saving"
            :disabled="saving || !data.primarySite"
            aria-label="Run this install as a hosting platform"
            @update:model-value="onToggle"
          />
        </div>
        <UAlert
          v-if="!data.primarySite"
          class="mt-4"
          color="warning"
          variant="soft"
          icon="i-lucide-triangle-alert"
          description="No site is marked as the primary site, so this can't be turned on. The first site created by the setup wizard is normally the primary site."
        />
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <h2 class="font-semibold text-gray-900 dark:text-white">Visitor analytics</h2>
            <UBadge :color="analyticsReady ? 'success' : 'neutral'" variant="subtle">{{ analyticsReady ? 'On' : 'Not set up' }}</UBadge>
          </div>
        </template>
        <div class="space-y-4 text-sm">
          <p class="text-gray-500">
            Gives every site an <strong>Analytics</strong> page: page views, top pages, countries, where visitors came from.
            No cookies and no consent banner needed. It uses Cloudflare Analytics Engine, which the Workers Paid plan includes
            (about 10 million recorded views a month before Cloudflare charges more). Set it up once:
          </p>
          <ol class="list-decimal pl-5 space-y-2 text-gray-600 dark:text-gray-300">
            <li :class="{ 'text-gray-400': data.analytics.recording }">
              <UIcon v-if="data.analytics.recording" name="i-lucide-circle-check" class="size-4 text-green-500 align-text-bottom" />
              In <code>wrangler.toml</code>, uncomment the <code>[[analytics_engine_datasets]]</code> block — binding <code>AE</code>,
              dataset <code>{{ data.analytics.dataset }}</code> — and deploy. Counting starts within the hour, as cached pages refresh.
            </li>
            <li>
              Cloudflare → <strong>My Profile → API Tokens → Create Token → Custom token</strong>. Give it one permission,
              <strong>Account → Account Analytics → Read</strong>, for the account this Worker runs in, and paste it below.
            </li>
            <li>Add your <strong>account ID</strong> (Cloudflare dashboard → Account home → the ⋯ next to your account → Copy account ID).</li>
          </ol>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField label="Account ID" :error="accountIdInvalid ? 'An account ID is 32 letters and numbers.' : undefined">
              <UInput v-model="analytics.accountId" placeholder="32 letters and numbers" class="w-full" autocomplete="off" />
            </UFormField>
            <UFormField label="API token">
              <UInput v-model="analytics.token" type="password" :placeholder="data.analytics.tokenSet ? 'Saved — paste a new one to replace it' : 'Paste the token'" class="w-full" autocomplete="off" />
            </UFormField>
          </div>
          <p class="text-xs text-gray-400">The account ID is the same one Settings → Media and AI use on {{ data.primarySite?.name ?? 'your main site' }}.</p>
          <UButton :loading="saving" :disabled="accountIdInvalid || !data.primarySite" @click="saveAnalytics">Save</UButton>
        </div>
      </UCard>

      <UCard v-if="data.hostingEnabled">
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <h2 class="font-semibold text-gray-900 dark:text-white">Customer sign-up</h2>
            <UBadge :color="ready ? 'success' : 'warning'" variant="subtle">{{ ready ? 'Ready' : 'Not ready yet' }}</UBadge>
          </div>
        </template>

        <ul class="space-y-3">
          <li v-for="item in checklist" :key="item.label" class="flex gap-3">
            <UIcon :name="item.done ? 'i-lucide-circle-check' : 'i-lucide-circle-dashed'" class="size-5 shrink-0 mt-0.5" :class="item.done ? 'text-green-500' : 'text-gray-400'" />
            <div>
              <p class="text-sm font-medium text-gray-900 dark:text-white">{{ item.label }}</p>
              <p v-if="!item.done" class="text-xs text-gray-500">{{ item.help }}</p>
            </div>
          </li>
        </ul>

        <div v-if="data.signUpUrl" class="mt-5 text-sm text-gray-500">
          Sign-up page:
          <a :href="data.signUpUrl" target="_blank" class="text-primary-500 hover:underline break-all">{{ data.signUpUrl }}</a>.
          Plans appear there once they have a price and "Offer on the sign-up page" is ticked (Super Admin → Plans).
        </div>
      </UCard>

      <UCard v-if="data.hostingEnabled && data.webhookUrl">
        <template #header>
          <h2 class="font-semibold text-gray-900 dark:text-white">Stripe webhook</h2>
        </template>
        <div class="space-y-4 text-sm">
          <p class="text-gray-500">
            This is how Stripe tells NuxFlow that someone paid, changed plan, or stopped paying. Set it up once:
          </p>
          <ol class="list-decimal pl-5 space-y-2 text-gray-600 dark:text-gray-300">
            <li>In Stripe, open <strong>Workbench</strong> (under Developers) → <strong>Webhooks</strong> → <strong>Create an event destination</strong>. Choose events from <strong>Your account</strong>, the <strong>Snapshot</strong> payload style (not Thin), and <strong>Webhook endpoint</strong> as the type.</li>
            <li>
              Endpoint URL:
              <span class="inline-flex items-center gap-1">
                <code class="text-xs bg-gray-100 dark:bg-gray-800 rounded px-1.5 py-0.5 break-all">{{ data.webhookUrl }}</code>
                <UButton size="xs" variant="ghost" icon="i-lucide-copy" aria-label="Copy endpoint URL" @click="copy(data.webhookUrl!)" />
              </span>
            </li>
            <li>
              Events to send:
              <code v-for="e in WEBHOOK_EVENTS" :key="e" class="text-xs bg-gray-100 dark:bg-gray-800 rounded px-1.5 py-0.5 mr-1 inline-block mt-1">{{ e }}</code>
            </li>
            <li>Save it, then reveal its <strong>Signing secret</strong> (starts with <code>whsec_</code>) and paste it here.</li>
          </ol>
          <div class="flex gap-2">
            <UInput v-model="webhookSecret" type="password" :placeholder="data.webhookSecretSet ? 'Saved — paste a new one to replace it' : 'whsec_…'" class="flex-1" autocomplete="off" />
            <UButton :loading="saving" :disabled="!webhookSecret.trim()" @click="saveWebhookSecret">Save</UButton>
          </div>
          <p class="text-xs text-gray-400">
            Also in Stripe: <strong>Settings → Billing → Customer portal</strong> — allow customers to update payment methods, cancel, and switch between your plans' products.
            And <strong>Billing → Revenue recovery → Retries</strong>: if all retries fail, <strong>Pause the subscription</strong>, and when the invoice that caused the pause is paid, <strong>Resume the subscription</strong>. (Cancelling also works, but then a customer who pays late has to sign up again.)
          </p>
        </div>
      </UCard>
      <UCard v-if="data.hostingEnabled && data.sitesDomain">
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <h2 class="font-semibold text-gray-900 dark:text-white">Customers' own domains</h2>
            <UBadge :color="data.customDomains.zoneId && data.customDomains.tokenSet ? 'success' : 'neutral'" variant="subtle">
              {{ data.customDomains.zoneId && data.customDomains.tokenSet ? 'Ready' : 'Off' }}
            </UBadge>
          </div>
        </template>
        <div class="space-y-4 text-sm">
          <p class="text-gray-500">
            Lets customers connect a domain they own (like <code>www.cafe.co.uk</code>) from My hosting. Uses Cloudflare for SaaS on
            <strong>{{ data.sitesDomain }}</strong>: the first 100 domains are free, then $0.10 a month each. Set it up once:
          </p>
          <ol class="list-decimal pl-5 space-y-2 text-gray-600 dark:text-gray-300">
            <li>Cloudflare → <strong>{{ data.sitesDomain }}</strong> → DNS: add a proxied <code>AAAA</code> record named <code>{{ (cf.target || data.customDomains.target || '').replace(`.${data.sitesDomain}`, '') || 'customers' }}</code> with address <code>100::</code>.</li>
            <li>Same zone → <strong>SSL/TLS → Custom Hostnames</strong>: enable Cloudflare for SaaS, and set that record (<code>{{ cf.target || data.customDomains.target }}</code>) as the <strong>fallback origin</strong>.</li>
            <li>Make sure the Worker's route for this zone is <code>*/*</code> (in <code>wrangler.toml</code>), so customers' domains reach NuxFlow.</li>
            <li>Create an API token (My Profile → API Tokens) with <strong>Zone → SSL and Certificates → Edit</strong> for this zone only, and paste it below with the zone ID (zone Overview page).</li>
          </ol>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField label="Zone ID">
              <UInput v-model="cf.zoneId" placeholder="32 letters and numbers" class="w-full" autocomplete="off" />
            </UFormField>
            <UFormField label="API token">
              <UInput v-model="cf.token" type="password" :placeholder="data.customDomains.tokenSet ? 'Saved — paste a new one to replace it' : 'Paste the token'" class="w-full" autocomplete="off" />
            </UFormField>
            <UFormField label="CNAME target" help="What customers point their domain at.">
              <UInput v-model="cf.target" :placeholder="`customers.${data.sitesDomain}`" class="w-full" />
            </UFormField>
          </div>
          <UButton :loading="saving" @click="saveCustomDomains">Save</UButton>
        </div>
      </UCard>
      <UCard v-if="data.hostingEnabled">
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <h2 class="font-semibold text-gray-900 dark:text-white">AI you pay for</h2>
            <UBadge :color="data.ai.dailyCap == null ? 'warning' : 'success'" variant="subtle">
              {{ data.ai.dailyCap == null ? 'No daily cap' : 'Capped' }}
            </UBadge>
          </div>
        </template>
        <div class="space-y-4 text-sm">
          <p class="text-gray-500">
            Customer sites without their own AI key use Workers AI on <strong>your</strong> Cloudflare account. That use is counted as
            <strong>AI credits</strong> and limited by each plan's "AI credits a month" (Super Admin → Plans). A site that adds its own key
            in Settings → AI pays its provider directly, and none of that is counted or limited. Your own AI keys in <code>wrangler.toml</code>
            are only used by {{ data.primarySite?.name ?? 'your main site' }} while hosting is on.
          </p>
          <p class="text-gray-500">
            The daily cap is a safety brake on top of the plans: once all customer sites together have used this many credits in a day (UTC),
            AI on Workers AI pauses for them until midnight. Your main site is never paused. 1 credit is roughly 1,000 tokens on the fast model.
          </p>
          <p class="text-gray-600 dark:text-gray-300">
            Used today: <strong>{{ data.ai.creditsToday.toLocaleString() }}</strong>
            <template v-if="data.ai.dailyCap != null"> of {{ data.ai.dailyCap.toLocaleString() }}</template> credits
          </p>
          <div class="flex items-start gap-2">
            <UFormField label="Daily cap (credits)" help="Leave blank for no cap." :error="aiCapInvalid ? 'Enter a whole number, or leave it blank.' : undefined" class="flex-1">
              <UInput v-model="aiCap" inputmode="numeric" placeholder="No cap" class="w-full" />
            </UFormField>
            <UButton class="mt-6" :loading="saving" :disabled="aiCapInvalid" @click="saveAiCap">Save</UButton>
          </div>
        </div>
      </UCard>

      <!-- Only for deployments made by the release scripts (scripts/release/), which record these. -->
      <UCard v-if="data.build.commit">
        <div class="space-y-1 text-sm">
          <h2 class="font-semibold text-gray-900 dark:text-white">Running version</h2>
          <p class="text-gray-500">
            <template v-if="data.build.release"><strong>{{ data.build.release }}</strong>, </template>commit
            <a :href="`https://github.com/NuxFlow/NuxFlow/commit/${data.build.commit}`" target="_blank" rel="noopener" class="font-mono underline">{{ data.build.commit.slice(0, 7) }}</a>
          </p>
        </div>
      </UCard>
    </template>


    <UModal v-model:open="confirmOpen" title="Turn off the hosting platform?">
      <template #body>
        <p class="text-sm text-gray-500">
          Every site goes back to unlimited: plan limits stop applying, Plans and Usage are hidden, and the sign-up page closes.
          Each site keeps its plan, so turning this on again puts the limits back. Existing Stripe subscriptions are not touched.
        </p>
      </template>
      <template #footer>
        <UButton variant="ghost" @click="confirmOpen = false">Cancel</UButton>
        <UButton color="warning" :loading="saving" @click="setHosting(false)">Turn off</UButton>
      </template>
    </UModal>
  </div>
</template>
