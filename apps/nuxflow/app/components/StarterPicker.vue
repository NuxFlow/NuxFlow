<script setup lang="ts">
// The grid of starter sites — used by the setup wizard, the hosting sign-up page and
// Admin → Starter sites, so a starter looks the same everywhere it's offered.
import type { StarterSummary } from '#shared/lib/starters'

const props = defineProps<{
  starters: StarterSummary[]
  /** Highlighted card (the wizard's choice). */
  selected?: string | null
  /** false = no file storage yet: starters with images can't be picked. Unset = don't check. */
  storageReady?: boolean
  /** Shows a button on each card instead of making the whole card a choice. */
  actionLabel?: string
  /** The starter the site uses now, marked "Current". */
  currentId?: string | null
  busyId?: string | null
  /** Every button off (an install is already under way). */
  disabled?: boolean
  /** Narrower cards in one column (the setup wizard's card is small). */
  compact?: boolean
}>()
const emit = defineEmits<{ select: [id: string] }>()

function blocked(s: StarterSummary): boolean {
  return props.storageReady === false && s.needsStorage
}

function choose(s: StarterSummary) {
  if (blocked(s)) return
  emit('select', s.id)
}

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}
</script>

<template>
  <div class="grid gap-4" :class="compact ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3'">
    <div
      v-for="s in starters"
      :key="s.id"
      class="group relative flex flex-col overflow-hidden rounded-xl border bg-white transition-all dark:bg-gray-900"
      :class="[
        selected === s.id
          ? 'border-primary-500 ring-2 ring-primary-500'
          : 'border-gray-200 dark:border-gray-800',
        blocked(s) ? 'opacity-60' : (actionLabel ? '' : 'cursor-pointer hover:border-primary-400 dark:hover:border-primary-600'),
      ]"
      :role="actionLabel ? undefined : 'button'"
      :tabindex="actionLabel || blocked(s) ? undefined : 0"
      :aria-pressed="actionLabel ? undefined : selected === s.id"
      :aria-disabled="blocked(s) || undefined"
      :data-starter="s.id"
      @click="actionLabel ? undefined : choose(s)"
      @keydown.enter.prevent="actionLabel ? undefined : choose(s)"
      @keydown.space.prevent="actionLabel ? undefined : choose(s)"
    >
      <div class="relative aspect-[16/9] w-full overflow-hidden bg-gray-100 dark:bg-gray-800" :class="compact ? 'aspect-[16/7]' : ''">
        <img
          v-if="s.previewUrl"
          :src="s.previewUrl"
          :alt="`Preview of the ${s.name} starter site`"
          loading="lazy"
          class="h-full w-full object-cover"
        >
        <div v-else class="flex h-full w-full items-center justify-center bg-gradient-to-br text-white" :class="s.gradient ?? 'from-gray-400 to-gray-600'">
          <UIcon :name="s.icon ?? 'i-lucide-layout-template'" class="h-10 w-10" />
        </div>
        <UBadge v-if="currentId === s.id" class="absolute left-2 top-2" color="primary" variant="solid" size="sm">Current</UBadge>
        <div
          v-if="selected === s.id"
          class="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary-500 text-white"
        >
          <UIcon name="i-lucide-check" class="h-4 w-4" />
        </div>
      </div>

      <div class="flex flex-1 flex-col gap-2 p-4">
        <div class="flex items-center gap-2">
          <span class="font-semibold text-gray-900 dark:text-white">{{ s.name }}</span>
          <UBadge size="sm" color="neutral" variant="subtle">{{ s.category }}</UBadge>
        </div>
        <p class="text-sm text-gray-500 dark:text-gray-400">{{ s.description }}</p>
        <div class="mt-auto flex flex-wrap items-center gap-2 pt-1 text-xs text-gray-500 dark:text-gray-400">
          <span v-if="s.imageCount" class="inline-flex items-center gap-1">
            <UIcon name="i-lucide-image" class="h-3.5 w-3.5" />
            {{ s.imageCount }} {{ s.imageCount === 1 ? 'image' : 'images' }} · {{ sizeLabel(s.imageBytes) }}
          </span>
          <span v-else class="inline-flex items-center gap-1">
            <UIcon name="i-lucide-type" class="h-3.5 w-3.5" />
            Text only
          </span>
          <span v-if="blocked(s)" class="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <UIcon name="i-lucide-hard-drive" class="h-3.5 w-3.5" />
            Needs file storage
          </span>
        </div>
        <UButton
          v-if="actionLabel"
          class="mt-2 self-start"
          size="sm"
          :disabled="disabled || blocked(s) || (!!busyId && busyId !== s.id)"
          :loading="busyId === s.id"
          @click="choose(s)"
        >
          {{ actionLabel }}
        </UButton>
      </div>
    </div>
  </div>
</template>
