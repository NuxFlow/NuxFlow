<script setup lang="ts">
// Editable site plan for the Generate with AI page — the editor reviews (and can rename,
// reword, remove, or add) the AI's proposed pages before any page is generated. The
// edited list is what POST .../approve receives.
export interface PlanPageDraft { title: string; slug: string; description: string }

const pages = defineModel<PlanPageDraft[]>({ required: true })
defineProps<{ max: number; disabled?: boolean }>()

function update(index: number, patch: Partial<PlanPageDraft>) {
  pages.value = pages.value.map((p, i) => (i === index ? { ...p, ...patch } : p))
}

function remove(index: number) {
  pages.value = pages.value.filter((_, i) => i !== index)
}

function add() {
  pages.value = [...pages.value, { title: '', slug: '', description: '' }]
}

function move(index: number, delta: -1 | 1) {
  const next = [...pages.value]
  const [page] = next.splice(index, 1)
  next.splice(index + delta, 0, page!)
  pages.value = next
}

function slugFromTitle(title: string): string {
  return title.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}
</script>

<template>
  <div class="space-y-3">
    <div
      v-for="(page, index) in pages"
      :key="index"
      class="border border-gray-200 dark:border-gray-800 rounded-lg p-3 space-y-2"
    >
      <div class="flex flex-col sm:flex-row gap-2">
        <UInput
          :model-value="page.title"
          class="flex-1"
          placeholder="Page title"
          aria-label="Page title"
          :disabled="disabled"
          @update:model-value="(v: string) => update(index, { title: v, ...(!page.slug || page.slug === slugFromTitle(page.title) ? { slug: slugFromTitle(v) } : {}) })"
        />
        <UInput
          :model-value="page.slug"
          class="sm:w-48"
          placeholder="slug"
          aria-label="Page slug"
          :disabled="disabled"
          @update:model-value="(v: string) => update(index, { slug: v })"
        >
          <template #leading><span class="text-gray-400 text-sm">/</span></template>
        </UInput>
        <div class="flex items-center gap-1 self-end sm:self-auto">
          <UButton size="xs" variant="ghost" icon="i-lucide-arrow-up" aria-label="Move up" :disabled="disabled || index === 0" @click="move(index, -1)" />
          <UButton size="xs" variant="ghost" icon="i-lucide-arrow-down" aria-label="Move down" :disabled="disabled || index === pages.length - 1" @click="move(index, 1)" />
          <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" aria-label="Remove page" :disabled="disabled || pages.length <= 1" @click="remove(index)" />
        </div>
      </div>
      <UTextarea
        :model-value="page.description"
        class="w-full"
        :rows="2"
        autoresize
        :maxrows="8"
        :maxlength="1000"
        placeholder="What should this page contain? Name the sections and what each should say."
        aria-label="Page description"
        :disabled="disabled"
        @update:model-value="(v: string) => update(index, { description: v })"
      />
    </div>

    <UButton
      v-if="pages.length < max"
      variant="soft"
      size="sm"
      icon="i-lucide-plus"
      :disabled="disabled"
      @click="add"
    >
      Add a page
    </UButton>
  </div>
</template>
