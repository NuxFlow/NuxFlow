<script setup lang="ts">
defineProps<{ data: { src?: string; alt?: string; caption?: string; width?: number; height?: number } }>()
</script>
<template>
  <figure class="my-4">
    <img :src="data.src" :alt="data.alt ?? ''" :width="data.width" :height="data.height" class="rounded-lg w-full object-cover" loading="lazy" />
    <figcaption v-if="data.caption" class="mt-2 text-center text-sm text-gray-400">{{ data.caption }}</figcaption>
  </figure>
</template>
