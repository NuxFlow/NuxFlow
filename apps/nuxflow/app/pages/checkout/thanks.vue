<script setup lang="ts">
import type { CustomerOrder } from '~/components/shop/OrderSummary.vue'

// Where Stripe sends someone after paying. The payment is confirmed by Stripe's webhook,
// which can land a moment after this page, so it waits a little for the order to say paid.
useSeoMeta({ title: 'Thank you', robots: 'noindex,nofollow' })

const route = useRoute()
const cart = useCart()
const order = ref<CustomerOrder | null>(null)
const failed = ref(false)

async function fetchOrder() {
  try {
    // Not useAdminAction(): a visitor page.
    const result = await $fetch<{ order: CustomerOrder }>('/api/public/shop', { query: { order: route.query.order, token: route.query.token } })
    order.value = result.order
  }
  catch {
    failed.value = true
  }
}

const { start } = usePollingUntil({
  intervalMs: 2000,
  timeoutMs: 30_000,
  onTick: fetchOrder,
  until: () => failed.value || (order.value !== null && order.value.status !== 'pending'),
})

onMounted(() => {
  // They've paid: the basket has done its job, and there's no earlier checkout to replace.
  cart.clear()
  try {
    sessionStorage.removeItem('nuxflow:checkout:last')
  }
  catch {
    // Nothing to clear.
  }
  start()
})
</script>

<template>
  <div class="max-w-xl mx-auto px-4 py-16 space-y-6 text-center">
    <UIcon name="i-lucide-circle-check" class="w-12 h-12 text-green-600 dark:text-green-400 mx-auto" />
    <h1 class="text-2xl font-bold">Thank you</h1>
    <template v-if="order && order.status !== 'pending'">
      <p v-if="order.status === 'refunded'" class="opacity-80">Sorry, this sold out just before your payment arrived, so we've refunded you in full.</p>
      <p v-else class="opacity-80">
        Your order #{{ order.number }} is confirmed.<template v-if="order.email"> We've emailed a receipt to {{ order.email }}.</template>
      </p>
      <ShopOrderSummary :order="order" />
    </template>
    <p v-else class="opacity-80">Your payment went through. We're confirming your order and will email you a receipt.</p>
    <UButton to="/" variant="ghost">Back to the shop</UButton>
  </div>
</template>
