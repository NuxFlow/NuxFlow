<script setup lang="ts">
const { data: siteInfo } = useFetch('/api/public/site')

useHead({
  titleTemplate: (title) => {
    const name = siteInfo.value?.name
    return name
      ? (title ? `${title} | ${name}` : name)
      : (title ?? '')
  },
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
