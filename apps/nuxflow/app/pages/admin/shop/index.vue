<script setup lang="ts">
import { fromMinorUnits, toMinorUnits } from '#shared/lib/money'

definePageMeta({ layout: 'admin', middleware: ['auth'] })
useHead({ title: 'Shop' })

interface ShopSettings {
  enabled: boolean
  currency: string
  pricesIncludeTax: boolean
  stripeTax: boolean
  shippingCountries: string[]
  shippingLabel: string
  shippingRateMinor: number
  freeShippingOverMinor: number | null
  collectionEnabled: boolean
  collectionLabel: string
  collectionInstructions: string
  collectionLeadMinutes: number
  collectionDays: number
  returnsPage: string
  downloadLimit: number
  downloadDays: number
}

interface ShopStatus {
  settings: ShopSettings
  inPlan: boolean
  paymentsReady: boolean
  productCount: number
  hasProductType: boolean
}

const { data, error, refresh } = useFetch<ShopStatus>('/api/v1/shop', { server: false })
const { run, isRunning } = useAdminAction()
const access = useAdminAccessState()

const form = reactive({
  currency: 'GBP',
  pricesIncludeTax: true,
  stripeTax: false,
  // Typed as text ("GB, IE, US"); sent as a list.
  countries: 'GB',
  shippingLabel: 'Standard delivery',
  shippingRate: 0,
  freeOver: null as number | null,
  collectionEnabled: false,
  collectionLabel: 'Collect in person',
  collectionInstructions: '',
  collectionLeadMinutes: 60,
  collectionDays: 3,
  returnsPage: '',
  downloadLimit: 5,
  downloadDays: 30,
})
watch(() => data.value?.settings, (s) => {
  if (!s) return
  Object.assign(form, {
    currency: s.currency,
    pricesIncludeTax: s.pricesIncludeTax,
    stripeTax: s.stripeTax,
    countries: s.shippingCountries.join(', '),
    shippingLabel: s.shippingLabel,
    shippingRate: fromMinorUnits(s.shippingRateMinor, s.currency),
    freeOver: s.freeShippingOverMinor === null ? null : fromMinorUnits(s.freeShippingOverMinor, s.currency),
    collectionEnabled: s.collectionEnabled,
    collectionLabel: s.collectionLabel,
    collectionInstructions: s.collectionInstructions,
    collectionLeadMinutes: s.collectionLeadMinutes,
    collectionDays: s.collectionDays,
    returnsPage: s.returnsPage,
    downloadLimit: s.downloadLimit,
    downloadDays: s.downloadDays,
  })
}, { immediate: true })

const taxItems = [
  { label: 'Prices include tax (usual in the UK and EU)', value: 'inclusive' },
  { label: 'Tax is added at checkout (usual in the US)', value: 'exclusive' },
]
const taxMode = computed({
  get: () => (form.pricesIncludeTax ? 'inclusive' : 'exclusive'),
  set: (v: string) => { form.pricesIncludeTax = v === 'inclusive' },
})

async function setEnabled(enabled: boolean) {
  await run(async () => {
    const result = await $fetch<{ settings: ShopSettings }, string>('/api/v1/shop', { method: 'POST', body: { action: 'settings', enabled } })
    if (access.value) access.value = { ...access.value, shop: result.settings.enabled }
    await refresh()
  }, { key: 'switch', successTitle: enabled ? 'The shop is on' : 'The shop is off', errorTitle: enabled ? 'Couldn\'t turn the shop on' : 'Couldn\'t turn the shop off' })
}

async function saveSettings() {
  await run(async () => {
    const config = {
      currency: form.currency,
      pricesIncludeTax: form.pricesIncludeTax,
      stripeTax: form.stripeTax,
      shippingCountries: form.countries.split(/[\s,]+/).map(c => c.trim().toUpperCase()).filter(Boolean),
      shippingLabel: form.shippingLabel,
      shippingRateMinor: toMinorUnits(Number(form.shippingRate) || 0, form.currency),
      freeShippingOverMinor: form.freeOver === null || String(form.freeOver) === '' ? null : toMinorUnits(Number(form.freeOver), form.currency),
      collectionEnabled: form.collectionEnabled,
      collectionLabel: form.collectionLabel.trim() || 'Collect in person',
      collectionInstructions: form.collectionInstructions.trim(),
      collectionLeadMinutes: Number(form.collectionLeadMinutes) || 0,
      collectionDays: Number(form.collectionDays) || 0,
      returnsPage: form.returnsPage.trim(),
      downloadLimit: Number(form.downloadLimit),
      downloadDays: Number(form.downloadDays),
    }
    await $fetch<unknown, string>('/api/v1/shop', { method: 'POST', body: { action: 'settings', config } })
    await refresh()
  }, { key: 'save', successTitle: 'Shop settings saved', errorTitle: 'Couldn\'t save the shop settings' })
}
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6">
    <div>
      <h1 class="text-xl font-bold text-gray-900 dark:text-white">Shop</h1>
      <p class="text-sm text-gray-500 dark:text-gray-400">Sell physical and digital products from your site. People pay on Stripe's checkout, into your own Stripe account.</p>
    </div>

    <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-circle-alert" :description="getErrorMessage(error, 'Could not load the shop')" />

    <template v-if="data">
      <UAlert v-if="!data.inPlan" color="warning" variant="soft" icon="i-lucide-lock" title="Your plan doesn't include a shop" description="Ask about a bigger plan to sell products." />

      <UCard>
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 class="font-semibold">{{ data.settings.enabled ? 'The shop is on' : 'The shop is off' }}</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
              <template v-if="data.settings.enabled">Products you publish are on sale. {{ data.productCount === 1 ? '1 product' : `${data.productCount} products` }} so far.</template>
              <template v-else>Turning it on adds Products to the admin menu and a Collections taxonomy for grouping them. Turning it off hides the shop and deletes nothing.</template>
            </p>
          </div>
          <div class="flex gap-2">
            <UButton v-if="data.settings.enabled" to="/admin/content/new?type=product" icon="i-lucide-plus" size="sm">New product</UButton>
            <UButton
              :color="data.settings.enabled ? 'neutral' : 'primary'"
              :variant="data.settings.enabled ? 'outline' : 'solid'"
              size="sm"
              :disabled="!data.inPlan && !data.settings.enabled"
              :loading="isRunning('switch')"
              @click="setEnabled(!data.settings.enabled)"
            >
              {{ data.settings.enabled ? 'Turn off' : 'Turn the shop on' }}
            </UButton>
          </div>
        </div>
        <UAlert
          v-if="data.settings.enabled && !data.paymentsReady"
          class="mt-4"
          color="warning"
          variant="soft"
          icon="i-lucide-credit-card"
          title="Payments aren't set up yet"
          description="Add your Stripe secret key and webhook secret in Settings → Payments before anyone can buy."
        />
      </UCard>

      <UCard>
        <form class="space-y-4" @submit.prevent="saveSettings">
          <h2 class="font-semibold">Prices and tax</h2>
          <UFormField label="Currency" hint="Every price in the shop is in this currency. Changing it doesn't convert prices you've already entered." required>
            <UInput v-model="form.currency" maxlength="3" required class="w-24 uppercase" />
          </UFormField>
          <UFormField label="Prices you enter">
            <URadioGroup v-model="taxMode" :items="taxItems" />
          </UFormField>
          <UFormField label="Collect tax with Stripe Tax">
            <USwitch v-model="form.stripeTax" label="Work out and collect VAT or sales tax at checkout" />
            <template #help>
              Stripe charges an extra fee per sale for this. It only collects tax where you've told Stripe you're registered, which is your job to arrange. Leave it off if you aren't registered for VAT or sales tax.
            </template>
          </UFormField>

          <h2 class="font-semibold pt-2">Delivery</h2>
          <UFormField label="Countries you post to" hint="Two-letter codes, separated by commas, such as GB, IE, FR, US. Leave empty to sell downloads only.">
            <UInput v-model="form.countries" class="w-full uppercase" />
          </UFormField>
          <div class="grid gap-3 sm:grid-cols-3">
            <UFormField label="Delivery name" required><UInput v-model="form.shippingLabel" maxlength="100" required class="w-full" /></UFormField>
            <UFormField :label="`Price per order (${form.currency})`"><UInput v-model.number="form.shippingRate" type="number" min="0" step="0.01" class="w-full" /></UFormField>
            <UFormField :label="`Free from (${form.currency})`" hint="Blank: never free"><UInput v-model.number="form.freeOver" type="number" min="0" step="0.01" class="w-full" /></UFormField>
          </div>

          <h2 class="font-semibold pt-2">Click and collect</h2>
          <USwitch v-model="form.collectionEnabled" label="Let customers collect their order instead of having it posted" />
          <template v-if="form.collectionEnabled">
            <div class="grid gap-3 sm:grid-cols-3">
              <UFormField label="Name at checkout"><UInput v-model="form.collectionLabel" maxlength="100" class="w-full" /></UFormField>
              <UFormField label="Notice needed (minutes)" hint="e.g. 60"><UInput v-model.number="form.collectionLeadMinutes" type="number" min="0" max="10080" class="w-full" /></UFormField>
              <UFormField label="Days ahead to offer" hint="0 = today only"><UInput v-model.number="form.collectionDays" type="number" min="0" max="14" class="w-full" /></UFormField>
            </div>
            <UFormField label="Where and how to collect" hint="Shown at checkout and in the receipt, e.g. the address and which door.">
              <UTextarea v-model="form.collectionInstructions" :rows="2" maxlength="500" class="w-full" />
            </UFormField>
            <p class="text-xs text-gray-500">
              Customers choose a time every 15 minutes within your opening hours in
              <NuxtLink to="/admin/settings?tab=Business" class="underline">Settings → Business</NuxtLink>
              (holiday hours included). Without opening hours, they choose a day. Collection is free.
            </p>
          </template>

          <h2 class="font-semibold pt-2">Returns</h2>
          <UFormField label="Returns policy page" hint="The slug of a page you've written, such as returns. Buyers tick a box to say they've read it. In the UK and EU people buying online can usually cancel within 14 days; this isn't legal advice, so check what applies to you.">
            <UInput v-model="form.returnsPage" placeholder="returns" class="w-64" />
          </UFormField>

          <h2 class="font-semibold pt-2">Downloads</h2>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField label="Downloads per purchase" required><UInput v-model.number="form.downloadLimit" type="number" min="1" max="100" required class="w-32" /></UFormField>
            <UFormField label="Link works for (days)" required><UInput v-model.number="form.downloadDays" type="number" min="1" max="3650" required class="w-32" /></UFormField>
          </div>

          <div class="flex justify-end">
            <UButton type="submit" :loading="isRunning('save')">Save</UButton>
          </div>
        </form>
      </UCard>
    </template>
  </div>
</template>
