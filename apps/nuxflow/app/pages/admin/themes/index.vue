<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-xl font-bold text-gray-900 dark:text-white">Themes</h1>

    <AdminThemesThemeList />

    <div class="space-y-3">
      <h2 class="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Appearance</h2>
      <AdminThemesAppearanceSection />
      <AdminThemesLayoutRegionsSection />
    </div>
  </div>
</template>
