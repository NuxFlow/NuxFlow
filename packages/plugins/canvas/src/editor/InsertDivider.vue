<script setup lang="ts">
const emit = defineEmits<{ click: [] }>()
</script>

<template>
  <div
    class="group relative h-4 flex items-center justify-center cursor-pointer"
    @click="emit('click')"
  >
    <div class="divider-line absolute inset-x-0 h-px bg-transparent group-hover:bg-primary-300 dark:group-hover:bg-primary-700 transition-colors" />
    <button
      class="divider-btn relative hidden group-hover:flex items-center justify-center w-5 h-5 rounded-full bg-primary-500 text-white text-xs shadow transition-all"
      tabindex="-1"
    >
      +
    </button>
  </div>
</template>

<style scoped>
@media (hover: none) {
  .divider-line {
    background-color: rgb(229 231 235 / 0.5);
  }
  :global(.dark) .divider-line {
    background-color: rgb(31 41 55 / 0.5);
  }
  .divider-btn {
    display: flex !important;
    opacity: 0.6;
  }
}
</style>
