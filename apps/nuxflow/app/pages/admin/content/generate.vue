<script setup lang="ts">
import type { GeneratedPage } from '~/components/admin/ai/GeneratedPageCard.vue'
import type { PlanPageDraft } from '~/components/admin/ai/PlanEditor.vue'

definePageMeta({ layout: 'admin', middleware: ['auth'] })

interface PlanPage extends PlanPageDraft { contentItemId?: string; error?: string }
type JobItem = NonNullable<GeneratedPage['item']>
interface GenerationJob {
  id: string
  type: 'page' | 'site'
  status: 'planning' | 'approved' | 'generating' | 'complete' | 'failed'
  prompt: string
  plan: PlanPage[] | null
  generatedCount: number
  totalCount: number
  error: string | null
  busy: boolean
  items: JobItem[]
}
interface JobSummary {
  id: string
  prompt: string
  type: 'page' | 'site'
  status: GenerationJob['status']
  generatedCount: number
  totalCount: number
  createdAt: string
}

const MAX_PLAN_PAGES = 10
const MAX_PROMPT = 2000

const toast = useToast()
const { confirm } = useConfirm()

const prompt = ref('')
const genType = ref<'page' | 'site'>('site')
const tone = ref('professional')
const job = ref<GenerationJob | null>(null)
const starting = ref(false)
const approving = ref(false)
const planDraft = ref<PlanPageDraft[]>([])
const driveError = ref('')
const pageBusy = ref<Record<number, boolean>>({})
const bulkBusy = ref(false)

const typeOptions = [
  { value: 'site', label: 'Full site (multiple pages)' },
  { value: 'page', label: 'Single page' },
]
const toneOptions = ['professional', 'casual', 'friendly', 'bold', 'playful', 'technical'].map(t => ({ value: t, label: t[0]!.toUpperCase() + t.slice(1) }))

// ── History (and resuming an unfinished job) ────────────────────────────────
const { data: history, refresh: refreshHistory } = await useFetch<{ jobs: JobSummary[] }>('/api/v1/ai/generate', {
  default: () => ({ jobs: [] }),
})

function needsWork(j: GenerationJob): boolean {
  return (j.status === 'planning' && !j.plan?.length) || j.status === 'generating' || j.status === 'approved'
}

// ── Driving a job ───────────────────────────────────────────────────────────
// The server does one unit of work (the plan, or one page) per POST .../step while this
// page waits — see server/utils/site-generation.ts for why it isn't a background job.
// Leaving the page just pauses the job; it's resumable from the history list.
let driving = false
let unmounted = false
onBeforeUnmount(() => { unmounted = true })

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function drive() {
  if (driving || !job.value) return
  driving = true
  driveError.value = ''
  try {
    while (!unmounted && job.value && needsWork(job.value)) {
      const url: string = `/api/v1/ai/generate/${job.value.id}/step`
      const next = await $fetch<GenerationJob>(url, { method: 'POST' })
      job.value = next
      // Another tab holds the job's lease — wait and check again rather than duplicating its work.
      if (next.busy) await sleep(3000)
    }
  }
  catch (e: unknown) {
    driveError.value = getErrorMessage(e, 'Generation stopped unexpectedly')
  }
  finally {
    driving = false
    void refreshHistory()
  }
}

watch(() => job.value?.plan, (plan) => {
  if (job.value?.status === 'planning' && plan?.length) {
    planDraft.value = plan.map(p => ({ title: p.title, slug: p.slug, description: p.description }))
  }
}, { immediate: true })

async function generate() {
  if (prompt.value.trim().length < 10) {
    toast.add({ title: 'Describe what you want in a bit more detail', color: 'warning' })
    return
  }
  starting.value = true
  try {
    const res = await $fetch<{ jobId: string; job: GenerationJob }>('/api/v1/ai/generate', {
      method: 'POST',
      body: { prompt: prompt.value.trim(), type: genType.value, tone: tone.value },
    })
    job.value = res.job
  }
  catch (e: unknown) {
    toast.add({ title: 'Failed to start generation', description: getErrorMessage(e, ''), color: 'error' })
    return
  }
  finally {
    starting.value = false
  }
  void drive()
}

async function openJob(id: string) {
  const url: string = `/api/v1/ai/generate/${id}`
  try {
    job.value = await $fetch<GenerationJob>(url)
    prompt.value = job.value.prompt
    genType.value = job.value.type
    void drive()
  }
  catch (e: unknown) {
    toast.add({ title: 'Could not open that generation', description: getErrorMessage(e, ''), color: 'error' })
  }
}

async function reloadJob() {
  if (!job.value) return
  const url: string = `/api/v1/ai/generate/${job.value.id}`
  job.value = await $fetch<GenerationJob>(url)
}

async function approve() {
  if (!job.value) return
  const pages = planDraft.value.map(p => ({ title: p.title.trim(), slug: p.slug.trim(), description: p.description.trim() }))
  if (pages.some(p => !p.title || !p.description)) {
    toast.add({ title: 'Every page needs a title and a description', color: 'warning' })
    return
  }
  approving.value = true
  const url: string = `/api/v1/ai/generate/${job.value.id}/approve`
  try {
    job.value = await $fetch<GenerationJob>(url, { method: 'POST', body: { pages } })
  }
  catch (e: unknown) {
    toast.add({ title: 'Failed to approve plan', description: getErrorMessage(e, ''), color: 'error' })
    return
  }
  finally {
    approving.value = false
  }
  void drive()
}

function startOver() {
  job.value = null
  prompt.value = ''
  driveError.value = ''
}

// ── Review ──────────────────────────────────────────────────────────────────
const reviewPages = computed<GeneratedPage[]>(() => {
  const j = job.value
  if (!j?.plan) return []
  const items = new Map(j.items.map(i => [i.id, i]))
  return j.plan.map((p, index) => {
    const item = p.contentItemId ? items.get(p.contentItemId) : undefined
    return { index, title: p.title || 'Generated page', slug: p.slug, error: p.error, item, missing: Boolean(p.contentItemId && !item) }
  })
})
const draftItems = computed(() => reviewPages.value.flatMap(p => (p.item?.status === 'draft' ? [p.item] : [])))

async function regenerate(index: number) {
  if (!job.value) return
  pageBusy.value = { ...pageBusy.value, [index]: true }
  const url: string = `/api/v1/ai/generate/${job.value.id}/regenerate`
  try {
    job.value = await $fetch<GenerationJob>(url, { method: 'POST', body: { index } })
  }
  catch (e: unknown) {
    toast.add({ title: 'Regeneration failed', description: getErrorMessage(e, ''), color: 'error' })
  }
  finally {
    pageBusy.value = { ...pageBusy.value, [index]: false }
  }
}

async function openPreview(page: GeneratedPage) {
  if (!page.item) return
  // Opened synchronously (before the await) so popup blockers treat it as user-initiated.
  const win = window.open('about:blank', '_blank')
  const url: string = `/api/v1/content/${page.item.id}/preview-link`
  try {
    const res = await $fetch<{ url: string }>(url, { method: 'POST' })
    if (win) win.location.href = res.url
    else window.open(res.url, '_blank')
  }
  catch (e: unknown) {
    win?.close()
    toast.add({ title: 'Could not open a preview', description: getErrorMessage(e, ''), color: 'error' })
  }
}

async function discard(page: GeneratedPage) {
  if (!page.item) return
  const ok = await confirm({ title: `Discard "${page.item.title}"?`, description: 'The draft page is deleted.', confirmLabel: 'Discard', color: 'error' })
  if (!ok) return
  pageBusy.value = { ...pageBusy.value, [page.index]: true }
  const url: string = `/api/v1/content/${page.item.id}`
  try {
    await $fetch<unknown>(url, { method: 'DELETE' })
    await reloadJob()
  }
  catch (e: unknown) {
    toast.add({ title: 'Could not discard the page', description: getErrorMessage(e, ''), color: 'error' })
  }
  finally {
    pageBusy.value = { ...pageBusy.value, [page.index]: false }
  }
}

async function forEachDraft(action: 'publish' | 'discard') {
  const drafts = draftItems.value
  if (!drafts.length) return
  const ok = await confirm(action === 'publish'
    ? { title: `Publish ${drafts.length} page${drafts.length === 1 ? '' : 's'}?`, description: 'They go live on the site straight away.', confirmLabel: 'Publish', color: 'primary' }
    : { title: `Discard ${drafts.length} draft page${drafts.length === 1 ? '' : 's'}?`, description: 'The draft pages are deleted.', confirmLabel: 'Discard all', color: 'error' })
  if (!ok) return
  bulkBusy.value = true
  let failed = 0
  for (const item of drafts) {
    const url: string = `/api/v1/content/${item.id}`
    try {
      if (action === 'publish') await $fetch<unknown>(url, { method: 'PATCH', body: { status: 'published' } })
      else await $fetch<unknown>(url, { method: 'DELETE' })
    }
    catch {
      failed++
    }
  }
  bulkBusy.value = false
  await reloadJob()
  const done = drafts.length - failed
  toast.add({
    title: action === 'publish' ? `Published ${done} page${done === 1 ? '' : 's'}` : `Discarded ${done} page${done === 1 ? '' : 's'}`,
    description: failed ? `${failed} couldn't be ${action === 'publish' ? 'published' : 'discarded'} — try those from the content list.` : undefined,
    color: failed ? 'warning' : 'success',
  })
}

const currentPageIndex = computed(() => job.value?.plan?.findIndex(p => !p.contentItemId && !p.error) ?? -1)
const progressPercent = computed(() => {
  if (!job.value?.totalCount) return 0
  return Math.round((job.value.generatedCount / job.value.totalCount) * 100)
})

function appendDictation(text: string) {
  prompt.value = (prompt.value ? `${prompt.value.trimEnd()} ${text}` : text).slice(0, MAX_PROMPT)
}

const statusLabel: Record<GenerationJob['status'], string> = {
  planning: 'Awaiting plan approval',
  approved: 'In progress',
  generating: 'In progress',
  complete: 'Complete',
  failed: 'Failed',
}
</script>

<template>
  <div class="max-w-4xl space-y-6">
    <div>
      <h1 class="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
        <UIcon name="i-lucide-sparkles" class="text-primary-500" />
        Generate with AI
      </h1>
      <p class="text-sm text-gray-500 mt-1">Describe a page or a whole small site. AI plans it, builds it from your site's blocks, and saves every page as a draft for you to preview, regenerate, and publish.</p>
    </div>

    <UCard>
      <div class="space-y-4">
        <UFormField label="What do you want?" :hint="`${prompt.length}/${MAX_PROMPT}`">
          <template #help>
            <span class="flex items-center justify-between gap-2">
              The more specific the better: business name, audience, sections you want, and the style.
              <AiVoiceInput v-if="!job" @transcribed="appendDictation" />
            </span>
          </template>
          <!-- UTextarea's root is inline-flex, so without w-full it shrinks to its content
               width instead of filling the card. -->
          <UTextarea
            v-model="prompt"
            class="w-full"
            :rows="6"
            autoresize
            :maxrows="16"
            :maxlength="MAX_PROMPT"
            placeholder="e.g. A site for Flux, a project-management SaaS for small design agencies — home page with hero, three-column features, testimonials and FAQ; a pricing page with three plans; an about page; and a contact page."
            :disabled="starting || !!job"
          />
        </UFormField>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <UFormField label="Scope">
            <URadioGroup v-model="genType" :items="typeOptions" :disabled="starting || !!job" />
          </UFormField>
          <UFormField label="Tone">
            <USelect v-model="tone" :items="toneOptions" class="w-full" :disabled="starting || !!job" />
          </UFormField>
        </div>
      </div>

      <template #footer>
        <UButton v-if="!job" :loading="starting" icon="i-lucide-sparkles" @click="generate">
          Generate
        </UButton>
        <UButton v-else variant="outline" icon="i-lucide-rotate-ccw" @click="startOver">
          Start something new
        </UButton>
      </template>
    </UCard>

    <!-- Plan review (site jobs only) -->
    <UCard v-if="job && job.status === 'planning' && job.plan?.length">
      <template #header>
        <p class="text-sm font-semibold">Proposed pages</p>
        <p class="text-xs text-gray-500 mt-0.5">Edit, reorder, remove, or add pages — each description is what the AI designs that page from.</p>
      </template>
      <AdminAiPlanEditor v-model="planDraft" :max="MAX_PLAN_PAGES" :disabled="approving" />
      <template #footer>
        <UButton :loading="approving" icon="i-lucide-check" @click="approve">
          Generate {{ planDraft.length }} page{{ planDraft.length === 1 ? '' : 's' }}
        </UButton>
      </template>
    </UCard>

    <!-- Planning -->
    <UCard v-else-if="job && job.status === 'planning'">
      <div class="flex items-center gap-3 text-sm text-gray-500">
        <UIcon name="i-lucide-loader-2" class="animate-spin" />
        Planning your site…
      </div>
    </UCard>

    <!-- Generating -->
    <UCard v-else-if="job && (job.status === 'generating' || job.status === 'approved')">
      <div class="space-y-3">
        <div class="flex items-center gap-3 text-sm text-gray-500">
          <UIcon name="i-lucide-loader-2" class="animate-spin" />
          <span v-if="job.totalCount > 1">Generating page {{ Math.min(job.generatedCount + 1, job.totalCount) }} of {{ job.totalCount }}… keep this page open.</span>
          <span v-else>Generating your page… keep this page open.</span>
        </div>
        <div v-if="job.totalCount > 1" class="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
          <div class="h-full bg-primary-400 rounded-full transition-all" :style="{ width: `${progressPercent}%` }" />
        </div>
        <ul v-if="job.type === 'site' && job.plan" class="space-y-1 text-sm">
          <li v-for="(p, i) in job.plan" :key="i" class="flex items-center gap-2">
            <UIcon
              :name="p.contentItemId ? 'i-lucide-check' : p.error ? 'i-lucide-x' : i === currentPageIndex ? 'i-lucide-loader-2' : 'i-lucide-circle'"
              :class="[p.contentItemId ? 'text-green-500' : p.error ? 'text-red-500' : 'text-gray-400', { 'animate-spin': !p.contentItemId && !p.error && i === currentPageIndex }]"
            />
            {{ p.title }}
          </li>
        </ul>
      </div>
    </UCard>

    <UAlert
      v-if="driveError && job && needsWork(job)"
      color="warning"
      variant="soft"
      icon="i-lucide-pause-circle"
      title="Generation paused"
      :description="driveError"
      :actions="[{ label: 'Resume', icon: 'i-lucide-play', onClick: () => { void drive() } }]"
    />

    <!-- Review -->
    <UCard v-if="job && job.status === 'complete'">
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="text-sm font-semibold text-green-600 dark:text-green-400 flex items-center gap-1.5">
              <UIcon name="i-lucide-check-circle" /> Generated {{ job.items.length }} page{{ job.items.length === 1 ? '' : 's' }}
            </p>
            <p class="text-xs text-gray-500 mt-0.5">Nothing is live yet — preview each draft, regenerate any you don't like, then publish.</p>
          </div>
          <div v-if="draftItems.length" class="flex items-center gap-2">
            <UButton size="sm" variant="outline" color="error" icon="i-lucide-trash-2" :disabled="bulkBusy" @click="forEachDraft('discard')">Discard all</UButton>
            <UButton size="sm" icon="i-lucide-globe" :loading="bulkBusy" @click="forEachDraft('publish')">Publish all</UButton>
          </div>
        </div>
      </template>
      <div class="space-y-3">
        <AdminAiGeneratedPageCard
          v-for="page in reviewPages"
          :key="page.index"
          :page="page"
          :busy="pageBusy[page.index] || bulkBusy"
          @regenerate="regenerate(page.index)"
          @discard="discard(page)"
          @preview="openPreview(page)"
        />
      </div>
    </UCard>

    <UAlert
      v-else-if="job && job.status === 'failed'"
      color="error"
      variant="soft"
      icon="i-lucide-x-circle"
      title="Generation failed"
      :description="job.error ?? 'Unknown error'"
    />

    <!-- History -->
    <UCard v-if="!job && history.jobs.length">
      <template #header>
        <p class="text-sm font-semibold">Recent generations</p>
      </template>
      <ul class="divide-y divide-gray-100 dark:divide-gray-800">
        <li v-for="h in history.jobs.slice(0, 10)" :key="h.id" class="py-2.5 flex items-center gap-3">
          <div class="flex-1 min-w-0">
            <p class="text-sm truncate">{{ h.prompt }}</p>
            <p class="text-xs text-gray-400">
              {{ h.type === 'site' ? 'Site' : 'Page' }} · {{ statusLabel[h.status] }}<template v-if="h.totalCount"> · {{ h.generatedCount }}/{{ h.totalCount }} pages</template>
              · {{ new Date(h.createdAt.replace(' ', 'T') + 'Z').toLocaleString() }}
            </p>
          </div>
          <UButton
            v-if="h.status !== 'failed'"
            size="xs"
            variant="outline"
            :icon="h.status === 'complete' ? 'i-lucide-eye' : 'i-lucide-play'"
            @click="openJob(h.id)"
          >
            {{ h.status === 'complete' ? 'Review' : h.status === 'planning' ? 'Continue' : 'Resume' }}
          </UButton>
        </li>
      </ul>
    </UCard>
  </div>
</template>
