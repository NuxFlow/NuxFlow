<script setup lang="ts">
import type { SiteBranding } from '~/types/accounts'

// The site someone is signing in to, shown on the accounts origin's pages — its name,
// logo and colour as plain data from GET /api/accounts/site. Never the site's own theme
// or scripts: keeping those off this origin is the reason it exists.

defineProps<{ site: SiteBranding | null; fallbackIcon?: string; heading: string; subheading?: string }>()
</script>

<template>
  <div class="text-center">
    <img
      v-if="site?.logoUrl"
      :src="site.logoUrl"
      :alt="site.name"
      class="mx-auto mb-4 h-12 max-w-[200px] object-contain"
      referrerpolicy="no-referrer"
    >
    <div
      v-else
      class="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-primary-500 mb-4 shadow-lg shadow-primary-500/30"
      :style="site?.primaryColor ? { backgroundColor: site.primaryColor } : undefined"
    >
      <UIcon :name="fallbackIcon ?? 'i-lucide-layers'" class="w-6 h-6 text-white" />
    </div>
    <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ heading }}</h1>
    <p v-if="subheading" class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ subheading }}</p>
  </div>
</template>
