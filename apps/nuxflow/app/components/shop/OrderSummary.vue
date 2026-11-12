<script setup lang="ts">
import type { CustomerOrder } from '#shared/lib/shop-types'
// A customer's order as their signed link shows it: on the thank-you page and the order page.
const props = defineProps<{ order: CustomerOrder }>()

const address = computed(() => {
  const a = props.order.shippingAddress
  return a ? [a.name, a.line1, a.line2, a.city, a.state, a.postalCode, a.country].filter(Boolean) : []
})
</script>

<template>
  <div class="space-y-6 text-left">
    <ul class="divide-y divide-gray-200 dark:divide-gray-800 border-y border-gray-200 dark:border-gray-800">
      <li v-for="line in order.lines" :key="line.id" class="py-3 space-y-2">
        <div class="flex justify-between gap-3">
          <span>{{ line.quantity }} × {{ line.name }}<span v-if="line.description" class="text-gray-500"> ({{ line.description }})</span></span>
          <span class="font-medium">{{ line.total }}</span>
        </div>
        <div v-if="line.download" class="flex flex-wrap items-center gap-3">
          <UButton v-if="line.download.available" :href="line.download.url" size="sm" icon="i-lucide-download" external>Download</UButton>
          <span class="text-xs text-gray-500">
            <template v-if="line.download.available">{{ line.download.left === 1 ? '1 download left' : `${line.download.left} downloads left` }}, until {{ formatDate(line.download.expiresAt) }}</template>
            <template v-else>This download has run out. Contact the shop if you still need it.</template>
          </span>
        </div>
      </li>
    </ul>
    <dl class="text-sm space-y-1">
      <div class="flex justify-between"><dt>Subtotal</dt><dd>{{ order.subtotal }}</dd></div>
      <div v-if="order.shipping" class="flex justify-between"><dt>Delivery</dt><dd>{{ order.shipping }}</dd></div>
      <div v-if="order.tax" class="flex justify-between"><dt>Tax</dt><dd>{{ order.tax }}</dd></div>
      <div class="flex justify-between font-semibold"><dt>Total</dt><dd>{{ order.total }}</dd></div>
      <div v-if="order.refunded" class="flex justify-between text-gray-500"><dt>Refunded</dt><dd>{{ order.refunded }}</dd></div>
    </dl>
    <div v-if="order.collection" class="text-sm">
      <p class="font-medium">{{ order.collection.label }}: {{ order.collection.when }}</p>
      <p v-if="order.collection.instructions" class="text-gray-600 dark:text-gray-400 whitespace-pre-line">{{ order.collection.instructions }}</p>
    </div>
    <div v-if="address.length" class="text-sm">
      <p class="font-medium">Posting to</p>
      <p class="text-gray-600 dark:text-gray-400">{{ address.join(', ') }}</p>
    </div>
  </div>
</template>
