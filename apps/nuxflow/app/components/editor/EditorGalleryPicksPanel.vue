<script setup lang="ts">
import type { PickerSummary } from '#shared/lib/editor-types'
// Client proofing: everyone's favourites from this page's galleries ("Let clients pick
// favourites" — server/utils/gallery-picks.ts), with their photos' file names to copy into
// Lightroom or Capture One. Read from /_nuxflow/gallery-picks (not /api; see that route).

const props = defineProps<{ itemId: string }>()
const { run, isRunning } = useAdminAction()
const { confirm } = useConfirm()
const toast = useToast()

const url: string = `/_nuxflow/gallery-picks?item=${encodeURIComponent(props.itemId)}`
const { data, refresh, pending } = useFetch<{ pickers: PickerSummary[] }>(url, { server: false })
const pickers = computed(() => data.value?.pickers ?? [])
const open = ref<string | null>(null)

/** "DSC_0012, DSC_0031" — names without extensions, which Lightroom's text filter matches. */
function namesFor(p: PickerSummary): string {
  return p.photos.map(ph => ph.fileName.replace(/\.[^.]+$/, '')).join(', ')
}

async function copyNames(p: PickerSummary) {
  try {
    await navigator.clipboard.writeText(namesFor(p))
    toast.add({ title: `Copied ${p.photos.length} file names`, color: 'success' })
  }
  catch {
    // Not useAdminAction(): a clipboard refusal isn't a request that failed.
    toast.add({ title: 'Couldn\'t copy. Select the names below instead.', color: 'error' })
    open.value = p.id
  }
}

function downloadCsv(p: PickerSummary) {
  // Not useAdminAction(): a file made in the browser, no request.
  const rows = [['File name', 'Photo link'], ...p.photos.map(ph => [ph.fileName, ph.url])]
  const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = `picks-${p.name.replace(/[^\w-]+/g, '-')}.csv`
  a.click()
}

async function remove(p: PickerSummary) {
  if (!await confirm({ title: `Remove ${p.name}'s picks?`, description: 'They can pick again from the gallery.', confirmLabel: 'Remove', color: 'error' })) return
  const ok = await run(() => $fetch<{ success: boolean }>('/_nuxflow/gallery-picks', {
    method: 'POST',
    body: { action: 'remove', item: props.itemId, id: p.id },
  }), { successTitle: 'Picks removed', errorTitle: 'Couldn\'t remove the picks', key: `remove:${p.id}` })
  if (ok) await refresh()
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between">
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide">Client picks</p>
      <UButton size="xs" variant="ghost" icon="i-lucide-refresh-cw" :loading="pending" aria-label="Refresh client picks" @click="refresh()" />
    </div>
    <p v-if="!pickers.length" class="text-xs text-gray-500">No picks yet. When a client hearts photos in this page's gallery, they appear here.</p>
    <div v-for="p in pickers" :key="p.id" class="rounded-lg border border-gray-200 dark:border-gray-800 p-2 space-y-2">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-900 dark:text-white truncate">{{ p.name }}</p>
          <p class="text-xs text-gray-500">
            {{ p.photos.length }} {{ p.photos.length === 1 ? 'photo' : 'photos' }} ·
            {{ p.submittedAt ? `sent ${formatLocalDateTime(p.submittedAt)}` : 'not sent yet' }}
          </p>
        </div>
        <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" :loading="isRunning(`remove:${p.id}`)" :aria-label="`Remove ${p.name}'s picks`" @click="remove(p)" />
      </div>
      <p v-if="p.note" class="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap">"{{ p.note }}"</p>
      <div class="flex flex-wrap gap-1">
        <UButton size="xs" variant="outline" icon="i-lucide-copy" :disabled="!p.photos.length" @click="copyNames(p)">Copy file names</UButton>
        <UButton size="xs" variant="ghost" icon="i-lucide-download" :disabled="!p.photos.length" @click="downloadCsv(p)">CSV</UButton>
        <UButton size="xs" variant="ghost" :icon="open === p.id ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" @click="open = open === p.id ? null : p.id">
          {{ open === p.id ? 'Hide' : 'Show' }}
        </UButton>
      </div>
      <textarea
        v-if="open === p.id"
        readonly
        :value="namesFor(p)"
        rows="4"
        class="w-full rounded-md border border-gray-200 dark:border-gray-700 bg-transparent p-2 text-xs"
        :aria-label="`${p.name}'s picks as file names`"
      />
    </div>
  </div>
</template>
