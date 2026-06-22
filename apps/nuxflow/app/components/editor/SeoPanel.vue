<script setup lang="ts">
const props = defineProps<{
  modelValue: {
    seoTitle?: string
    seoDescription?: string
    access?: string
    canonicalUrl?: string
    focusKeyword?: string
    metaRobots?: string
  }
  title?: string
  slug?: string
  contentId?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: typeof props.modelValue] }>()

const local = reactive({
  seoTitle: props.modelValue.seoTitle ?? '',
  seoDescription: props.modelValue.seoDescription ?? '',
  access: props.modelValue.access ?? 'public',
  canonicalUrl: props.modelValue.canonicalUrl ?? '',
  focusKeyword: props.modelValue.focusKeyword ?? '',
  metaRobots: props.modelValue.metaRobots ?? '',
})
watch(local, (v) => emit('update:modelValue', { ...v }))

// Keep local in sync when parent resets form (e.g. after data loads)
watch(() => props.modelValue, (v) => {
  if (v.seoTitle !== undefined) local.seoTitle = v.seoTitle
  if (v.seoDescription !== undefined) local.seoDescription = v.seoDescription
  if (v.access !== undefined) local.access = v.access
  if (v.canonicalUrl !== undefined) local.canonicalUrl = v.canonicalUrl ?? ''
  if (v.focusKeyword !== undefined) local.focusKeyword = v.focusKeyword ?? ''
  if (v.metaRobots !== undefined) local.metaRobots = v.metaRobots ?? ''
}, { deep: true })

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

// Snippet preview values
const previewTitle = computed(() => local.seoTitle || props.title || 'Page title')
const previewDesc = computed(() => local.seoDescription || 'Meta description will appear here…')

// Keyword presence check for focus keyword
const keywordInTitle = computed(() =>
  local.focusKeyword
    ? previewTitle.value.toLowerCase().includes(local.focusKeyword.toLowerCase())
    : null,
)
const keywordInDesc = computed(() =>
  local.focusKeyword
    ? previewDesc.value.toLowerCase().includes(local.focusKeyword.toLowerCase())
    : null,
)

const { data: tiersData } = await useFetch<{ tiers: { id: string; name: string }[] }>('/api/v1/memberships', {
  default: () => ({ tiers: [] }),
})

const accessOptions = computed(() => [
  { value: 'public', label: 'Public' },
  { value: 'members', label: 'Members only' },
  ...(tiersData.value?.tiers ?? []).map(t => ({ value: `tier:${t.id}`, label: t.name })),
])

const robotsOptions = [
  { value: '', label: 'Default (inherit global setting)' },
  { value: 'index,follow', label: 'Index, Follow (default)' },
  { value: 'noindex,follow', label: 'No index, Follow' },
  { value: 'noindex,nofollow', label: 'No index, No follow' },
  { value: 'index,nofollow', label: 'Index, No follow' },
]
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
    <div class="space-y-4">

      <!-- Google snippet preview -->
      <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-950 space-y-0.5">
        <p class="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Search preview</p>
        <p class="text-[#1a0dab] dark:text-[#8ab4f8] text-sm font-medium leading-snug truncate">
          {{ previewTitle }}
        </p>
        <p class="text-[#006621] dark:text-[#4db274] text-xs truncate">
          {{ slug ? `yoursite.com/${slug}` : 'yoursite.com/page-slug' }}
        </p>
        <p class="text-[#545454] dark:text-gray-400 text-xs leading-relaxed line-clamp-2">
          {{ previewDesc }}
        </p>
      </div>

      <UFormField label="SEO title" :hint="`${titleLength}/60`">
        <UInput v-model="local.seoTitle" :placeholder="title" maxlength="60" />
        <div class="mt-1 h-1 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
          <div
            class="h-full rounded-full transition-all"
            :class="titleLength > 60 ? 'bg-red-400' : titleLength > 50 ? 'bg-yellow-400' : 'bg-primary-400'"
            :style="{ width: `${Math.min(titleLength / 60 * 100, 100)}%` }"
          />
        </div>
      </UFormField>

      <UFormField label="Meta description" :hint="`${descLength}/160`">
        <UTextarea v-model="local.seoDescription" :rows="3" maxlength="160" />
        <div class="mt-1 h-1 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
          <div
            class="h-full rounded-full transition-all"
            :class="descLength > 160 ? 'bg-red-400' : descLength > 140 ? 'bg-yellow-400' : 'bg-primary-400'"
            :style="{ width: `${Math.min(descLength / 160 * 100, 100)}%` }"
          />
        </div>
      </UFormField>

      <UFormField label="Focus keyword" hint="Primary keyword for this page — used to check title & description coverage">
        <UInput v-model="local.focusKeyword" placeholder="e.g. headless CMS" />
        <div v-if="local.focusKeyword" class="mt-1.5 flex gap-3 text-[11px]">
          <span :class="keywordInTitle ? 'text-green-600 dark:text-green-400' : 'text-amber-500'">
            <UIcon :name="keywordInTitle ? 'i-lucide-check' : 'i-lucide-x'" class="w-3 h-3 inline" />
            Title
          </span>
          <span :class="keywordInDesc ? 'text-green-600 dark:text-green-400' : 'text-amber-500'">
            <UIcon :name="keywordInDesc ? 'i-lucide-check' : 'i-lucide-x'" class="w-3 h-3 inline" />
            Description
          </span>
        </div>
      </UFormField>

      <UFormField label="Canonical URL" hint="Override the canonical URL for this page (leave blank to use default)">
        <UInput v-model="local.canonicalUrl" placeholder="https://example.com/custom-path" />
      </UFormField>

      <UFormField label="Robots" hint="Override the global robots setting for this page">
        <USelect v-model="local.metaRobots" :items="robotsOptions" />
      </UFormField>

      <UFormField label="Content access" hint="Who can view this content">
        <USelect v-model="local.access" :items="accessOptions" />
      </UFormField>
    </div>
  </UCard>
</template>
