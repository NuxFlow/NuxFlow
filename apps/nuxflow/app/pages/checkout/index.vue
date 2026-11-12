<script setup lang="ts">
import type { BasketQuote } from '#shared/lib/shop-types'
import type { PublicSite } from '#shared/lib/public-site-types'
// The basket. What's in it lives in this browser (useCart); every time the page opens, the
// server prices it again and says what can't be had any more.
useSeoMeta({ title: 'Your basket', robots: 'noindex,nofollow' })

const cart = useCart()
const { data: site } = useFetch<PublicSite>('/api/public/site', { key: 'nuxflow-public-site', headers: useRequestHeaders(['host']) })
const turnstileToken = ref('')

// The last checkout this browser opened, replaced by the next one (sessionStorage: this tab only).
const PREVIOUS_KEY = 'nuxflow:checkout:last'
function previousCheckout(): { orderId: string; token: string } | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(PREVIOUS_KEY) ?? 'null') as { orderId?: unknown; token?: unknown } | null
    return typeof value?.orderId === 'string' && typeof value.token === 'string' ? { orderId: value.orderId, token: value.token } : undefined
  }
  catch {
    return undefined
  }
}

const quote = ref<BasketQuote | null>(null)
const loadError = ref('')
const email = ref('')
const acceptedTerms = ref(false)
const paying = ref(false)
const payError = ref('')

// ── Delivery or collection ──────────────────────────────────────────────────
const fulfilment = ref<'delivery' | 'collect'>('delivery')
const collectDate = ref('')
const collectTime = ref('')
const collectDays = computed(() => quote.value?.collection?.days ?? [])
const collectDay = computed(() => collectDays.value.find(d => d.date === collectDate.value))
const collectAt = computed(() => (collectDay.value ? (collectDay.value.times.length ? (collectTime.value ? `${collectDate.value}T${collectTime.value}` : '') : collectDate.value) : ''))
const collecting = computed(() => Boolean(quote.value?.collection) && fulfilment.value === 'collect')

// Only collection on offer: it's the choice. Keep a chosen day while it's still offered.
watch(quote, (q) => {
  if (q?.collection && !q.canDeliver) fulfilment.value = 'collect'
  if (!collectDays.value.some(d => d.date === collectDate.value)) collectDate.value = collectDays.value[0]?.date ?? ''
})
watch(collectDay, (day) => {
  if (!day?.times.includes(collectTime.value)) collectTime.value = day?.times[0] ?? ''
})

const lines = () => cart.items.value.map(i => ({ variantId: i.variantId, quantity: i.quantity }))
const quoted = (variantId: string) => quote.value?.lines.find(l => l.variantId === variantId)

async function load() {
  loadError.value = ''
  if (!cart.items.value.length) {
    quote.value = null
    return
  }
  try {
    // Not useAdminAction(): a visitor page, with its messages shown inline.
    quote.value = await $fetch<BasketQuote, string>('/api/public/shop', { method: 'POST', body: { action: 'quote', lines: lines() } })
  }
  catch (e: unknown) {
    loadError.value = getErrorMessage(e, 'We couldn\'t load your basket. Please try again.')
  }
}

watch(() => cart.loaded.value, (ready) => {
  if (ready) load()
}, { immediate: true })

let timer: ReturnType<typeof setTimeout> | undefined
function changeQuantity(variantId: string, quantity: number) {
  cart.setQuantity(variantId, quantity)
  clearTimeout(timer)
  timer = setTimeout(load, 300)
}

function remove(variantId: string) {
  cart.remove(variantId)
  load()
}

const problems = computed(() => quote.value?.lines.filter(l => l.problem) ?? [])
const canPay = computed(() => Boolean(quote.value && quote.value.paymentsReady && !quote.value.cannotShip && !problems.value.length
  && quote.value.lines.length && (!quote.value.returnsPath || acceptedTerms.value)
  && (!collecting.value || collectAt.value)))

async function pay() {
  payError.value = ''
  paying.value = true
  try {
    // Not useAdminAction(): a visitor page. On success the browser leaves for Stripe, so
    // `paying` stays set.
    const result = await $fetch<{ url: string; orderId: string; token: string }, string>('/api/public/shop', {
      method: 'POST',
      body: {
        action: 'checkout', lines: lines(), email: email.value || undefined, acceptedTerms: acceptedTerms.value, previous: previousCheckout(), turnstileToken: turnstileToken.value || undefined,
        ...(collecting.value ? { fulfilment: 'collect', collectAt: collectAt.value } : {}),
      },
    })
    try {
      sessionStorage.setItem(PREVIOUS_KEY, JSON.stringify({ orderId: result.orderId, token: result.token }))
    }
    catch {
      // Storage refused: the earlier checkout's stock just waits for its own time limit.
    }
    await navigateTo(result.url, { external: true })
  }
  catch (e: unknown) {
    payError.value = getErrorMessage(e, 'We couldn\'t start the payment. Please try again.')
    paying.value = false
    await load()
  }
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-12 space-y-8">
    <h1 class="text-3xl font-bold text-gray-900 dark:text-white">Your basket</h1>

    <ClientOnly>
      <div v-if="!cart.items.value.length" class="text-center py-12 space-y-4">
        <p class="text-gray-500 dark:text-gray-400">Your basket is empty.</p>
        <UButton to="/" variant="outline" color="neutral">Keep shopping</UButton>
      </div>

      <template v-else>
        <UAlert v-if="loadError" color="error" variant="soft" icon="i-lucide-circle-alert" :description="loadError" />

        <ul class="divide-y divide-gray-200 dark:divide-gray-800 border-y border-gray-200 dark:border-gray-800">
          <li v-for="item in cart.items.value" :key="item.variantId" class="flex gap-4 py-4">
            <NuxtLink :to="item.path" class="shrink-0">
              <img v-if="item.image" :src="item.image" :alt="item.title" class="h-20 w-20 rounded-lg object-cover">
              <div v-else class="h-20 w-20 rounded-lg bg-gray-100 dark:bg-gray-800" />
            </NuxtLink>
            <div class="flex-1 min-w-0 space-y-1">
              <NuxtLink :to="item.path" class="font-medium text-gray-900 dark:text-white hover:underline">{{ item.title }}</NuxtLink>
              <p v-if="item.label" class="text-sm text-gray-500">{{ item.label }}</p>
              <p v-if="quoted(item.variantId)?.problem" class="text-sm text-red-600">{{ quoted(item.variantId)?.problem }}</p>
              <div class="flex items-center gap-3 pt-1">
                <UInputNumber :model-value="item.quantity" :min="1" :max="20" size="sm" class="w-28" :aria-label="`Quantity of ${item.title}`" @update:model-value="changeQuantity(item.variantId, Number($event))" />
                <UButton size="sm" variant="ghost" color="neutral" @click="remove(item.variantId)">Remove</UButton>
              </div>
            </div>
            <p class="text-right font-medium">{{ quoted(item.variantId)?.total ?? item.price }}</p>
          </li>
        </ul>

        <div v-if="quote" class="space-y-2 text-sm">
          <div class="flex justify-between"><span>Subtotal</span><span>{{ quote.subtotal }}</span></div>
          <div v-if="quote.shipping && !collecting" class="flex justify-between"><span>Delivery</span><span>{{ quote.shipping }}</span></div>
          <p class="text-gray-500">{{ quote.taxAtCheckout ? 'Tax is added at the next step.' : quote.pricesIncludeTax ? 'Prices include tax.' : 'Prices don\'t include tax.' }}</p>
        </div>

        <fieldset v-if="quote?.collection" class="space-y-3 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <legend class="px-1 text-sm font-semibold">Getting your order</legend>
          <URadioGroup
            v-if="quote.canDeliver"
            v-model="fulfilment"
            :items="[{ label: `Delivery${quote.shipping ? ` (${quote.shipping})` : ''}`, value: 'delivery' }, { label: `${quote.collection.label} (free)`, value: 'collect' }]"
            aria-label="Delivery or collection"
          />
          <template v-if="collecting">
            <p v-if="!collectDays.length" class="text-sm text-amber-700 dark:text-amber-400">There are no collection times in the next few days. Please try again later.</p>
            <div v-else class="flex flex-wrap gap-3">
              <UFormField label="Day">
                <USelect v-model="collectDate" :items="collectDays.map(d => ({ label: d.label, value: d.date }))" class="w-44" />
              </UFormField>
              <UFormField v-if="collectDay?.times.length" label="Time">
                <USelect v-model="collectTime" :items="collectDay.times.map(t => ({ label: t, value: t }))" class="w-28" />
              </UFormField>
            </div>
            <p v-if="quote.collection.instructions" class="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-line">{{ quote.collection.instructions }}</p>
          </template>
        </fieldset>

        <form class="space-y-4" @submit.prevent="pay">
          <UFormField label="Email for your receipt" hint="Optional: you can also give it on the payment page">
            <UInput v-model="email" type="email" maxlength="254" autocomplete="email" class="w-full" />
          </UFormField>
          <UCheckbox v-if="quote?.returnsPath" v-model="acceptedTerms">
            <template #label>
              I've read the <NuxtLink :to="quote.returnsPath" target="_blank" class="underline">returns policy</NuxtLink>
            </template>
          </UCheckbox>
          <NuxtTurnstile v-if="site?.turnstileSiteKey" v-model="turnstileToken" :site-key="site.turnstileSiteKey" />
          <UAlert v-if="quote && !quote.paymentsReady" color="warning" variant="soft" icon="i-lucide-credit-card" description="This shop can't take payments at the moment. Please try again later." />
          <UAlert v-else-if="quote?.cannotShip" color="warning" variant="soft" icon="i-lucide-truck" description="This shop isn't posting anything at the moment." />
          <UAlert v-else-if="problems.length" color="warning" variant="soft" icon="i-lucide-triangle-alert" description="Some things in your basket can't be bought as they are. Change or remove them to carry on." />
          <UAlert v-if="payError" color="error" variant="soft" icon="i-lucide-circle-alert" :description="payError" />
          <div class="flex flex-wrap items-center justify-between gap-3">
            <UButton to="/" variant="ghost" color="neutral">Keep shopping</UButton>
            <UButton type="submit" size="lg" icon="i-lucide-lock" :loading="paying" :disabled="!canPay">Pay securely</UButton>
          </div>
          <p class="text-xs text-gray-500">You'll pay on Stripe's secure page{{ quote?.shipping && !collecting ? ' and give your delivery address there' : '' }}.</p>
        </form>
      </template>
    </ClientOnly>
  </div>
</template>
