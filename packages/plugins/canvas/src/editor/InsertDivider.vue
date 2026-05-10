<script setup lang="ts">
const emit = defineEmits<{ click: [] }>()
</script>

<template>
  <div
    class="group relative h-3 flex items-center justify-center cursor-pointer"
    @click="emit('click')"
  >
    <div class="absolute inset-x-0 h-px bg-transparent group-hover:bg-primary-300 dark:group-hover:bg-primary-700 transition-colors" />
    <button
      class="relative hidden group-hover:flex items-center justify-center w-5 h-5 rounded-full bg-primary-500 text-white text-xs shadow transition-all"
      tabindex="-1"
    >
      +
    </button>
  </div>
</template>
