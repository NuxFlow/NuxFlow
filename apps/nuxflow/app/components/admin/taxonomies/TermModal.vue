<script setup lang="ts">
// Create/edit one term of `taxonomy`. `term` null = create; `defaultParentId` pre-selects
// a parent for "Add sub-term".
const props = defineProps<{
  taxonomy: AdminTaxonomy
  terms: AdminTerm[]
  term: AdminTerm | null
  defaultParentId?: string | null
}>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ saved: [] }>()
const toast = useToast()

const NO_PARENT = '__none__'

const form = reactive({
  name: '',
  slug: '',
  parentId: NO_PARENT,
  description: '',
  seoTitle: '',
  seoDescription: '',
  ogImage: '',
})
const slugTouched = ref(false)
const saving = ref(false)
const showImagePicker = ref(false)

watch(open, (isOpen) => {
  if (!isOpen) return
  const t = props.term
  form.name = t?.name ?? ''
  form.slug = t?.slug ?? ''
  form.parentId = (t ? t.parentId : props.defaultParentId) ?? NO_PARENT
  form.description = t?.description ?? ''
  form.seoTitle = t?.seoTitle ?? ''
  form.seoDescription = t?.seoDescription ?? ''
  form.ogImage = t?.ogImage ?? ''
  slugTouched.value = Boolean(t)
}, { immediate: true })

watch(() => form.name, (name) => {
  if (!slugTouched.value) form.slug = slugifyTermName(name)
})

// A term can't be nested under itself or anything already nested under it.
const parentItems = computed(() => {
  const excluded = props.term ? termWithDescendantIds(props.terms, props.term.id) : new Set<string>()
  return [
    { label: '— None (top level) —', value: NO_PARENT },
    ...flattenTermTree(props.terms)
      .filter(t => !excluded.has(t.id))
      .map(t => ({ label: `${'— '.repeat(t.depth)}${t.name}`, value: t.id })),
  ]
})

const slugChanged = computed(() => Boolean(props.term) && form.slug !== props.term!.slug)
const archivePath = computed(() => `/${props.taxonomy.slug}/${form.slug || 'slug'}`)

async function save() {
  if (!form.name.trim()) return
  saving.value = true
  try {
    const body = {
      name: form.name.trim(),
      slug: form.slug.trim() || undefined,
      description: form.description.trim() || null,
      parentId: props.taxonomy.isHierarchical && form.parentId !== NO_PARENT ? form.parentId : null,
      seoTitle: form.seoTitle.trim() || null,
      seoDescription: form.seoDescription.trim() || null,
      ogImage: form.ogImage.trim() || null,
    }
    if (props.term) {
      const url: string = `/api/v1/taxonomies/${props.taxonomy.id}/terms/${props.term.id}`
      await $fetch(url, { method: 'PATCH', body })
    } else {
      const url: string = `/api/v1/taxonomies/${props.taxonomy.id}/terms`
      await $fetch(url, { method: 'POST', body })
    }
    toast.add({ title: props.term ? 'Term updated' : 'Term added', color: 'success' })
    open.value = false
    emit('saved')
  } catch (e: unknown) {
    toast.add({ title: getErrorMessage(e, 'Could not save the term'), color: 'error' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="term ? `Edit ${term.name}` : `New ${taxonomy.name.toLowerCase()} term`">
    <template #body>
      <form class="space-y-4" @submit.prevent="save">
        <UFormField label="Name" required>
          <UInput v-model="form.name" autofocus class="w-full" />
        </UFormField>
        <UFormField label="Slug" :hint="archivePath" help="Lowercase letters, digits, and dashes.">
          <UInput v-model="form.slug" class="w-full font-mono" @input="slugTouched = true" />
        </UFormField>
        <p v-if="slugChanged" class="text-xs text-amber-600 dark:text-amber-400">
          The old archive URL will redirect (301) to the new one.
        </p>
        <UFormField v-if="taxonomy.isHierarchical" label="Parent">
          <USelect v-model="form.parentId" :items="parentItems" class="w-full" />
        </UFormField>
        <UFormField label="Description" help="Shown at the top of the term's archive page.">
          <UTextarea v-model="form.description" :rows="2" class="w-full" />
        </UFormField>

        <details class="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2">
          <summary class="text-sm font-medium cursor-pointer">Archive page SEO</summary>
          <div class="space-y-4 pt-3">
            <UFormField label="SEO title" :help="`Defaults to “${form.name || 'Term'} — ${taxonomy.name}”.`">
              <UInput v-model="form.seoTitle" class="w-full" maxlength="200" />
            </UFormField>
            <UFormField label="Meta description" help="Defaults to the description above.">
              <UTextarea v-model="form.seoDescription" :rows="2" class="w-full" maxlength="500" />
            </UFormField>
            <UFormField label="Share image" help="Defaults to the site's share image.">
              <div class="flex gap-2">
                <UInput v-model="form.ogImage" placeholder="https://…" class="flex-1" />
                <UButton variant="outline" icon="i-lucide-image" aria-label="Choose share image" @click="showImagePicker = true" />
              </div>
            </UFormField>
          </div>
        </details>
        <button type="submit" class="hidden" />
      </form>

      <UModal v-model:open="showImagePicker" title="Select share image">
        <template #body>
          <EditorMediaPicker @select="(f) => { form.ogImage = f.url; showImagePicker = false }" />
        </template>
      </UModal>
    </template>
    <template #footer>
      <UButton variant="ghost" @click="open = false">Cancel</UButton>
      <UButton :loading="saving" :disabled="!form.name.trim()" @click="save">{{ term ? 'Save' : 'Add term' }}</UButton>
    </template>
  </UModal>
</template>
