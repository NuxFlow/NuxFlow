<script setup lang="ts">
import { slugify } from '#shared/lib/slug'
// Create/edit a taxonomy. `taxonomy` null = create.
const props = defineProps<{ taxonomy: AdminTaxonomy | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ saved: [] }>()
const { run, isRunning } = useAdminAction()

const { data: typesData } = await useFetch<{ types: { slug: string; name: string }[] }>('/api/v1/seo/content-types', {
  default: () => ({ types: [] }),
})
const typeItems = computed(() => (typesData.value?.types ?? []).map(t => ({ label: t.name, value: t.slug })))

const form = reactive({ name: '', slug: '', description: '', isHierarchical: false, noindex: false, contentTypes: [] as string[] })
const slugTouched = ref(false)
const saving = computed(() => isRunning('save'))

watch(open, (isOpen) => {
  if (!isOpen) return
  const t = props.taxonomy
  form.name = t?.name ?? ''
  form.slug = t?.slug ?? ''
  form.description = t?.description ?? ''
  form.isHierarchical = t?.isHierarchical ?? false
  form.noindex = t?.noindex ?? false
  form.contentTypes = [...(t?.contentTypes ?? [])]
  slugTouched.value = Boolean(t)
}, { immediate: true })

watch(() => form.name, (name) => {
  if (!slugTouched.value) form.slug = slugify(name)
})

const slugChanged = computed(() => Boolean(props.taxonomy) && form.slug !== props.taxonomy!.slug)
const flattening = computed(() => Boolean(props.taxonomy?.isHierarchical) && !form.isHierarchical)

async function save() {
  if (!form.name.trim()) return
  await run(async () => {
    const body = {
      name: form.name.trim(),
      slug: form.slug.trim() || undefined,
      description: form.description.trim() || null,
      isHierarchical: form.isHierarchical,
      noindex: form.noindex,
      contentTypes: form.contentTypes,
    }
    if (props.taxonomy) {
      const url: string = `/api/v1/taxonomies/${props.taxonomy.id}`
      await $fetch<unknown>(url, { method: 'PATCH', body })
    } else {
      await $fetch<unknown>('/api/v1/taxonomies', { method: 'POST', body })
    }
    open.value = false
    emit('saved')
  }, { successTitle: props.taxonomy ? 'Taxonomy updated' : 'Taxonomy created', errorTitle: "Couldn't save the taxonomy", key: 'save' })
}
</script>

<template>
  <UModal v-model:open="open" :title="taxonomy ? `Edit ${taxonomy.name}` : 'New taxonomy'">
    <template #body>
      <form class="space-y-4" @submit.prevent="save">
        <UFormField label="Name" required>
          <UInput v-model="form.name" placeholder="e.g. Topics" autofocus class="w-full" />
        </UFormField>
        <UFormField label="Slug" :hint="`/${form.slug || 'slug'}/…`" help="Lowercase letters, digits, and dashes. Used in archive URLs.">
          <UInput v-model="form.slug" placeholder="e.g. topic" class="w-full font-mono" @input="slugTouched = true" />
        </UFormField>
        <p v-if="slugChanged" class="text-xs text-amber-600 dark:text-amber-400">
          Existing archive URLs will redirect (301) to the new slug.
        </p>
        <UFormField label="Description" help="Shown on the taxonomy's overview page.">
          <UTextarea v-model="form.description" :rows="2" class="w-full" />
        </UFormField>
        <UFormField label="Applies to" help="Leave empty to offer this taxonomy on every content type.">
          <USelectMenu
            v-model="form.contentTypes"
            :items="typeItems"
            value-key="value"
            multiple
            placeholder="All content types"
            class="w-full"
          />
        </UFormField>
        <USwitch
          v-model="form.isHierarchical"
          label="Hierarchical"
          description="Terms can be nested (like categories). A parent's archive also lists its sub-terms' content."
        />
        <p v-if="flattening" class="text-xs text-amber-600 dark:text-amber-400">
          Turning this off moves every nested term back to the top level.
        </p>
        <USwitch
          v-model="form.noindex"
          label="Hide archives from search engines"
          description="Adds noindex to this taxonomy's archive pages and leaves them out of the sitemap."
        />
        <button type="submit" class="hidden" />
      </form>
    </template>
    <template #footer>
      <UButton variant="ghost" @click="open = false">Cancel</UButton>
      <UButton :loading="saving" :disabled="!form.name.trim()" @click="save">{{ taxonomy ? 'Save' : 'Create' }}</UButton>
    </template>
  </UModal>
</template>
