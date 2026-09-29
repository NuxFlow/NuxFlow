<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })
useHead({ title: 'Taxonomies' })

const route = useRoute()
const router = useRouter()
const toast = useToast()

const access = await fetchAdminAccess()
const canDeleteTaxonomy = computed(() => Boolean(access?.role && roleAtLeast(access.role, 'admin')))

const { data, refresh } = await useFetch<{ taxonomies: AdminTaxonomy[] }>('/api/v1/taxonomies', {
  default: () => ({ taxonomies: [] }),
})

// ── Selected taxonomy (kept in ?t= so a reload or shared link reopens it) ─────
const activeId = computed(() => (route.query.t as string | undefined) ?? null)
const activeTaxonomy = computed(() => data.value.taxonomies.find(t => t.id === activeId.value) ?? null)

function selectTaxonomy(tax: AdminTaxonomy | null) {
  router.replace({ query: { ...route.query, t: tax?.id } })
}

const terms = ref<AdminTerm[]>([])
const loadingTerms = ref(false)

async function loadTerms() {
  const tax = activeTaxonomy.value
  if (!tax) {
    terms.value = []
    return
  }
  loadingTerms.value = true
  try {
    const url: string = `/api/v1/taxonomies/${tax.id}/terms`
    const res = await $fetch<{ terms: AdminTerm[] }>(url)
    // Ignore a response for a taxonomy the user has since navigated away from.
    if (activeTaxonomy.value?.id === tax.id) terms.value = res.terms
  } catch (e: unknown) {
    toast.add({ title: getErrorMessage(e, 'Could not load terms'), color: 'error' })
  } finally {
    loadingTerms.value = false
  }
}
watch(() => activeTaxonomy.value?.id, loadTerms, { immediate: true })

async function refreshAll() {
  await refresh()
  await loadTerms()
}

// ── Term list: tree order + search ────────────────────────────────────────────
const search = ref('')
watch(activeId, () => { search.value = '' })

const treeTerms = computed(() => flattenTermTree(terms.value))
const visibleTerms = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return treeTerms.value
  // Searching shows matches flat — indentation without their parents would mislead.
  return treeTerms.value
    .filter(t => t.name.toLowerCase().includes(q) || t.slug.includes(q))
    .map(t => ({ ...t, depth: 0 }))
})
const parentName = (t: AdminTerm) => terms.value.find(p => p.id === t.parentId)?.name

// Admin content list filtered to a term — for the first content type the taxonomy
// applies to (the list is per type), or posts when it applies to everything.
function contentLinkFor(term: AdminTerm) {
  const type = activeTaxonomy.value?.contentTypes[0] ?? 'post'
  return { path: '/admin/content', query: { type, term: term.id, termName: term.name } }
}

// ── Taxonomy modals ───────────────────────────────────────────────────────────
const taxonomyModalOpen = ref(false)
const editingTaxonomy = ref<AdminTaxonomy | null>(null)
function openTaxonomyModal(tax: AdminTaxonomy | null) {
  editingTaxonomy.value = tax
  taxonomyModalOpen.value = true
}

const deleteTaxonomyTarget = ref<AdminTaxonomy | null>(null)
const deleteTaxonomyOpen = computed({
  get: () => deleteTaxonomyTarget.value !== null,
  set: (v) => { if (!v) deleteTaxonomyTarget.value = null },
})
const deletingTaxonomy = ref(false)

async function deleteTaxonomy() {
  const target = deleteTaxonomyTarget.value
  if (!target) return
  deletingTaxonomy.value = true
  try {
    const url: string = `/api/v1/taxonomies/${target.id}`
    await $fetch(url, { method: 'DELETE' })
    if (activeId.value === target.id) selectTaxonomy(null)
    deleteTaxonomyTarget.value = null
    toast.add({ title: `${target.name} deleted`, color: 'success' })
    await refresh()
  } catch (e: unknown) {
    toast.add({ title: getErrorMessage(e, 'Could not delete the taxonomy'), color: 'error' })
  } finally {
    deletingTaxonomy.value = false
  }
}

// ── Term modals ───────────────────────────────────────────────────────────────
const termModalOpen = ref(false)
const editingTerm = ref<AdminTerm | null>(null)
const newTermParentId = ref<string | null>(null)
function openTermModal(term: AdminTerm | null, parentId: string | null = null) {
  editingTerm.value = term
  newTermParentId.value = parentId
  termModalOpen.value = true
}

// Quick add (name only) from the panel footer.
const quickName = ref('')
const quickAdding = ref(false)
async function quickAdd() {
  const tax = activeTaxonomy.value
  const name = quickName.value.trim()
  if (!tax || !name) return
  if (!slugifyTermName(name)) {
    // No Latin letters/digits to build a slug from — the full form lets them type one.
    openTermModal(null)
    return
  }
  quickAdding.value = true
  try {
    const url: string = `/api/v1/taxonomies/${tax.id}/terms`
    await $fetch(url, { method: 'POST', body: { name } })
    quickName.value = ''
    await refreshAll()
  } catch (e: unknown) {
    toast.add({ title: getErrorMessage(e, 'Could not add the term'), color: 'error' })
  } finally {
    quickAdding.value = false
  }
}

const deleteTermTarget = ref<AdminTerm | null>(null)
const deleteTermOpen = computed({
  get: () => deleteTermTarget.value !== null,
  set: (v) => { if (!v) deleteTermTarget.value = null },
})
const deletingTerm = ref(false)
const deleteTermChildren = computed(() => terms.value.filter(t => t.parentId === deleteTermTarget.value?.id).length)

async function deleteTerm() {
  const tax = activeTaxonomy.value
  const target = deleteTermTarget.value
  if (!tax || !target) return
  deletingTerm.value = true
  try {
    const url: string = `/api/v1/taxonomies/${tax.id}/terms/${target.id}`
    await $fetch(url, { method: 'DELETE' })
    deleteTermTarget.value = null
    toast.add({ title: `${target.name} deleted`, color: 'success' })
    await refreshAll()
  } catch (e: unknown) {
    toast.add({ title: getErrorMessage(e, 'Could not delete the term'), color: 'error' })
  } finally {
    deletingTerm.value = false
  }
}

// ── Manual ordering (among siblings) ──────────────────────────────────────────
const reordering = ref(false)
function siblingsOf(term: AdminTerm) {
  return treeTerms.value.filter(t => (t.parentId ?? null) === (term.parentId ?? null))
}

async function move(term: AdminTerm, direction: -1 | 1) {
  const tax = activeTaxonomy.value
  if (!tax) return
  const siblings = siblingsOf(term)
  const index = siblings.findIndex(s => s.id === term.id)
  const swapWith = index + direction
  if (index < 0 || swapWith < 0 || swapWith >= siblings.length) return
  const ordered = [...siblings]
  ;[ordered[index], ordered[swapWith]] = [ordered[swapWith]!, ordered[index]!]
  reordering.value = true
  try {
    // Renumber the whole sibling group — equal sortOrders (e.g. all 0 from an import)
    // otherwise can't be swapped.
    await Promise.all(ordered.map((t, i) => {
      if (t.sortOrder === i) return Promise.resolve()
      const url: string = `/api/v1/taxonomies/${tax.id}/terms/${t.id}`
      return $fetch(url, { method: 'PATCH', body: { sortOrder: i } })
    }))
    await loadTerms()
  } catch (e: unknown) {
    toast.add({ title: getErrorMessage(e, 'Could not reorder'), color: 'error' })
  } finally {
    reordering.value = false
  }
}

function canMove(term: AdminTerm, direction: -1 | 1) {
  const siblings = siblingsOf(term)
  const index = siblings.findIndex(s => s.id === term.id)
  return index + direction >= 0 && index + direction < siblings.length
}
</script>

<template>
  <div class="max-w-6xl mx-auto space-y-6">
    <div class="flex items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Taxonomies</h1>
        <p class="text-sm text-gray-500 mt-0.5">Manage categories, tags, and custom groupings for your content</p>
      </div>
      <UButton icon="i-lucide-plus" @click="openTaxonomyModal(null)">New taxonomy</UButton>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <!-- Taxonomy list -->
      <div class="space-y-3 lg:col-span-2">
        <UCard
          v-for="tax in data.taxonomies"
          :key="tax.id"
          class="cursor-pointer transition-shadow hover:shadow-md"
          :class="activeId === tax.id ? 'ring-2 ring-primary-500' : ''"
          @click="selectTaxonomy(tax)"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-start gap-3 min-w-0">
              <div class="w-9 h-9 shrink-0 rounded-lg bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center">
                <UIcon :name="tax.isHierarchical ? 'i-lucide-folder-tree' : 'i-lucide-tag'" class="w-4 h-4 text-primary-600 dark:text-primary-400" />
              </div>
              <div class="min-w-0">
                <p class="font-medium text-sm text-gray-900 dark:text-white">{{ tax.name }}</p>
                <p class="text-xs text-gray-400 font-mono">/{{ tax.slug }}</p>
                <div class="flex flex-wrap gap-1 mt-1.5">
                  <UBadge :label="tax.isHierarchical ? 'Hierarchical' : 'Flat'" variant="soft" size="xs" />
                  <UBadge :label="`${tax.termCount} term${tax.termCount === 1 ? '' : 's'}`" variant="soft" color="neutral" size="xs" />
                  <UBadge
                    :label="tax.contentTypes.length ? tax.contentTypes.join(', ') : 'All content types'"
                    variant="outline"
                    color="neutral"
                    size="xs"
                  />
                  <UBadge v-if="tax.noindex" label="noindex" variant="soft" color="warning" size="xs" />
                </div>
              </div>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <UButton
                icon="i-lucide-pencil"
                size="xs"
                variant="ghost"
                color="neutral"
                :aria-label="`Edit ${tax.name}`"
                @click.stop="openTaxonomyModal(tax)"
              />
              <UButton
                v-if="canDeleteTaxonomy"
                icon="i-lucide-trash-2"
                size="xs"
                color="error"
                variant="ghost"
                :aria-label="`Delete ${tax.name}`"
                @click.stop="deleteTaxonomyTarget = tax"
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
      <div v-if="activeTaxonomy" class="lg:col-span-3">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="font-semibold text-sm text-gray-900 dark:text-white">{{ activeTaxonomy.name }}</p>
                <a :href="`/${activeTaxonomy.slug}`" target="_blank" class="text-xs text-primary-500 hover:underline">View overview page ↗</a>
              </div>
              <div class="flex items-center gap-2">
                <UInput v-model="search" icon="i-lucide-search" placeholder="Filter terms…" size="sm" class="w-40" />
                <UButton size="sm" icon="i-lucide-plus" @click="openTermModal(null)">Add term</UButton>
              </div>
            </div>
          </template>

          <div v-if="loadingTerms && terms.length === 0" class="py-6 flex justify-center">
            <UIcon name="i-lucide-loader-2" class="w-5 h-5 animate-spin text-gray-400" />
          </div>

          <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
            <li
              v-for="term in visibleTerms"
              :key="term.id"
              class="flex items-center justify-between gap-2 py-2 pr-1 group"
              :style="{ paddingLeft: `${term.depth * 1.25 + 0.25}rem` }"
            >
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <UIcon v-if="term.depth > 0" name="i-lucide-corner-down-right" class="w-3.5 h-3.5 text-gray-300 shrink-0" />
                  <span class="text-sm font-medium text-gray-900 dark:text-white truncate">{{ term.name }}</span>
                  <span class="text-xs text-gray-400 font-mono truncate">{{ term.slug }}</span>
                  <span v-if="search && term.parentId" class="text-xs text-gray-400">in {{ parentName(term) }}</span>
                </div>
                <p v-if="term.description" class="text-xs text-gray-400 mt-0.5 truncate">{{ term.description }}</p>
              </div>
              <div class="flex items-center gap-0.5 shrink-0">
                <UButton
                  :to="contentLinkFor(term)"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  :label="String(term.count)"
                  icon="i-lucide-file-text"
                  :aria-label="`${term.count} items tagged ${term.name}`"
                />
                <template v-if="!search">
                  <UButton icon="i-lucide-arrow-up" size="xs" variant="ghost" color="neutral" :disabled="reordering || !canMove(term, -1)" aria-label="Move up" @click="move(term, -1)" />
                  <UButton icon="i-lucide-arrow-down" size="xs" variant="ghost" color="neutral" :disabled="reordering || !canMove(term, 1)" aria-label="Move down" @click="move(term, 1)" />
                </template>
                <UButton
                  v-if="activeTaxonomy.isHierarchical"
                  icon="i-lucide-list-plus"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  :aria-label="`Add a sub-term under ${term.name}`"
                  @click="openTermModal(null, term.id)"
                />
                <UButton
                  :to="`/${activeTaxonomy.slug}/${term.slug}`"
                  target="_blank"
                  icon="i-lucide-external-link"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  aria-label="View archive"
                />
                <UButton icon="i-lucide-pencil" size="xs" variant="ghost" color="neutral" :aria-label="`Edit ${term.name}`" @click="openTermModal(term)" />
                <UButton icon="i-lucide-trash-2" size="xs" variant="ghost" color="error" :aria-label="`Delete ${term.name}`" @click="deleteTermTarget = term" />
              </div>
            </li>
          </ul>
          <p v-if="!loadingTerms && visibleTerms.length === 0" class="text-sm text-gray-400 py-2">
            {{ search ? 'No matching terms.' : 'No terms yet.' }}
          </p>

          <template #footer>
            <form class="flex gap-2" @submit.prevent="quickAdd">
              <UInput v-model="quickName" placeholder="Quick add a term…" class="flex-1" size="sm" />
              <UButton type="submit" size="sm" :loading="quickAdding" icon="i-lucide-plus">Add</UButton>
            </form>
          </template>
        </UCard>
      </div>
      <div v-else class="lg:col-span-3 flex items-center justify-center rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 h-48">
        <p class="text-sm text-gray-400">Select a taxonomy to manage its terms</p>
      </div>
    </div>

    <AdminTaxonomiesFormModal v-model:open="taxonomyModalOpen" :taxonomy="editingTaxonomy" @saved="refreshAll" />
    <AdminTaxonomiesTermModal
      v-if="activeTaxonomy"
      v-model:open="termModalOpen"
      :taxonomy="activeTaxonomy"
      :terms="terms"
      :term="editingTerm"
      :default-parent-id="newTermParentId"
      @saved="refreshAll"
    />

    <!-- Delete taxonomy -->
    <UModal v-model:open="deleteTaxonomyOpen" :title="`Delete ${deleteTaxonomyTarget?.name ?? 'taxonomy'}?`">
      <template #body>
        <p class="text-sm text-gray-600 dark:text-gray-400">
          This permanently deletes the taxonomy and its {{ deleteTaxonomyTarget?.termCount ?? 0 }} term(s). Content keeps existing but loses these assignments, and the archive pages stop working.
        </p>
      </template>
      <template #footer>
        <UButton variant="ghost" @click="deleteTaxonomyTarget = null">Cancel</UButton>
        <UButton color="error" :loading="deletingTaxonomy" @click="deleteTaxonomy">Delete</UButton>
      </template>
    </UModal>

    <!-- Delete term -->
    <UModal v-model:open="deleteTermOpen" :title="`Delete ${deleteTermTarget?.name ?? 'term'}?`">
      <template #body>
        <div class="text-sm text-gray-600 dark:text-gray-400 space-y-2">
          <p>
            {{ deleteTermTarget?.count ? `It's assigned to ${deleteTermTarget.count} item(s), which will lose it.` : 'No content uses it.' }}
            Its archive page will stop working.
          </p>
          <p v-if="deleteTermChildren">Its {{ deleteTermChildren }} sub-term(s) move up one level.</p>
        </div>
      </template>
      <template #footer>
        <UButton variant="ghost" @click="deleteTermTarget = null">Cancel</UButton>
        <UButton color="error" :loading="deletingTerm" @click="deleteTerm">Delete</UButton>
      </template>
    </UModal>
  </div>
</template>
