<script setup lang="ts">
// Categories/tags for the item being edited. Controlled: the selection is part of the
// editor's form and is saved with the post (POST/PATCH /api/v1/content `termIds`), so
// tagging a brand-new item works before its first save and follows the same
// save/autosave flow as every other field.
const props = defineProps<{
  /** Content type slug of the item — only taxonomies that apply to it are offered. */
  contentType: string
  disabled?: boolean
  /** Title/plain text of the item, for AI suggestions. */
  title?: string
  bodyText?: string
}>()
const selected = defineModel<string[]>({ required: true })
const toast = useToast()

const access = await fetchAdminAccess()
// Creating terms is an editor action (POST /taxonomies/:id/terms); authors can only pick.
const canCreate = computed(() => Boolean(access?.role && roleAtLeast(access.role, 'editor')))

const { data: taxData } = await useFetch<{ taxonomies: AdminTaxonomy[] }>('/api/v1/taxonomies', {
  default: () => ({ taxonomies: [] }),
})

const applicable = computed(() => taxData.value.taxonomies.filter(t =>
  t.contentTypes.length === 0 || t.contentTypes.includes(props.contentType)))

// Every applicable taxonomy's terms are loaded up front — the selected-term chips need
// names for terms in panels that were never opened.
const termsByTaxonomy = ref<Record<string, AdminTerm[]>>({})
async function loadTerms(taxonomyId: string) {
  try {
    const url: string = `/api/v1/taxonomies/${taxonomyId}/terms`
    const res = await $fetch<{ terms: AdminTerm[] }>(url)
    termsByTaxonomy.value[taxonomyId] = res.terms
  } catch (e: unknown) {
    toast.add({ title: getErrorMessage(e, 'Could not load terms'), color: 'error' })
  }
}
watch(applicable, (list) => {
  for (const t of list) if (!termsByTaxonomy.value[t.id]) loadTerms(t.id)
}, { immediate: true })

const termById = computed(() => {
  const map = new Map<string, { term: AdminTerm; taxonomy: AdminTaxonomy }>()
  for (const tax of applicable.value) {
    for (const term of termsByTaxonomy.value[tax.id] ?? []) map.set(term.id, { term, taxonomy: tax })
  }
  return map
})

const selectedSet = computed(() => new Set(selected.value))
const selectedChips = computed(() => selected.value
  .map(id => termById.value.get(id))
  .filter((x): x is { term: AdminTerm; taxonomy: AdminTaxonomy } => Boolean(x)))

function toggle(termId: string) {
  if (props.disabled) return
  selected.value = selectedSet.value.has(termId)
    ? selected.value.filter(id => id !== termId)
    : [...selected.value, termId]
}

// ── Panels, tree, search ──────────────────────────────────────────────────────
const openTaxonomy = ref<string | null>(null)
const search = ref<Record<string, string>>({})

function visibleTerms(tax: AdminTaxonomy) {
  const tree = flattenTermTree(termsByTaxonomy.value[tax.id] ?? [])
  const q = search.value[tax.id]?.trim().toLowerCase()
  return q ? tree.filter(t => t.name.toLowerCase().includes(q)).map(t => ({ ...t, depth: 0 })) : tree
}
function selectedCount(tax: AdminTaxonomy) {
  return (termsByTaxonomy.value[tax.id] ?? []).filter(t => selectedSet.value.has(t.id)).length
}

// ── Inline creation (editor+) ─────────────────────────────────────────────────
const newTermName = ref<Record<string, string>>({})
const creating = ref<Record<string, boolean>>({})

async function createTerm(taxonomyId: string, nameArg?: string) {
  const name = (nameArg ?? newTermName.value[taxonomyId] ?? '').trim()
  if (!name) return
  if (!slugifyTermName(name)) {
    toast.add({ title: 'Add this term from Admin → Taxonomies', description: 'The name has no letters or digits to build a URL slug from, so it needs a slug typed in.', color: 'warning' })
    return
  }
  creating.value[taxonomyId] = true
  try {
    const url: string = `/api/v1/taxonomies/${taxonomyId}/terms`
    const res = await $fetch<{ id: string }>(url, { method: 'POST', body: { name } })
    await loadTerms(taxonomyId)
    if (!nameArg) newTermName.value[taxonomyId] = ''
    if (!selectedSet.value.has(res.id)) selected.value = [...selected.value, res.id]
  } catch (e: unknown) {
    toast.add({ title: getErrorMessage(e, 'Could not add the term'), color: 'error' })
  } finally {
    creating.value[taxonomyId] = false
  }
}

// ── AI suggestions ────────────────────────────────────────────────────────────
interface Suggestions {
  matchedTerms: { id: string; name: string; taxonomyId: string; taxonomySlug: string }[]
  newTermSuggestions: { taxonomySlug: string; name: string }[]
}
const suggestions = ref<Suggestions | null>(null)
const suggesting = ref(false)

async function suggest() {
  if (!props.title?.trim()) {
    toast.add({ title: 'Add a title first', color: 'warning' })
    return
  }
  suggesting.value = true
  try {
    suggestions.value = await $fetch<Suggestions>('/api/v1/ai/suggest-terms', {
      method: 'POST',
      body: { title: props.title, body: props.bodyText?.slice(0, 8000), contentType: props.contentType },
    })
    const s = suggestions.value
    if (!s.matchedTerms.length && !s.newTermSuggestions.length) toast.add({ title: 'No suggestions for this content', color: 'neutral' })
  } catch (e: unknown) {
    toast.add({ title: getErrorMessage(e, 'Could not get suggestions'), color: 'error' })
  } finally {
    suggesting.value = false
  }
}

const pendingMatched = computed(() => (suggestions.value?.matchedTerms ?? []).filter(t => !selectedSet.value.has(t.id)))
const taxonomyBySlug = computed(() => new Map(applicable.value.map(t => [t.slug, t])))
const pendingNew = computed(() => (suggestions.value?.newTermSuggestions ?? []).filter((s) => {
  const tax = taxonomyBySlug.value.get(s.taxonomySlug)
  return tax && !(termsByTaxonomy.value[tax.id] ?? []).some(t => t.name.toLowerCase() === s.name.toLowerCase())
}))
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <p class="text-sm font-semibold">Categories & Tags</p>
        <UButton
          v-if="applicable.length && !disabled"
          size="xs"
          variant="ghost"
          icon="i-lucide-sparkles"
          :loading="suggesting"
          @click="suggest"
        >
          Suggest
        </UButton>
      </div>
    </template>
    <div class="space-y-3">
      <!-- Selected -->
      <div v-if="selectedChips.length" class="flex flex-wrap gap-1.5">
        <UBadge
          v-for="chip in selectedChips"
          :key="chip.term.id"
          variant="soft"
          size="sm"
          class="gap-1"
        >
          <span class="text-gray-400">{{ chip.taxonomy.name }}:</span> {{ chip.term.name }}
          <button
            v-if="!disabled"
            type="button"
            class="ml-0.5 opacity-60 hover:opacity-100"
            :aria-label="`Remove ${chip.term.name}`"
            @click="toggle(chip.term.id)"
          >
            <UIcon name="i-lucide-x" class="w-3 h-3" />
          </button>
        </UBadge>
      </div>

      <!-- AI suggestions -->
      <div v-if="pendingMatched.length || (canCreate && pendingNew.length)" class="rounded-lg border border-dashed border-primary-300 dark:border-primary-800 p-2 space-y-1.5">
        <p class="text-xs text-gray-500">Suggested</p>
        <div class="flex flex-wrap gap-1.5">
          <UButton
            v-for="t in pendingMatched"
            :key="t.id"
            size="xs"
            variant="outline"
            icon="i-lucide-plus"
            @click="toggle(t.id)"
          >
            {{ t.name }}
          </UButton>
          <template v-if="canCreate">
            <UButton
              v-for="s in pendingNew"
              :key="`${s.taxonomySlug}:${s.name}`"
              size="xs"
              variant="ghost"
              icon="i-lucide-plus"
              :title="`Create “${s.name}” in ${taxonomyBySlug.get(s.taxonomySlug)?.name}`"
              @click="createTerm(taxonomyBySlug.get(s.taxonomySlug)!.id, s.name)"
            >
              New: {{ s.name }}
            </UButton>
          </template>
        </div>
      </div>

      <div
        v-for="taxonomy in applicable"
        :key="taxonomy.id"
        class="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
      >
        <button
          type="button"
          class="w-full flex items-center justify-between px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          @click="openTaxonomy = openTaxonomy === taxonomy.id ? null : taxonomy.id"
        >
          <span>{{ taxonomy.name }}</span>
          <div class="flex items-center gap-2">
            <span class="text-xs text-gray-400">{{ selectedCount(taxonomy) }} selected</span>
            <UIcon :name="openTaxonomy === taxonomy.id ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="w-3.5 h-3.5 text-gray-400" />
          </div>
        </button>

        <div v-if="openTaxonomy === taxonomy.id" class="px-3 pb-3 space-y-1 border-t border-gray-200 dark:border-gray-700 pt-2">
          <UInput
            v-if="(termsByTaxonomy[taxonomy.id] ?? []).length > 12"
            v-model="search[taxonomy.id]"
            size="xs"
            icon="i-lucide-search"
            placeholder="Filter…"
            class="w-full mb-1"
          />
          <div class="max-h-64 overflow-y-auto space-y-0.5">
            <label
              v-for="term in visibleTerms(taxonomy)"
              :key="term.id"
              class="flex items-center gap-2 text-sm cursor-pointer py-0.5"
              :style="{ paddingLeft: `${term.depth}rem` }"
            >
              <input
                type="checkbox"
                :checked="selectedSet.has(term.id)"
                :disabled="disabled"
                class="rounded text-primary-500"
                @change="toggle(term.id)"
              >
              {{ term.name }}
            </label>
          </div>
          <p v-if="(termsByTaxonomy[taxonomy.id] ?? []).length === 0" class="text-xs text-gray-400 py-1">No terms yet</p>

          <!-- Inline new term -->
          <form v-if="canCreate && !disabled" class="flex gap-1 mt-2" @submit.prevent="createTerm(taxonomy.id)">
            <UInput
              v-model="newTermName[taxonomy.id]"
              size="xs"
              placeholder="Add new term…"
              class="flex-1"
            />
            <UButton type="submit" size="xs" icon="i-lucide-plus" :loading="creating[taxonomy.id]" aria-label="Add term" />
          </form>
        </div>
      </div>

      <p v-if="applicable.length === 0" class="text-xs text-gray-400">
        No taxonomies apply to this content type.
        <NuxtLink v-if="canCreate" to="/admin/taxonomies" class="text-primary-500 hover:underline">Manage taxonomies</NuxtLink>
      </p>
    </div>
  </UCard>
</template>
