<script setup lang="ts">
const props = defineProps<{ contentId?: string }>()

interface Term { termId: string; termName: string; termSlug: string; taxonomyId: string; taxonomySlug: string; taxonomyName: string }
interface Taxonomy { id: string; slug: string; name: string; isHierarchical: boolean }
interface TaxonomyTerm { id: string; slug: string; name: string; parentId: string | null }

const { data: taxData, refresh: refreshTaxonomies } = await useFetch<{ taxonomies: Taxonomy[] }>('/api/v1/taxonomies', {
  default: () => ({ taxonomies: [] }),
})

// Selected term IDs (all taxonomies combined)
const selectedIds = ref<Set<string>>(new Set())

// Load existing assignments when editing
watch(() => props.contentId, async (id) => {
  if (!id) return
  const res = await $fetch<{ terms: Term[] }>(`/api/v1/content/${id}/terms`)
  selectedIds.value = new Set(res.terms.map(t => t.termId))
}, { immediate: true })

// Per-taxonomy term lists (fetched lazily when a panel opens)
const termsByTaxonomy = ref<Record<string, TaxonomyTerm[]>>({})
const openTaxonomy = ref<string | null>(null)

async function openPanel(taxonomyId: string) {
  openTaxonomy.value = openTaxonomy.value === taxonomyId ? null : taxonomyId
  if (openTaxonomy.value && !termsByTaxonomy.value[taxonomyId]) {
    const res = await $fetch<{ terms: TaxonomyTerm[] }>(`/api/v1/taxonomies/${taxonomyId}/terms`)
    termsByTaxonomy.value[taxonomyId] = res.terms
  }
}

function toggle(termId: string) {
  const next = new Set(selectedIds.value)
  next.has(termId) ? next.delete(termId) : next.add(termId)
  selectedIds.value = next
  save()
}

let saveTimer: ReturnType<typeof setTimeout>
function save() {
  if (!props.contentId) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    await $fetch(`/api/v1/content/${props.contentId}/terms`, {
      method: 'PUT',
      body: { termIds: [...selectedIds.value] },
    })
  }, 600)
}

// New term inline creation
const newTermName = ref<Record<string, string>>({})
const creating = ref<Record<string, boolean>>({})

async function createTerm(taxonomyId: string) {
  const name = newTermName.value[taxonomyId]?.trim()
  if (!name) return
  creating.value[taxonomyId] = true
  try {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const res = await $fetch<{ id: string }>(`/api/v1/taxonomies/${taxonomyId}/terms`, {
      method: 'POST',
      body: { name, slug },
    })
    if (!termsByTaxonomy.value[taxonomyId]) termsByTaxonomy.value[taxonomyId] = []
    termsByTaxonomy.value[taxonomyId].push({ id: res.id, name, slug, parentId: null })
    newTermName.value[taxonomyId] = ''
    toggle(res.id)
  } finally {
    creating.value[taxonomyId] = false
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <p class="text-sm font-semibold">Categories & Tags</p>
    </template>
    <div class="space-y-3">
      <div
        v-for="taxonomy in taxData.taxonomies"
        :key="taxonomy.id"
        class="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
      >
        <button
          class="w-full flex items-center justify-between px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          @click="openPanel(taxonomy.id)"
        >
          <span>{{ taxonomy.name }}</span>
          <div class="flex items-center gap-2">
            <span v-if="termsByTaxonomy[taxonomy.id]" class="text-xs text-gray-400">
              {{ [...selectedIds].filter(id => termsByTaxonomy[taxonomy.id]?.some(t => t.id === id)).length }} selected
            </span>
            <UIcon :name="openTaxonomy === taxonomy.id ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="w-3.5 h-3.5 text-gray-400" />
          </div>
        </button>

        <div v-if="openTaxonomy === taxonomy.id" class="px-3 pb-3 space-y-1 border-t border-gray-200 dark:border-gray-700 pt-2">
          <label
            v-for="term in termsByTaxonomy[taxonomy.id] ?? []"
            :key="term.id"
            class="flex items-center gap-2 text-sm cursor-pointer py-0.5"
          >
            <input
              type="checkbox"
              :checked="selectedIds.has(term.id)"
              class="rounded text-primary-500"
              @change="toggle(term.id)"
            >
            {{ term.name }}
          </label>
          <p v-if="(termsByTaxonomy[taxonomy.id] ?? []).length === 0" class="text-xs text-gray-400 py-1">No terms yet</p>

          <!-- Inline new term -->
          <div class="flex gap-1 mt-2">
            <UInput
              v-model="newTermName[taxonomy.id]"
              size="xs"
              placeholder="Add new term…"
              class="flex-1"
              @keydown.enter="createTerm(taxonomy.id)"
            />
            <UButton size="xs" icon="i-lucide-plus" :loading="creating[taxonomy.id]" @click="createTerm(taxonomy.id)" />
          </div>
        </div>
      </div>

      <p v-if="taxData.taxonomies.length === 0" class="text-xs text-gray-400">
        No taxonomies configured.
        <NuxtLink to="/admin/taxonomies" class="text-primary-500 hover:underline">Add one</NuxtLink>
      </p>
    </div>
  </UCard>
</template>
