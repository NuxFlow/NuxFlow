<script setup lang="ts">
const props = defineProps<{
  modelValue: { seoTitle?: string; seoDescription?: string; access?: string }
  title?: string
  contentId?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: typeof props.modelValue] }>()

const local = reactive({
  seoTitle: props.modelValue.seoTitle ?? '',
  seoDescription: props.modelValue.seoDescription ?? '',
  access: props.modelValue.access ?? 'public',
})
watch(local, (v) => emit('update:modelValue', { ...v }))

const aiLoading = ref(false)

async function suggestSeo() {
  aiLoading.value = true
  try {
    const res = await $fetch<{ seoTitle: string; seoDescription: string }>('/api/v1/ai/seo-suggest', {
      method: 'POST',
      body: { title: props.title ?? local.seoTitle },
    })
    local.seoTitle = res.seoTitle
    local.seoDescription = res.seoDescription
  } finally {
    aiLoading.value = false
  }
}

const titleLength = computed(() => local.seoTitle.length)
const descLength = computed(() => local.seoDescription.length)

const { data: tiersData } = await useFetch<{ tiers: { id: string; name: string }[] }>('/api/v1/memberships', {
  default: () => ({ tiers: [] }),
})

const accessOptions = computed(() => [
  { value: 'public', label: 'Public' },
  { value: 'members', label: 'Members only' },
  ...(tiersData.value?.tiers ?? []).map(t => ({ value: `tier:${t.id}`, label: t.name })),
])
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between">
        <p class="text-sm font-semibold">SEO & Access</p>
        <UButton size="xs" variant="ghost" icon="i-lucide-sparkles" :loading="aiLoading" @click="suggestSeo">
          AI suggest
        </UButton>
      </div>
    </template>
    <div class="space-y-3">
      <UFormField label="SEO title" :hint="`${titleLength}/60`">
        <UInput v-model="local.seoTitle" :placeholder="title" maxlength="60" />
        <div class="mt-1 h-1 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
          <div class="h-full rounded-full transition-all" :class="titleLength > 60 ? 'bg-red-400' : titleLength > 50 ? 'bg-yellow-400' : 'bg-primary-400'" :style="{ width: `${Math.min(titleLength / 60 * 100, 100)}%` }" />
        </div>
      </UFormField>

      <UFormField label="Meta description" :hint="`${descLength}/160`">
        <UTextarea v-model="local.seoDescription" :rows="3" maxlength="160" />
        <div class="mt-1 h-1 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
          <div class="h-full rounded-full transition-all" :class="descLength > 160 ? 'bg-red-400' : descLength > 140 ? 'bg-yellow-400' : 'bg-primary-400'" :style="{ width: `${Math.min(descLength / 160 * 100, 100)}%` }" />
        </div>
      </UFormField>

      <UFormField label="Content access" hint="Who can view this content">
        <USelect v-model="local.access" :items="accessOptions" />
      </UFormField>
    </div>
  </UCard>
</template>
