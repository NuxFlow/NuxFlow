<script setup lang="ts">
const props = defineProps<{
  attrs?: { formId?: string }
}>()
const emit = defineEmits<{ 'update:attrs': [v: { formId?: string }] }>()

const { data: forms } = await useFetch<{ items: { id: string; title: string; slug: string }[] }>('/api/v1/forms')
const selectedFormId = ref(props.attrs?.formId ?? '')
watch(selectedFormId, (v) => emit('update:attrs', { formId: v }))

const selectedForm = computed(() => forms.value?.items.find((f) => f.id === selectedFormId.value))
</script>

<template>
  <div class="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-4 space-y-3">
    <div class="flex items-center gap-2">
      <UIcon name="i-lucide-list-checks" class="text-primary-500" />
      <span class="text-sm font-medium text-gray-700 dark:text-gray-300">Form Block</span>
    </div>

    <UFormField label="Select form">
      <USelect
        v-model="selectedFormId"
        :items="(forms?.items ?? []).map(f => ({ label: f.title, value: f.id }))"
        placeholder="Choose a form…"
      />
    </UFormField>

    <div v-if="selectedForm" class="text-xs text-gray-500 bg-gray-50 dark:bg-gray-800 rounded p-2">
      <span class="font-medium">{{ selectedForm.title }}</span>
      · slug: <code>/forms/{{ selectedForm.slug }}</code>
    </div>
    <p v-else class="text-xs text-gray-400">Select a form to embed on this page.</p>
  </div>
</template>
