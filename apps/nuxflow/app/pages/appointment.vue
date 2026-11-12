<script setup lang="ts">
import type { AppointmentLinkResult } from '#shared/lib/booking-types'
// Where an appointment email's links land (server/utils/appointments.ts):
// ?do=confirm|cancel&id=&token=. Nothing happens until the button is pressed, because mail
// scanners open links. Reads and posts /_nuxflow/appointments (not /api; see that route).
useSeoMeta({ title: 'Your appointment', robots: 'noindex,nofollow' })

const route = useRoute()
const action = computed(() => (route.query.do === 'cancel' ? 'cancel' : 'confirm'))
const id = computed(() => String(route.query.id ?? ''))
const token = computed(() => String(route.query.token ?? ''))

const info = ref<AppointmentLinkResult | null>(null)
const done = ref<AppointmentLinkResult | null>(null)
const failed = ref('')
const busy = ref(false)

onMounted(async () => {
  try {
    info.value = await $fetch<AppointmentLinkResult>('/_nuxflow/appointments', { query: { do: action.value, id: id.value, token: token.value } })
  }
  catch (e: unknown) {
    failed.value = getErrorMessage(e, 'This link isn\'t valid.')
  }
})

async function press() {
  busy.value = true
  failed.value = ''
  try {
    done.value = await $fetch<AppointmentLinkResult>('/_nuxflow/appointments', { method: 'POST', body: { action: action.value, id: id.value, token: token.value } })
  }
  catch (e: unknown) {
    failed.value = getErrorMessage(e, 'Something went wrong. Please try again.')
  }
  finally {
    busy.value = false
  }
}

const shown = computed(() => done.value ?? info.value)
</script>

<template>
  <div class="max-w-md mx-auto px-4 py-20 space-y-4 text-center">
    <h1 class="text-2xl font-bold">{{ action === 'cancel' ? 'Cancel your appointment' : 'Confirm your appointment' }}</h1>
    <p v-if="failed" class="text-red-600 dark:text-red-400" role="alert">{{ failed }}</p>

    <template v-if="shown">
      <p class="font-semibold">{{ shown.service }}</p>
      <p class="opacity-80">{{ shown.when }}</p>

      <div role="status" class="space-y-3">
        <template v-if="done">
          <p v-if="done.status === 'confirmed'" class="font-medium">You're booked. We've emailed you the details.</p>
          <p v-else-if="done.status === 'taken'" class="font-medium">Sorry, that time has gone to someone else. Please choose another.</p>
          <p v-else-if="done.status === 'cancelled'" class="font-medium">
            Your appointment is cancelled.{{ done.refund ? ' Your payment has been refunded; it can take a few days to reach your account.' : '' }}
          </p>
          <p v-else-if="done.tooLate" class="font-medium">This appointment has already started, so it can't be cancelled here.</p>
        </template>

        <template v-else-if="info">
          <p v-if="info.status === 'cancelled'">This appointment has been cancelled.</p>
          <p v-else-if="action === 'confirm' && info.status === 'confirmed'">This appointment is already confirmed.</p>
          <template v-else-if="action === 'confirm'">
            <UButton :loading="busy" size="lg" @click="press">Yes, confirm my appointment</UButton>
          </template>
          <template v-else>
            <p v-if="info.refund" class="text-sm opacity-80">You'll get your payment back.</p>
            <p v-else-if="info.tooLate" class="text-sm opacity-80">It's too late to get a refund, but you can still cancel to free the time.</p>
            <UButton :loading="busy" size="lg" color="error" @click="press">Cancel my appointment</UButton>
          </template>
        </template>
      </div>

      <UButton :to="shown.path" variant="ghost">Back to the site</UButton>
    </template>
  </div>
</template>
