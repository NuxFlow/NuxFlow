<script setup lang="ts">
// Admin → Appointments: one-to-one bookings made through Book an AdminAppointment blocks
// (server/utils/appointments.ts). Read and changed through /_nuxflow/appointments (not /api;
// see that route). Cancelling here always refunds what was paid and emails the customer.
import type { AdminAppointment, AdminAppointmentList } from '#shared/lib/booking-types'

definePageMeta({ layout: 'admin', middleware: ['auth'] })
useSeoMeta({ title: 'Appointments' })

const scope = ref<'upcoming' | 'past'>('upcoming')
const url = computed<string>(() => `/_nuxflow/appointments?team=${scope.value}`)
const { data, error, refresh, pending } = useFetch<AdminAppointmentList>(url, { server: false })
const { run, isRunning } = useAdminAction()
const { confirm } = useConfirm()

const STATUS: Record<AdminAppointment['status'], { label: string; color: 'success' | 'warning' | 'neutral' | 'info' }> = {
  confirmed: { label: 'Booked', color: 'success' },
  pending: { label: 'Waiting for email confirmation', color: 'warning' },
  held: { label: 'Paying now', color: 'info' },
  cancelled: { label: 'Cancelled', color: 'neutral' },
}

async function cancel(a: AdminAppointment) {
  const paid = a.paymentStatus === 'paid'
  const ok = await confirm({
    title: `Cancel ${a.name}'s appointment?`,
    description: `${a.service}, ${a.when}. We'll email them${paid ? ' and refund their payment in full' : ''}.`,
    confirmLabel: 'Cancel appointment',
    color: 'error',
  })
  if (!ok) return
  const res = await run(() => $fetch<{ refunded: boolean }>('/_nuxflow/appointments', { method: 'POST', body: { action: 'team-cancel', id: a.id } }), {
    successTitle: r => (r.refunded ? 'Cancelled and refunded' : 'Appointment cancelled'),
    errorTitle: 'Couldn\'t cancel the appointment',
    key: `cancel:${a.id}`,
  })
  if (res) await refresh()
}
</script>

<template>
  <div class="max-w-5xl mx-auto space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-bold text-gray-900 dark:text-white">Appointments</h1>
        <p class="text-sm text-gray-500 dark:text-gray-400">
          One-to-one bookings from Book an Appointment blocks. Set your hours in
          <NuxtLink to="/admin/settings" class="underline">Settings → Appointments</NuxtLink>.
        </p>
      </div>
      <div class="flex gap-2">
        <UButton size="sm" :variant="scope === 'upcoming' ? 'solid' : 'outline'" @click="scope = 'upcoming'">Upcoming</UButton>
        <UButton size="sm" :variant="scope === 'past' ? 'solid' : 'outline'" @click="scope = 'past'">Past</UButton>
        <UButton size="sm" variant="ghost" icon="i-lucide-refresh-cw" :loading="pending" aria-label="Refresh appointments" @click="refresh()" />
      </div>
    </div>

    <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-circle-alert" :description="getErrorMessage(error, 'Could not load appointments')" />

    <p v-if="data && !data.appointments.length" class="text-sm text-gray-500">
      {{ scope === 'upcoming' ? 'Nothing booked yet.' : 'No past appointments.' }}
    </p>

    <ul v-if="data?.appointments.length" class="space-y-2">
      <li v-for="a in data.appointments" :key="a.id" class="rounded-xl border border-gray-200 dark:border-gray-800 p-4 flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0 space-y-0.5">
          <p class="font-medium text-gray-900 dark:text-white">{{ a.when }}</p>
          <p class="text-sm">{{ a.service }} · {{ a.name }}</p>
          <p class="text-xs text-gray-500">
            <a :href="`mailto:${a.email}`" class="underline">{{ a.email }}</a>
            <template v-if="a.phone"> · <a :href="`tel:${a.phone}`" class="underline">{{ a.phone }}</a></template>
            <template v-if="a.price"> · {{ formatPrice(a.price, a.currency ?? 'GBP') }}{{ a.paymentStatus === 'refunded' ? ' (refunded)' : a.paymentStatus === 'paid' ? ' paid' : '' }}</template>
          </p>
          <p v-if="a.note" class="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap">"{{ a.note }}"</p>
        </div>
        <div class="flex items-center gap-2">
          <UBadge :color="STATUS[a.status].color" variant="soft" size="sm">{{ STATUS[a.status].label }}</UBadge>
          <UButton v-if="a.status !== 'cancelled' && scope === 'upcoming'" size="xs" variant="outline" color="error" :loading="isRunning(`cancel:${a.id}`)" @click="cancel(a)">Cancel</UButton>
        </div>
      </li>
    </ul>
  </div>
</template>
