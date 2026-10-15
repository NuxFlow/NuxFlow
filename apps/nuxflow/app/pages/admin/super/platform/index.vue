<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })
useHead({ title: 'Platform' })

interface PlatformState {
  hostingEnabled: boolean
  primarySite: { id: string; name: string; domain: string } | null
  centralAuth: boolean
  sitesDomain: string | null
  stripeConfigured: boolean
  webhookSecretSet: boolean
  webhookUrl: string | null
  signUpUrl: string | null
}

// Every event the hosting webhook acts on — the operator ticks these in Stripe.
const WEBHOOK_EVENTS = ['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.paused', 'customer.subscription.resumed', 'customer.subscription.deleted']

const { data, error, refresh } = await useFetch<PlatformState>('/api/v1/admin/platform')
const access = useAdminAccessState()
const toast = useToast()

const saving = ref(false)
const confirmOpen = ref(false)
const webhookSecret = ref('')

async function save(body: Record<string, unknown>, message: string): Promise<boolean> {
  saving.value = true
  try {
    await $fetch<unknown>('/api/v1/admin/platform', { method: 'PUT', body })
    await refresh()
    toast.add({ title: message, color: 'success' })
    return true
  } catch (e: unknown) {
    toast.add({ title: getErrorMessage(e, 'Could not save'), color: 'error' })
    return false
  } finally {
    saving.value = false
  }
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
