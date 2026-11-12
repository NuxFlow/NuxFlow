<script setup lang="ts">
import { computed, inject } from 'vue'
import type { SpacingValue } from '../types'
import { spacingToCss } from '../utils/spacing'
import { blockIdKey } from '../utils/block-context'
import { useCanvasHost } from '../host'
import { canvasApiKey } from '../editor/canvasApi'

// Theme hooks: .canvas-appointment, .canvas-appointment-days, .canvas-appointment-day[aria-pressed],
// .canvas-appointment-times, .canvas-appointment-time[aria-pressed], .canvas-appointment-form.
// One-to-one appointments: the visitor picks a free time and books it. The service (length,
// price, notice…) is this block's settings; the working hours are Settings → Appointments.
// The picker and form are the app's (CanvasHost.appointmentBooking): they need its intake
// forms, spam check and payment flow, and live times can't be in the cached page.

const props = withDefaults(defineProps<{
  title?: string
  intro?: string
  serviceName?: string
  duration?: number | string
  price?: number | string
  currency?: string
  askPhone?: boolean
  bgColor?: string
  textColor?: string
  padding?: SpacingValue
}>(), {
  title: 'Book an appointment',
  intro: '',
  serviceName: '',
  duration: 60,
  price: '',
  currency: 'GBP',
  askPhone: true,
  bgColor: '',
  textColor: '',
  padding: undefined,
})

const host = useCanvasHost()
const blockId = inject(blockIdKey, '')
const inEditor = inject(canvasApiKey, null) !== null

const priceText = computed(() => {
  const n = Number(props.price)
  if (!props.price || !Number.isFinite(n) || n <= 0) return 'Free'
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: props.currency || 'GBP' }).format(n)
  }
  catch {
    return `${n} ${props.currency}`
  }
})

const containerStyle = computed(() => ({
  backgroundColor: props.bgColor || undefined,
  color: props.textColor || undefined,
  padding: spacingToCss(props.padding, '48px 24px'),
}))
</script>

<template>
  <section class="canvas-appointment" :style="containerStyle">
    <div class="mx-auto max-w-3xl">
      <h2 v-if="title" class="mb-2 text-center text-3xl font-bold">{{ title }}</h2>
      <p v-if="intro" class="mb-6 text-center opacity-80 whitespace-pre-line">{{ intro }}</p>

      <div v-if="inEditor || !host.appointmentBooking" class="rounded-xl border border-dashed border-current/30 p-6 text-center text-sm opacity-80">
        <p class="font-semibold">{{ serviceName || 'Appointment' }} · {{ duration }} minutes · {{ priceText }}</p>
        <p class="mt-2">Free times show on the published page, from your hours in Settings → Appointments.</p>
      </div>
      <component :is="host.appointmentBooking" v-else :block="blockId" :ask-phone="askPhone" />
    </div>
  </section>
</template>
