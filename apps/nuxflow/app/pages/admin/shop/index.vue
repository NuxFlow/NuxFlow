<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })
useHead({ title: 'Shop' })

interface ShopSettings {
  enabled: boolean
  currency: string
  pricesIncludeTax: boolean
  stripeTax: boolean
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

const form = reactive({ currency: 'GBP', pricesIncludeTax: true, stripeTax: false })
watch(() => data.value?.settings, (s) => {
  if (s) Object.assign(form, { currency: s.currency, pricesIncludeTax: s.pricesIncludeTax, stripeTax: s.stripeTax })
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
    await $fetch<unknown, string>('/api/v1/shop', { method: 'POST', body: { action: 'settings', config: { ...form } } })
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
          <div class="flex justify-end">
            <UButton type="submit" :loading="isRunning('save')">Save</UButton>
          </div>
        </form>
      </UCard>
    </template>
  </div>
</template>
