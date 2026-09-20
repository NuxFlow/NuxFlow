<script setup lang="ts">
import type { PaymentsState } from '~/types/admin-settings'

const payments = defineModel<PaymentsState>('payments', { required: true })
defineProps<{
  domain: string
  saving: boolean
  onSave: () => Promise<void>
}>()
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between">
        <p class="text-sm font-semibold text-gray-900 dark:text-white">Membership signups</p>
        <UBadge v-if="payments.signupsDisabled" color="orange" variant="subtle" size="xs">Signups paused</UBadge>
      </div>
    </template>
    <div class="space-y-4">
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-sm font-medium text-gray-900 dark:text-white">Pause new signups</p>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Disables checkout for all membership tiers site-wide. Existing subscribers are unaffected.
          </p>
        </div>
        <USwitch v-model="payments.signupsDisabled" />
      </div>
      <UFormField v-if="payments.signupsDisabled" label="Message shown to visitors">
        <UInput
          v-model="payments.signupsDisabledMessage"
          placeholder="New signups are temporarily paused."
          class="w-full"
        />
      </UFormField>
    </div>
    <template #footer>
      <div class="flex justify-end">
        <UButton :loading="saving" @click="onSave">Save changes</UButton>
      </div>
    </template>
  </UCard>

  <UCard>
    <template #header><p class="text-sm font-semibold text-gray-900 dark:text-white">Payment gateway settings</p></template>
    <div class="space-y-6">
      <p class="text-sm text-gray-500 dark:text-gray-400">
        Configure payment gateways for paid membership subscriptions. Enabling Stripe allows automated syncing of membership tiers.
      </p>

      <!-- Stripe settings -->
      <div class="space-y-4">
        <div class="flex items-center gap-2 border-b border-gray-100 dark:border-gray-800 pb-2">
          <UIcon name="i-lucide-credit-card" class="w-5 h-5 text-primary-500" />
          <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Stripe</h3>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <UFormField label="Stripe Secret Key">
            <UInput v-model="payments.stripeSecretKey" type="password" placeholder="sk_live_..." class="w-full" />
          </UFormField>
          <UFormField label="Stripe Webhook Secret">
            <UInput v-model="payments.stripeWebhookSecret" type="password" placeholder="whsec_..." class="w-full" />
          </UFormField>
        </div>
        <p class="text-xs text-gray-400">
          To automatically update subscriptions, add a webhook in Stripe dashboard pointing to:
          <code class="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded font-mono break-all select-all">
            https://{{ domain || 'yourdomain.com' }}/api/v1/memberships/webhooks/stripe
          </code>
        </p>
      </div>

      <!-- Lemon Squeezy settings -->
      <div class="space-y-4 pt-2">
        <div class="flex items-center gap-2 border-b border-gray-100 dark:border-gray-800 pb-2">
          <UIcon name="i-lucide-wallet" class="w-5 h-5 text-primary-500" />
          <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Lemon Squeezy</h3>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <UFormField label="Lemon Squeezy API Key">
            <UInput v-model="payments.lsApiKey" type="password" placeholder="eyJ..." class="w-full" />
          </UFormField>
          <UFormField label="Lemon Squeezy Webhook Secret">
            <UInput v-model="payments.lsWebhookSecret" type="password" placeholder="Secret..." class="w-full" />
          </UFormField>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <UFormField label="Lemon Squeezy Store ID">
            <UInput v-model="payments.lsStoreId" placeholder="e.g. 12345" class="w-full" />
          </UFormField>
        </div>
        <p class="text-xs text-gray-400">
          Webhook URL for Lemon Squeezy dashboard:
          <code class="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded font-mono break-all select-all">
            https://{{ domain || 'yourdomain.com' }}/api/v1/memberships/webhooks/lemonsqueezy
          </code>
        </p>
      </div>

      <!-- Paddle settings -->
      <div class="space-y-4 pt-2">
        <div class="flex items-center gap-2 border-b border-gray-100 dark:border-gray-800 pb-2">
          <UIcon name="i-lucide-credit-card" class="w-5 h-5 text-primary-500" />
          <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Paddle</h3>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <UFormField label="Paddle API Key">
            <UInput v-model="payments.paddleApiKey" type="password" placeholder="Live_..." class="w-full" />
          </UFormField>
          <UFormField label="Paddle Webhook Secret" hint="The notification destination's secret key from Paddle — used to verify the HMAC-SHA256 signature on incoming webhooks">
            <UInput v-model="payments.paddleWebhookSecret" type="password" placeholder="pdl_ntfset_..." class="w-full" />
          </UFormField>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <UFormField label="Paddle Vendor/Merchant ID">
            <UInput v-model="payments.paddleVendorId" placeholder="e.g. 98765" class="w-full" />
          </UFormField>
        </div>
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="text-sm font-medium text-gray-900 dark:text-white">Sandbox mode</p>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Route Paddle checkout and API calls to sandbox-api.paddle.com for testing before going live.
              Use a sandbox API key/vendor ID above while this is on.
            </p>
          </div>
          <USwitch v-model="payments.paddleSandbox" />
        </div>
        <p class="text-xs text-gray-400">
          Webhook URL for Paddle dashboard:
          <code class="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded font-mono break-all select-all">
            https://{{ domain || 'yourdomain.com' }}/api/v1/memberships/webhooks/paddle
          </code>
        </p>
      </div>

    </div>
    <template #footer>
      <div class="flex justify-end">
        <UButton :loading="saving" @click="onSave">Save changes</UButton>
      </div>
    </template>
  </UCard>
</template>
