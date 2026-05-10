<script setup lang="ts">
const route = useRoute()
const slug = computed(() => (route.params.slug as string[]).join('/'))

const { data: page, error } = await useFetch(() => `/api/public/pages/${slug.value}`)

useSeoMeta({
  title: page.value?.seoTitle || page.value?.title,
  description: page.value?.seoDescription,
})
</script>

<template>
  <div v-if="page" class="max-w-4xl mx-auto px-6 py-12">
    <h1 class="text-4xl font-bold text-gray-900 dark:text-white mb-8">
      {{ page.title }}
    </h1>
    <NuxBlock :content="page.content" />
  </div>
  <div v-else-if="error" class="min-h-[60vh] flex items-center justify-center">
    <div class="text-center">
      <p class="text-6xl font-bold text-gray-200 dark:text-gray-800">{{ error.statusCode }}</p>
      <p class="mt-2 text-gray-500">
        {{ error.statusCode === 404 ? 'Page not found' : 'Something went wrong' }}
      </p>
      <UButton to="/" variant="link" class="mt-4">Go home</UButton>
    </div>
  </div>
</template>
