<script setup lang="ts">
import {
  displayValue,
  replyAddress,
  submissionColumns,
  submissionPreview,
  submissionsToCsv,
  type InboxField,
  type InboxSubmission,
  type SubmissionStatus,
} from '~/utils/form-submissions'

definePageMeta({ layout: 'admin', middleware: ['auth'] })

// The inbox for one form's submissions — every form, including the built-in contact form.

const route = useRoute()
const { run, isRunning } = useAdminAction()
const id = route.params.id as string

type Filter = 'inbox' | 'new' | 'archived' | 'spam' | 'all'
interface Payload {
  form: { id: string; name: string; slug: string; fields: InboxField[] | null }
  submissions: InboxSubmission[]
  total: number
  counts: Record<SubmissionStatus, number>
}

const PAGE_SIZE = 100
// A plain `string` URL — see CLAUDE.md: Nitro's typed-route matching trips on this route's
// flat file beside a same-named folder.
const listUrl: string = `/api/v1/forms/${id}/submissions`

const filter = ref<Filter>('inbox')
// `deep: true` — Nuxt 4's useFetch data is shallow by default, and opening a message
// updates its status (and the tab counts) in place.
const { data, refresh, error } = await useFetch<Payload>(listUrl, {
  query: computed(() => ({ status: filter.value, limit: PAGE_SIZE })),
  deep: true,
})

const form = computed(() => data.value?.form)
const extra = ref<InboxSubmission[]>([])
const submissions = computed(() => [...(data.value?.submissions ?? []), ...extra.value])
const counts = computed(() => data.value?.counts ?? { new: 0, read: 0, archived: 0, spam: 0 })
const columns = computed(() => submissionColumns(form.value?.fields, submissions.value))
const isBuiltInContact = computed(() => form.value?.slug === 'contact')

watch(filter, () => {
  extra.value = []
  selectedId.value = null
})

const filters = computed<Array<{ value: Filter; label: string; count?: number }>>(() => [
  { value: 'inbox', label: 'Inbox', count: counts.value.new + counts.value.read },
  { value: 'new', label: 'Unread', count: counts.value.new },
  { value: 'archived', label: 'Archived', count: counts.value.archived },
  { value: 'spam', label: 'Spam', count: counts.value.spam },
  { value: 'all', label: 'All' },
])

const loadingMore = computed(() => isRunning('more'))
async function loadMore() {
  const page = Math.floor(submissions.value.length / PAGE_SIZE) + 1
  const res = await run(() => $fetch<Payload>(listUrl, { query: { status: filter.value, limit: PAGE_SIZE, page } }), { errorTitle: "Couldn't load more submissions", key: 'more' })
  if (res) extra.value = [...extra.value, ...res.submissions]
}

// ── Selection + status ──────────────────────────────────────────────────────
const selectedId = ref<string | null>(null)
const selected = computed(() => submissions.value.find(s => s.id === selectedId.value) ?? null)
const selectedReply = computed(() => (selected.value ? replyAddress(form.value?.fields, selected.value) : null))

const statusColor: Record<SubmissionStatus, 'warning' | 'success' | 'error' | 'neutral'> = {
  new: 'warning',
  read: 'success',
  spam: 'error',
  archived: 'neutral',
}
const statusLabel: Record<SubmissionStatus, string> = { new: 'Unread', read: 'Read', spam: 'Spam', archived: 'Archived' }

const statusDone: Record<SubmissionStatus, string> = { new: 'Marked as unread', read: 'Moved to inbox', archived: 'Archived', spam: 'Marked as spam' }

async function setStatus(sub: InboxSubmission, status: SubmissionStatus, opts: { quiet?: boolean } = {}): Promise<boolean> {
  const url: string = `/api/v1/forms/${id}/submissions/${sub.id}`
  const done = await run(async () => {
    await $fetch<{ success: boolean }>(url, { method: 'PATCH', body: { status } })
    sub.status = status
    if (!opts.quiet) {
      // The row may no longer belong to this filter; reload the list and the counts.
      extra.value = []
      await refresh()
    }
    return true
  }, { successTitle: opts.quiet ? undefined : statusDone[status], errorTitle: "Couldn't update the submission" })
  return done === true
}

// Opening an unread submission marks it read, like an email inbox (it stays in view).
async function open(sub: InboxSubmission) {
  selectedId.value = sub.id
  if (sub.status !== 'new') return
  if (await setStatus(sub, 'read', { quiet: true }) && data.value) {
    data.value.counts = { ...data.value.counts, new: Math.max(0, data.value.counts.new - 1), read: data.value.counts.read + 1 }
  }
}

// ── CSV export (every submission in the current filter, not just the loaded page) ──
const exporting = computed(() => isRunning('export'))
async function downloadCsv() {
  await run(async () => {
    const all: InboxSubmission[] = []
    for (let page = 1; page < 1000; page++) {
      const res = await $fetch<Payload>(listUrl, { query: { status: filter.value, limit: 500, page } })
      all.push(...res.submissions)
      if (all.length >= res.total || !res.submissions.length) break
    }
    if (!all.length) return
    const csv = submissionsToCsv(submissionColumns(form.value?.fields, all), all)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `${form.value?.name ?? 'submissions'}.csv`
    a.click()
  }, { errorTitle: "Couldn't export submissions", key: 'export' })
}

</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-3 min-w-0">
        <UButton to="/admin/forms" variant="ghost" icon="i-lucide-arrow-left" size="sm" aria-label="Back to forms" />
        <h1 class="text-xl font-bold text-gray-900 dark:text-white truncate">{{ form?.name ?? 'Form' }} — Submissions</h1>
      </div>
      <div class="flex gap-2">
        <UButton v-if="form && !isBuiltInContact" :to="`/admin/forms/${id}/edit`" variant="ghost" icon="i-lucide-pencil" size="sm">Edit form</UButton>
        <UButton variant="outline" icon="i-lucide-download" size="sm" :loading="exporting" :disabled="!submissions.length" @click="downloadCsv">Export CSV</UButton>
      </div>
    </div>

    <UAlert
      v-if="isBuiltInContact"
      color="neutral"
      variant="subtle"
      icon="i-lucide-info"
      title="Built-in contact form"
      description="Messages from the Contact Form block on your pages land here. Its fields (name, email, subject, message) are fixed. To ask different questions, build a form under Forms and add it to a page with the Form block."
    />

    <p v-if="error" class="text-sm text-red-500">{{ getErrorMessage(error, 'Could not load submissions') }}</p>

    <div class="flex flex-wrap gap-1" role="tablist" aria-label="Filter submissions">
      <UButton
        v-for="f in filters"
        :key="f.value"
        role="tab"
        :aria-selected="filter === f.value"
        size="sm"
        :variant="filter === f.value ? 'soft' : 'ghost'"
        :color="filter === f.value ? 'primary' : 'neutral'"
        @click="filter = f.value"
      >
        {{ f.label }}
        <UBadge v-if="f.count" size="xs" variant="soft" :color="f.value === 'new' ? 'warning' : 'neutral'">{{ f.count }}</UBadge>
      </UButton>
    </div>

    <div v-if="!submissions.length" class="text-center py-16 text-gray-400">
      <UIcon name="i-lucide-inbox" class="w-10 h-10 mx-auto mb-2 opacity-50" />
      <p>{{ filter === 'inbox' ? 'No submissions yet' : 'Nothing here' }}</p>
    </div>

    <div v-else class="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
      <!-- List -->
      <div class="lg:col-span-2 space-y-2">
        <button
          v-for="sub in submissions"
          :key="sub.id"
          type="button"
          class="w-full text-left rounded-lg border bg-white dark:bg-gray-900 p-3 transition-colors hover:border-primary-300"
          :class="selectedId === sub.id ? 'border-primary-500 ring-1 ring-primary-500' : 'border-gray-200 dark:border-gray-800'"
          @click="open(sub)"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="text-sm truncate text-gray-900 dark:text-white" :class="sub.status === 'new' ? 'font-semibold' : 'font-medium'">
                {{ submissionPreview(columns, sub).title }}
              </p>
              <p class="text-xs text-gray-500 truncate mt-0.5">{{ submissionPreview(columns, sub).detail }}</p>
            </div>
            <div class="flex flex-col items-end gap-1 shrink-0">
              <UBadge :color="statusColor[sub.status]" variant="soft" size="xs">{{ statusLabel[sub.status] }}</UBadge>
              <span class="text-xs text-gray-400">{{ formatLocalDateTime(sub.createdAt) }}</span>
            </div>
          </div>
        </button>
        <UButton
          v-if="submissions.length < (data?.total ?? 0)"
          block
          variant="ghost"
          size="sm"
          :loading="loadingMore"
          @click="loadMore"
        >
          Load more ({{ submissions.length }} of {{ data?.total }})
        </UButton>
      </div>

      <!-- Detail -->
      <UCard v-if="selected" class="lg:col-span-3 lg:sticky lg:top-4">
        <div class="space-y-4">
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm text-gray-500">Received {{ formatLocalDateTime(selected.createdAt) }}</span>
            <UBadge :color="statusColor[selected.status]" variant="soft" size="sm">{{ statusLabel[selected.status] }}</UBadge>
          </div>
          <dl class="space-y-3">
            <div v-for="col in columns" :key="col.key">
              <dt class="text-xs font-medium text-gray-500">{{ col.label }}</dt>
              <dd class="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words">{{ displayValue(selected.data[col.key]) || '—' }}</dd>
            </div>
          </dl>
          <div class="flex flex-wrap gap-2 pt-3 border-t border-gray-100 dark:border-gray-800">
            <UButton v-if="selectedReply" size="xs" icon="i-lucide-reply" :href="`mailto:${selectedReply}`">Reply</UButton>
            <UButton v-if="selected.status === 'read'" size="xs" variant="outline" color="neutral" icon="i-lucide-mail" @click="setStatus(selected, 'new')">Mark unread</UButton>
            <UButton v-if="selected.status !== 'archived'" size="xs" variant="outline" color="neutral" icon="i-lucide-archive" @click="setStatus(selected, 'archived')">Archive</UButton>
            <UButton v-if="selected.status === 'archived' || selected.status === 'spam'" size="xs" variant="outline" color="neutral" icon="i-lucide-inbox" @click="setStatus(selected, 'read')">Move to inbox</UButton>
            <UButton v-if="selected.status !== 'spam'" size="xs" variant="outline" color="error" icon="i-lucide-shield-off" @click="setStatus(selected, 'spam')">Mark spam</UButton>
          </div>
        </div>
      </UCard>
      <div v-else class="hidden lg:flex lg:col-span-3 items-center justify-center text-gray-400 text-sm py-16">
        Select a submission to read it
      </div>
    </div>
  </div>
</template>
