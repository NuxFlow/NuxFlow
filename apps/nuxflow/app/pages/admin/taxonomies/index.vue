<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })
useHead({ title: 'Taxonomies' })

interface Taxonomy { id: string; slug: string; name: string; isHierarchical: boolean }
interface Term { id: string; slug: string; name: string; description: string | null; parentId: string | null }

const { data, refresh } = await useFetch<{ taxonomies: Taxonomy[] }>('/api/v1/taxonomies', {
  default: () => ({ taxonomies: [] }),
})

// ── Create taxonomy ───────────────────────────────────────────────────────────
const showCreate = ref(false)
const createForm = reactive({ name: '', slug: '', isHierarchical: false })
const creating = ref(false)

watch(() => createForm.name, (v) => {
  createForm.slug = v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
})

async function createTaxonomy() {
  creating.value = true
  try {
    await $fetch('/api/v1/taxonomies', { method: 'POST', body: createForm })
    showCreate.value = false
    createForm.name = ''
    createForm.slug = ''
    createForm.isHierarchical = false
    await refresh()
  } finally {
    creating.value = false
  }
}

// ── Delete taxonomy ───────────────────────────────────────────────────────────
const deleteId = ref<string | null>(null)
const isDeleteOpen = computed({
  get: () => deleteId.value !== null,
  set: (v) => { if (!v) deleteId.value = null },
})

async function deleteTaxonomy() {
  if (!deleteId.value) return
  await $fetch(`/api/v1/taxonomies/${deleteId.value}`, { method: 'DELETE' })
  deleteId.value = null
  if (activeTaxonomy.value?.id === deleteId.value) activeTaxonomy.value = null
  await refresh()
}

// ── Terms panel ───────────────────────────────────────────────────────────────
const activeTaxonomy = ref<Taxonomy | null>(null)
const terms = ref<Term[]>([])
const loadingTerms = ref(false)

async function openTaxonomy(tax: Taxonomy) {
  activeTaxonomy.value = tax
  loadingTerms.value = true
  try {
    const res = await $fetch<{ terms: Term[] }>(`/api/v1/taxonomies/${tax.id}/terms`)
    terms.value = res.terms
  } finally {
    loadingTerms.value = false
  }
}

// ── Create term ───────────────────────────────────────────────────────────────
const newTermName = ref('')
const newTermSlug = ref('')
const creatingTerm = ref(false)

watch(newTermName, (v) => {
  newTermSlug.value = v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
})

async function createTerm() {
  if (!activeTaxonomy.value || !newTermName.value.trim()) return
  creatingTerm.value = true
  try {
    await $fetch(`/api/v1/taxonomies/${activeTaxonomy.value.id}/terms`, {
      method: 'POST',
      body: { name: newTermName.value.trim(), slug: newTermSlug.value },
    })
    newTermName.value = ''
    newTermSlug.value = ''
    const res = await $fetch<{ terms: Term[] }>(`/api/v1/taxonomies/${activeTaxonomy.value.id}/terms`)
    terms.value = res.terms
  } finally {
    creatingTerm.value = false
  }
}

// ── Delete term ───────────────────────────────────────────────────────────────
async function deleteTerm(termId: string) {
  if (!activeTaxonomy.value) return
  await $fetch(`/api/v1/taxonomies/${activeTaxonomy.value.id}/terms/${termId}`, { method: 'DELETE' })
  terms.value = terms.value.filter(t => t.id !== termId)
}
</script>

<template>
  <div class="max-w-6xl mx-auto space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Taxonomies</h1>
        <p class="text-sm text-gray-500 mt-0.5">Manage categories, tags, and custom groupings for your content</p>
      </div>
      <UButton icon="i-lucide-plus" @click="showCreate = true">New taxonomy</UButton>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Taxonomy list -->
      <div class="space-y-3">
        <UCard
          v-for="tax in data.taxonomies"
          :key="tax.id"
          class="cursor-pointer transition-shadow hover:shadow-md"
          :class="activeTaxonomy?.id === tax.id ? 'ring-2 ring-primary-500' : ''"
          @click="openTaxonomy(tax)"
        >
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-9 h-9 rounded-lg bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center">
                <UIcon :name="tax.isHierarchical ? 'i-lucide-folder-tree' : 'i-lucide-tag'" class="w-4 h-4 text-primary-600 dark:text-primary-400" />
              </div>
              <div>
                <p class="font-medium text-sm text-gray-900 dark:text-white">{{ tax.name }}</p>
                <p class="text-xs text-gray-400 font-mono">{{ tax.slug }}</p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <UBadge :label="tax.isHierarchical ? 'Hierarchical' : 'Flat'" variant="soft" size="xs" />
              <UButton
                icon="i-lucide-trash-2"
                size="xs"
                color="red"
                variant="ghost"
                @click.stop="deleteId = tax.id"
              />
            </div>
          </div>
        </UCard>
        <div v-if="data.taxonomies.length === 0" class="text-center py-12 text-gray-400">
          <UIcon name="i-lucide-tag" class="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p class="text-sm">No taxonomies yet. Create one to start organising content.</p>
        </div>
      </div>

      <!-- Terms panel -->
      <div v-if="activeTaxonomy">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <p class="font-semibold text-sm text-gray-900 dark:text-white">{{ activeTaxonomy.name }} terms</p>
              <UBadge :label="`${terms.length} terms`" variant="soft" size="xs" />
            </div>
          </template>

          <div class="space-y-2">
            <div v-if="loadingTerms" class="py-6 flex justify-center">
              <UIcon name="i-lucide-loader-2" class="w-5 h-5 animate-spin text-gray-400" />
            </div>

            <div v-else>
              <div
                v-for="term in terms"
                :key="term.id"
                class="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 group"
              >
                 <div>
                  <span class="text-sm font-medium text-gray-900 dark:text-white">{{ term.name }}</span>
                  <span class="text-xs text-gray-400 font-mono ml-2">{{ term.slug }}</span>
                  <p v-if="term.description" class="text-xs text-gray-400 mt-0.5">{{ term.description }}</p>
                </div>
                <UButton
                  icon="i-lucide-x"
                  size="xs"
                  variant="ghost"
                  color="red"
                  class="opacity-0 group-hover:opacity-100 transition-opacity"
                  @click="deleteTerm(term.id)"
                />
              </div>
              <p v-if="terms.length === 0" class="text-sm text-gray-400 py-2">No terms yet.</p>
            </div>
          </div>

          <template #footer>
            <div class="flex gap-2">
              <UInput v-model="newTermName" placeholder="Term name" class="flex-1" size="sm" @keydown.enter="createTerm" />
              <UButton size="sm" :loading="creatingTerm" icon="i-lucide-plus" @click="createTerm">
                Add
              </UButton>
            </div>
          </template>
        </UCard>
      </div>
      <div v-else class="flex items-center justify-center rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 h-48">
        <p class="text-sm text-gray-400">Select a taxonomy to manage its terms</p>
      </div>
    </div>

    <!-- Create taxonomy modal -->
    <UModal v-model:open="showCreate" title="New taxonomy">
      <template #body>
        <div class="space-y-4">
          <UFormField label="Name">
            <UInput v-model="createForm.name" placeholder="e.g. Topics" autofocus />
          </UFormField>
          <UFormField label="Slug" hint="Used in URLs">
            <UInput v-model="createForm.slug" placeholder="e.g. topic" class="font-mono" />
          </UFormField>
          <UFormField label="Type">
            <div class="flex items-center gap-2">
              <USwitch v-model="createForm.isHierarchical" />
              <span class="text-sm">Hierarchical (like categories)</span>
            </div>
          </UFormField>
        </div>
      </template>
      <template #footer>
        <UButton variant="ghost" @click="showCreate = false">Cancel</UButton>
        <UButton :loading="creating" @click="createTaxonomy">Create</UButton>
      </template>
    </UModal>

    <!-- Delete taxonomy modal -->
    <UModal v-model:open="isDeleteOpen" title="Delete taxonomy">
      <template #body>
        <p class="text-sm text-gray-600 dark:text-gray-400">This will permanently delete the taxonomy and all its terms. Content assignments will also be removed.</p>
      </template>
      <template #footer>
        <UButton variant="ghost" @click="deleteId = null">Cancel</UButton>
        <UButton
          variant="solid"
          class="!bg-red-600 hover:!bg-red-700 !text-white font-semibold shadow-sm transition-colors cursor-pointer"
          @click="deleteTaxonomy"
        >
          Delete
        </UButton>
      </template>
    </UModal>
  </div>
</template>
