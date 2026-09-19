<script setup lang="ts">
defineProps<{
  hasChanges: boolean
  saving: boolean
  customizerThemeId: string | null
  onSave: () => Promise<void> | void
}>()

const device = defineModel<'desktop' | 'tablet' | 'mobile'>('device', { required: true })

const deviceOptions = [
  { value: 'desktop' as const, label: 'Desktop', icon: 'i-lucide-monitor' },
  { value: 'tablet' as const, label: 'Tablet', icon: 'i-lucide-tablet' },
  { value: 'mobile' as const, label: 'Mobile', icon: 'i-lucide-smartphone' },
]
</script>

<template>
  <header class="h-14 shrink-0 border-b border-gray-200 dark:border-gray-800 flex items-center gap-3 px-4 bg-white dark:bg-gray-950">
    <!-- Back link -->
    <NuxtLink
      to="/admin/themes"
      class="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors shrink-0"
    >
      <UIcon name="i-lucide-arrow-left" class="w-4 h-4" />
      <span class="hidden sm:inline">Themes</span>
    </NuxtLink>

    <!-- Title -->
    <div class="flex-1 flex items-center justify-center gap-2 min-w-0">
      <UIcon name="i-lucide-palette" class="w-4 h-4 text-gray-400 shrink-0" />
      <span class="text-sm font-semibold text-gray-700 dark:text-gray-200 truncate">Visual Customizer</span>
      <Transition
        enter-active-class="transition-all duration-200"
        enter-from-class="opacity-0 scale-90"
        leave-active-class="transition-all duration-200"
        leave-to-class="opacity-0 scale-90"
      >
        <span v-if="hasChanges" class="text-xs font-medium text-amber-500 dark:text-amber-400 shrink-0">
          • Unsaved
        </span>
      </Transition>
    </div>

    <!-- Device toggles + Publish -->
    <div class="flex items-center gap-2 shrink-0">
      <div class="hidden sm:flex gap-0.5 bg-gray-100 dark:bg-gray-800 p-0.5 rounded-lg">
        <button
          v-for="d in deviceOptions"
          :key="d.value"
          :title="d.label"
          class="p-1.5 rounded-md transition-colors"
          :class="device === d.value
            ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white'
            : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'"
          @click="device = d.value"
        >
          <UIcon :name="d.icon" class="w-4 h-4" />
        </button>
      </div>

      <UButton
        size="sm"
        icon="i-lucide-upload-cloud"
        :loading="saving"
        :disabled="!hasChanges && !!customizerThemeId"
        @click="onSave"
      >
        Publish
      </UButton>
    </div>
  </header>
</template>
