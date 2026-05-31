<script setup lang="ts">
defineProps<{ data: { text?: string; url?: string; variant?: 'primary' | 'outline' | 'ghost'; size?: 'sm' | 'md' | 'lg' } }>()
</script>
<template>
  <div class="my-4 flex">
    <a
      :href="data.url ?? '#'"
      class="inline-flex items-center justify-center rounded-lg px-5 py-2.5 font-medium transition-colors"
      :class="{
        'bg-primary-500 hover:bg-primary-600 text-white': (data.variant ?? 'primary') === 'primary',
        'border border-primary-500 text-primary-600 hover:bg-primary-50': data.variant === 'outline',
        'text-primary-600 hover:text-primary-700': data.variant === 'ghost',
        'text-sm px-4 py-2': data.size === 'sm',
        'text-lg px-6 py-3': data.size === 'lg',
      }"
    >
      {{ data.text }}
    </a>
  </div>
</template>
