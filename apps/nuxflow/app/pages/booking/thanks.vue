<script setup lang="ts">
// Where Stripe sends someone back to after paying. The payment itself is confirmed by
// Stripe's webhook, which can land a moment after this page, so it says the email is the
// confirmation rather than claiming the booking is already done.
useSeoMeta({ title: 'Thank you', robots: 'noindex,nofollow' })

const route = useRoute()
const isPass = computed(() => route.query.type === 'pass')
</script>

<template>
  <div class="max-w-md mx-auto px-4 py-20 text-center space-y-4">
    <UIcon name="i-lucide-circle-check" class="w-12 h-12 text-green-600 dark:text-green-400 mx-auto" />
    <h1 class="text-2xl font-bold">Thank you</h1>
    <p class="opacity-80">
      {{ isPass
        ? 'Your payment went through. We\'re adding the pass to your email address and will email you how to use it.'
        : route.query.type === 'appointment'
          ? 'Your payment went through. We\'re confirming your appointment and will email you the details.'
          : 'Your payment went through. We\'re confirming your place and will email you the details.' }}
    </p>
    <p class="text-sm opacity-70">If nothing arrives within a few minutes, check your spam folder.</p>
    <UButton to="/booking/my" variant="ghost">My bookings and passes</UButton>
  </div>
</template>
