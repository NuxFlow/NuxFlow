<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

interface JobPlanPage { title: string; slug: string; description: string }
interface GenerationJob {
  id: string
  type: 'page' | 'site'
  status: 'planning' | 'approved' | 'generating' | 'complete' | 'failed'
  plan: JobPlanPage[] | null
  generatedCount: number
  totalCount: number
  contentItemIds: string[] | null
  error: string | null
}

const { loading, run } = useAdminAction()
const toast = useToast()

const prompt = ref('')
const genType = ref<'page' | 'site'>('site')
const job = ref<GenerationJob | null>(null)
const approving = ref(false)
let pollTimer: ReturnType<typeof setTimeout> | undefined

const typeOptions = [
  { value: 'site', label: 'Full site (multiple pages)' },
  { value: 'page', label: 'Single page' },
]

onBeforeUnmount(() => { if (pollTimer) clearTimeout(pollTimer) })

async function poll(jobId: string) {
  // See the "Historical typecheck bug" note in CLAUDE.md — a bare template-literal URL
  // passed straight to $fetch can confuse Nitro's typed-route matching on routes that mix
  // a flat [id].xxx.ts file with a nested [id]/ folder (exactly this route's shape).
  // Assigning it to a plain `: string` first sidesteps that.
  const url: string = `/api/v1/ai/generate/${jobId}`
  try {
    const result = await $fetch<GenerationJob>(url)
    job.value = result
    if (result.status === 'planning' || result.status === 'generating' || result.status === 'approved') {
      pollTimer = setTimeout(() => poll(jobId), 2000)
    }
  } catch {
    // Transient network hiccup — keep polling rather than giving up on one failed request.
    pollTimer = setTimeout(() => poll(jobId), 3000)
  }
}

async function generate() {
  if (prompt.value.trim().length < 10) {
    toast.add({ title: 'Describe what you want in a bit more detail', color: 'warning' })
    return
  }
  job.value = null
  const result = await run(
    () => $fetch<{ jobId: string }>('/api/v1/ai/generate', {
      method: 'POST',
      body: { prompt: prompt.value, type: genType.value },
    }),
    { errorTitle: 'Failed to start generation' },
  )
  if (result) poll(result.jobId)
}

async function approve() {
  if (!job.value) return
  approving.value = true
  const url: string = `/api/v1/ai/generate/${job.value.id}/approve`
  try {
    await $fetch<{ status: string }>(url, { method: 'POST' })
    poll(job.value.id)
  } catch (e: unknown) {
    toast.add({ title: 'Failed to approve plan', description: getErrorMessage(e, ''), color: 'error' })
  } finally {
    approving.value = false
  }
}

const progressPercent = computed(() => {
  if (!job.value || !job.value.totalCount) return 0
  return Math.round((job.value.generatedCount / job.value.totalCount) * 100)
})
</script>

<template>
  <div class="max-w-3xl space-y-6">
    <div>
      <h1 class="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
        <UIcon name="i-lucide-sparkles" class="text-primary-500" />
        Generate with AI
      </h1>
      <p class="text-sm text-gray-500 mt-1">Describe a page or a whole small site — AI drafts it as canvas blocks, ready to review and publish.</p>
    </div>

    <UCard>
      <div class="space-y-4">
        <UFormField label="What do you want?">
          <UTextarea
            v-model="prompt"
            :rows="3"
            placeholder="e.g. A landing page for a SaaS product called Flux — dark theme, hero, three-column features, pricing table, FAQ, and a footer."
            :disabled="loading || !!job"
          />
        </UFormField>

        <UFormField label="Scope">
          <URadioGroup v-model="genType" :items="typeOptions" :disabled="loading || !!job" />
        </UFormField>
      </div>

      <template #footer>
        <UButton v-if="!job" :loading="loading" icon="i-lucide-sparkles" @click="generate">
          Generate
        </UButton>
        <UButton v-else variant="outline" icon="i-lucide-rotate-ccw" @click="job = null; prompt = ''">
          Start over
        </UButton>
      </template>
    </UCard>

    <!-- Plan review (site jobs only) -->
    <UCard v-if="job && job.status === 'planning' && job.plan?.length">
      <template #header>
        <p class="text-sm font-semibold">Proposed pages — review before generating</p>
      </template>
      <ul class="space-y-3">
        <li v-for="page in job.plan" :key="page.slug" class="border border-gray-100 dark:border-gray-800 rounded-lg p-3">
          <p class="font-medium text-sm">{{ page.title }} <span class="text-gray-400 font-normal">/{{ page.slug }}</span></p>
          <p class="text-xs text-gray-500 mt-1">{{ page.description }}</p>
        </li>
      </ul>
      <template #footer>
        <UButton :loading="approving" icon="i-lucide-check" @click="approve">
          Approve & generate {{ job.plan.length }} pages
        </UButton>
      </template>
    </UCard>

    <!-- Planning spinner (no plan yet) -->
    <UCard v-else-if="job && job.status === 'planning'">
      <div class="flex items-center gap-3 text-sm text-gray-500">
        <UIcon name="i-lucide-loader-2" class="animate-spin" />
        Planning your site…
      </div>
    </UCard>

    <!-- Generating progress -->
    <UCard v-else-if="job && (job.status === 'generating' || job.status === 'approved')">
      <div class="space-y-2">
        <div class="flex items-center gap-3 text-sm text-gray-500">
          <UIcon name="i-lucide-loader-2" class="animate-spin" />
          Generating{{ job.totalCount > 1 ? ` page ${job.generatedCount} of ${job.totalCount}` : '…' }}
        </div>
        <div v-if="job.totalCount > 1" class="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
          <div class="h-full bg-primary-400 rounded-full transition-all" :style="{ width: `${progressPercent}%` }" />
        </div>
      </div>
    </UCard>

    <!-- Complete -->
    <UCard v-else-if="job && job.status === 'complete'">
      <template #header>
        <p class="text-sm font-semibold text-green-600 dark:text-green-400 flex items-center gap-1.5">
          <UIcon name="i-lucide-check-circle" /> Done — {{ job.generatedCount }} page(s) created as drafts
        </p>
      </template>
      <ul class="space-y-2">
        <li v-for="id in job.contentItemIds ?? []" :key="id">
          <ULink :to="`/admin/content/${id}`" class="text-sm text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1.5">
            <UIcon name="i-lucide-file-text" /> Open draft <UIcon name="i-lucide-arrow-right" class="w-3 h-3" />
          </ULink>
        </li>
      </ul>
    </UCard>

    <!-- Failed -->
    <UAlert
      v-else-if="job && job.status === 'failed'"
      color="error"
      variant="soft"
      icon="i-lucide-x-circle"
      title="Generation failed"
      :description="job.error ?? 'Unknown error'"
    />
  </div>
</template>
