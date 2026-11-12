<script setup lang="ts">
import type { CustomerOrder } from '#shared/lib/shop-types'

// A customer's own order, from the link in their receipt. No account needed: the link's
// token is the proof.
useSeoMeta({ title: 'Your order', robots: 'noindex,nofollow' })

const route = useRoute()
const { data, error } = await useFetch<{ order: CustomerOrder }>('/api/public/shop', {
  query: { order: route.query.order, token: route.query.token },
  server: false,
})
</script>

<template>
  <div class="max-w-xl mx-auto px-4 py-16 space-y-6">
    <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-circle-alert" title="We couldn't find this order" description="The link may be incomplete. Use the button in your receipt email." />
    <template v-else-if="data">
      <h1 class="text-2xl font-bold">Order #{{ data.order.number }}</h1>
      <p v-if="data.order.status === 'refunded'" class="text-sm text-gray-500">This order was refunded.</p>
      <p v-else-if="data.order.paidAt" class="text-sm text-gray-500">Paid on {{ formatDate(data.order.paidAt) }}.</p>
      <ShopOrderSummary :order="data.order" />
    </template>
    <p v-else class="text-gray-500">Loading…</p>
  </div>
</template>
