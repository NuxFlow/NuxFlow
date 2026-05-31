<script setup lang="ts">
const { data: siteInfo } = useFetch('/api/public/site', {
  headers: useRequestHeaders(['host']),
})

useHead({
  titleTemplate: (title) => {
    const name = siteInfo.value?.name
    return name
      ? (title ? `${title} | ${name}` : name)
      : (title ?? '')
  },
  link: computed(() => {
    const url = siteInfo.value?.faviconUrl
    if (!url) return []
    const type = url.endsWith('.svg') ? 'image/svg+xml'
      : url.endsWith('.ico') ? 'image/x-icon'
      : 'image/png'
    return [{ rel: 'icon', type, href: url }]
  }),
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <UNotifications />
</template>
