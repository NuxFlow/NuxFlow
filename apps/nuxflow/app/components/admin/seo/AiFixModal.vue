<script setup lang="ts">
import type { AuditItem, SeoAiSuggestion } from '#shared/lib/seo-types'

// SEO → Audit → "Suggest fixes with AI": the AI writes a search title and description for
// each page with a title/description problem, shown next to what the page has now. The
// person ticks (and can edit) what they want, and only then is anything saved: one PATCH
// per page, recorded in the audit log as AI-assisted (server/utils/ai-provenance.ts).

// At most 25 pages a run (AuditTab), so one click can't spend a site's AI credits on hundreds.
const props = defineProps<{ items: AuditItem[]; more?: number }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ applied: [] }>()


interface Row extends SeoAiSuggestion {
  useTitle: boolean
  useDescription: boolean
  outcome?: 'saved' | 'failed'
  outcomeMessage?: string
}

const BATCH = 5
const rows = ref<Row[]>([])
const loading = ref(false)
const progress = ref(0)
const loadError = ref('')
const { run, isRunning } = useAdminAction()

const total = computed(() => props.items.length)
const selected = computed(() => rows.value.filter(r => !r.error && r.outcome !== 'saved' && (r.useTitle || r.useDescription)))

watch(open, (isOpen) => {
  if (isOpen) load()
}, { immediate: true })

async function load() {
  rows.value = []
  progress.value = 0
  loadError.value = ''
  loading.value = true
  const byId = new Map(props.items.map(i => [i.id, i]))
  try {
    for (let i = 0; i < props.items.length && open.value; i += BATCH) {
      const ids = props.items.slice(i, i + BATCH).map(x => x.id)
      // Not useAdminAction(): progress and errors are shown inline in this window.
      const res = await $fetch<{ suggestions: SeoAiSuggestion[] }>('/api/v1/ai/seo-suggest', { method: 'POST', body: { contentIds: ids } })
      for (const s of res.suggestions) {
        const codes = new Set((byId.get(s.id)?.issues ?? []).map(x => x.code))
        rows.value.push({
          ...s,
          useTitle: !s.error && !!s.seoTitle && (!s.current.seoTitle || [...codes].some(c => SEO_TITLE_ISSUES.has(c))),
          useDescription: !s.error && !!s.seoDescription && [...codes].some(c => SEO_DESCRIPTION_ISSUES.has(c)),
        })
      }
      progress.value = Math.min(props.items.length, i + BATCH)
    }
  }
  catch (e) {
    loadError.value = getErrorMessage(e, 'The AI could not write suggestions. Check Settings → AI.')
  }
  finally {
    loading.value = false
  }
}

async function apply() {
  const toSave = selected.value
  const done = await run(async () => {
    let saved = 0
    for (const row of toSave) {
      try {
        const url: string = `/api/v1/content/${row.id}`
        await $fetch<unknown>(url, {
          method: 'PATCH',
          body: {
            ...(row.useTitle ? { seoTitle: row.seoTitle.trim() } : {}),
            ...(row.useDescription ? { seoDescription: row.seoDescription.trim() } : {}),
            expectedVersion: row.version,
            aiAssist: {
              kind: 'seo',
              instruction: 'Suggest a search title and description',
              summary: [row.useTitle && `Title: ${row.seoTitle.trim()}`, row.useDescription && `Description: ${row.seoDescription.trim()}`].filter(Boolean).join(' · '),
            },
          },
        })
        row.outcome = 'saved'
        saved++
      }
      catch (e) {
        row.outcome = 'failed'
        row.outcomeMessage = (e as { statusCode?: number })?.statusCode === 409
          ? 'Someone changed this page meanwhile, so it was left alone. Run the suggestions again.'
          : getErrorMessage(e, 'Could not save')
      }
    }
    return saved
  }, {
    successTitle: n => (n ? `Saved ${n} page${n === 1 ? '' : 's'}` : undefined),
    errorTitle: "Couldn't save the suggestions",
    key: 'apply',
  })
  if (done) emit('applied')
}

const failures = computed(() => rows.value.filter(r => r.outcome === 'failed'))
</script>

<template>
  <UModal v-model:open="open" title="Suggest SEO fixes with AI" description="Tick what you'd like to use. You can edit any suggestion first. Nothing is saved until you press Apply." :ui="{ content: 'sm:max-w-3xl' }">
    <template #body>
      <div class="space-y-4">
        <div v-if="loading" class="flex items-center gap-2 text-sm text-gray-500">
          <UIcon name="i-lucide-loader-2" class="w-4 h-4 animate-spin" />
          Writing suggestions… {{ progress }} of {{ total }}
        </div>
        <UAlert v-if="loadError" color="error" variant="soft" :title="loadError" />

        <ul class="divide-y divide-gray-100 dark:divide-gray-800" data-testid="seo-ai-rows">
          <li v-for="row in rows" :key="row.id" class="py-3 space-y-2">
            <div class="flex items-center justify-between gap-2">
              <NuxtLink :to="`/admin/content/${row.id}`" target="_blank" class="text-sm font-medium text-gray-900 dark:text-white hover:text-primary-500 truncate">{{ row.title }}</NuxtLink>
              <UBadge v-if="row.outcome === 'saved'" color="success" variant="soft" size="xs" icon="i-lucide-check">Saved</UBadge>
            </div>
            <p v-if="row.error" class="text-xs text-red-500">{{ row.error }}</p>
            <template v-else>
              <div class="flex items-start gap-2">
                <UCheckbox v-model="row.useTitle" :disabled="row.outcome === 'saved'" class="mt-2" :aria-label="`Use the suggested title for ${row.title}`" />
                <div class="flex-1 min-w-0 space-y-0.5">
                  <UInput v-model="row.seoTitle" size="sm" class="w-full" maxlength="200" :disabled="!row.useTitle || row.outcome === 'saved'" />
                  <p class="text-xs text-gray-400 truncate">
                    Title · {{ row.seoTitle.length }}/60 · now: {{ row.current.seoTitle || '(none — the page title is used)' }}
                  </p>
                </div>
              </div>
              <div class="flex items-start gap-2">
                <UCheckbox v-model="row.useDescription" :disabled="row.outcome === 'saved'" class="mt-2" :aria-label="`Use the suggested description for ${row.title}`" />
                <div class="flex-1 min-w-0 space-y-0.5">
                  <UTextarea v-model="row.seoDescription" size="sm" :rows="2" class="w-full" maxlength="500" :disabled="!row.useDescription || row.outcome === 'saved'" />
                  <p class="text-xs text-gray-400 line-clamp-2">
                    Description · {{ row.seoDescription.length }}/155 · now: {{ row.current.seoDescription || '(none)' }}
                  </p>
                </div>
              </div>
              <p v-if="row.outcome === 'failed'" class="text-xs text-red-500">{{ row.outcomeMessage }}</p>
            </template>
          </li>
        </ul>

        <p v-if="more && !loading" class="text-xs text-gray-500">{{ more }} more page{{ more === 1 ? '' : 's' }} can be done next time — apply these, then press the button again.</p>
        <p v-if="failures.length" class="text-xs text-red-500">{{ failures.length }} page{{ failures.length === 1 ? ' was' : 's were' }} not saved — see above.</p>
        <p class="text-xs text-gray-500 dark:text-gray-400 flex items-start gap-1.5">
          <UIcon name="i-lucide-info" class="w-3.5 h-3.5 mt-0.5 shrink-0" />
          AI can make mistakes — check each suggestion is accurate. Saved changes are marked AI-assisted in the audit log.
        </p>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton variant="ghost" color="neutral" @click="open = false">Close</UButton>
        <UButton :loading="isRunning('apply')" :disabled="loading || !selected.length" data-testid="seo-ai-apply" @click="apply">
          Apply {{ selected.length || '' }} selected
        </UButton>
      </div>
    </template>
  </UModal>
</template>
