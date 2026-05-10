<script setup lang="ts">
const emit = defineEmits<{ select: [{ url: string; altText?: string }] }>()

const { data } = await useFetch('/api/v1/media')
const files = computed(() => data.value?.files ?? [])

const search = ref('')
const filtered = computed(() =>
  files.value.filter(f => f.originalName.toLowerCase().includes(search.value.toLowerCase())),
)

function select(file: { url: string; altText?: string | null }) {
  emit('select', { url: file.url, altText: file.altText ?? '' })
}
</script>

<template>
  <div class="space-y-3">
    <UInput v-model="search" placeholder="Search media…" icon="i-lucide-search" />

    <div class="grid grid-cols-4 gap-2 max-h-80 overflow-y-auto">
      <button
        v-for="file in filtered"
        :key="file.id"
        class="aspect-square rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 hover:ring-2 ring-primary-500 transition-all"
        @click="select(file)"
      >
        <img
          v-if="file.mimeType.startsWith('image/')"
          :src="file.url"
          :alt="file.altText || file.originalName"
          class="w-full h-full object-cover"
        >
        <div v-else class="w-full h-full flex items-center justify-center">
          <UIcon name="i-lucide-file" class="w-6 h-6 text-gray-300" />
        </div>
      </button>
    </div>

    <p v-if="!filtered.length" class="text-sm text-center text-gray-400 py-4">No media found</p>
  </div>
</template>
