<script setup lang="ts">
import { timeZoneOptions } from '#shared/lib/site-locale'

// Every IANA timezone the browser knows, searchable, each with its current UTC offset.
const model = defineModel<string>({ required: true })

function offsetLabel(zone: string): string {
  try {
    const part = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'longOffset' })
      .formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value
    return part === 'GMT' ? 'UTC+00:00' : (part ?? '').replace('GMT', 'UTC')
  } catch {
    return ''
  }
}

const items = computed(() => {
  const zones = timeZoneOptions()
  if (model.value && !zones.includes(model.value)) zones.push(model.value)
  return zones.map(zone => {
    const offset = offsetLabel(zone)
    return { label: offset ? `${zone.replaceAll('_', ' ')} (${offset})` : zone, value: zone }
  })
})
</script>

<template>
  <USelectMenu
    v-model="model"
    :items="items"
    value-key="value"
    :search-input="{ placeholder: 'Search, e.g. London' }"
    class="w-full"
  />
</template>
