<script setup lang="ts">
defineProps<{ loading?: boolean; error?: string }>()
defineEmits<{ next: []; back: [] }>()
</script>

<template>
  <div class="space-y-5">
    <div>
      <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Appearance</h2>
      <p class="text-sm text-gray-500 mt-1">Your site uses the NuxFlow Default theme. You can change this later.</p>
    </div>

    <!-- Theme preview card -->
    <div class="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div class="h-32 bg-gradient-to-br from-primary-50 to-white dark:from-gray-800 dark:to-gray-900 flex items-center justify-center">
        <div class="text-center">
          <div class="text-2xl font-bold text-primary-500">NuxFlow</div>
          <div class="text-xs text-gray-400 mt-1">Default Theme</div>
        </div>
      </div>
      <div class="px-4 py-3 bg-white dark:bg-gray-900 flex items-center justify-between">
        <span class="text-sm font-medium text-gray-700 dark:text-gray-300">Default</span>
        <UBadge color="green" variant="soft" size="xs">Active</UBadge>
      </div>
    </div>

    <p class="text-xs text-gray-400">More themes available in the admin panel after setup.</p>

    <UAlert v-if="error" color="red" variant="soft" :description="error" />

    <div class="flex items-center justify-between pt-2">
      <UButton variant="ghost" @click="$emit('back')">
        <UIcon name="i-lucide-arrow-left" class="mr-1 w-4 h-4" />
        Back
      </UButton>
      <UButton :loading="loading" @click="$emit('next')">
        Finish setup
        <UIcon name="i-lucide-rocket" class="ml-1 w-4 h-4" />
      </UButton>
    </div>
  </div>
</template>
