<script setup lang="ts">
const toast = useToast()

type StatusCode = 301 | 302 | 307 | 308 | 410

interface Redirect {
  id: string
  from: string
  to: string
  statusCode: StatusCode
  createdAt: string
}

const { data: redirectData, refresh: refreshRedirects } = await useFetch<{ redirects: Redirect[] }>('/api/v1/redirects')
const search = ref('')
const redirects = computed(() => {
  const all = redirectData.value?.redirects ?? []
  const q = search.value.trim().toLowerCase()
  return q ? all.filter(r => r.from.toLowerCase().includes(q) || r.to.toLowerCase().includes(q)) : all
})

const statusOptions: { label: string; value: StatusCode }[] = [
  { label: '301 — Moved permanently', value: 301 },
  { label: '308 — Permanent (keeps method)', value: 308 },
  { label: '302 — Temporary', value: 302 },
  { label: '307 — Temporary (keeps method)', value: 307 },
  { label: '410 — Gone (removed for good)', value: 410 },
]

const STATUS_BADGE: Record<StatusCode, { label: string; color: 'info' | 'warning' | 'error' }> = {
  301: { label: 'Permanent', color: 'info' },
  308: { label: 'Permanent', color: 'info' },
  302: { label: 'Temporary', color: 'warning' },
  307: { label: 'Temporary', color: 'warning' },
  410: { label: 'Gone', color: 'error' },
}

// ── Add / edit ───────────────────────────────────────────────────────────────
const editing = ref<string | null>(null)
const form = reactive({ from: '', to: '', statusCode: 301 as StatusCode })
const formError = ref('')
const saving = ref(false)

function resetForm() {
  editing.value = null
  form.from = ''
  form.to = ''
  form.statusCode = 301
  formError.value = ''
}

function startEdit(r: Redirect) {
  editing.value = r.id
  form.from = r.from
  form.to = r.to
  form.statusCode = r.statusCode
  formError.value = ''
}

async function submit() {
  formError.value = ''
  if (!form.from.startsWith('/')) {
    formError.value = '"From" path must start with /'
    return
  }
  if (form.statusCode !== 410 && !form.to) {
    formError.value = '"To" is required (or choose 410 Gone)'
    return
  }
  saving.value = true
  try {
    const body = { from: form.from, to: form.statusCode === 410 ? '' : form.to, statusCode: form.statusCode }
    if (editing.value) {
      const url: string = `/api/v1/redirects/${editing.value}`
      await $fetch(url, { method: 'PATCH', body })
      toast.add({ title: 'Redirect updated', color: 'success' })
    } else {
      await $fetch('/api/v1/redirects', { method: 'POST', body })
      toast.add({ title: 'Redirect added', color: 'success' })
    }
    resetForm()
    await refreshRedirects()
  } catch (e: unknown) {
    formError.value = getErrorMessage(e, 'Failed to save redirect')
  } finally {
    saving.value = false
  }
}

const deletingId = ref<string | null>(null)

async function deleteRedirect(id: string) {
  deletingId.value = id
  try {
    const url: string = `/api/v1/redirects/${id}`
    await $fetch(url, { method: 'DELETE' })
    if (editing.value === id) resetForm()
    await refreshRedirects()
    toast.add({ title: 'Redirect deleted', color: 'success' })
  } catch {
    toast.add({ title: 'Failed to delete redirect', color: 'error' })
  } finally {
    deletingId.value = null
  }
}

// ── Import ───────────────────────────────────────────────────────────────────
const showImport = ref(false)
const importText = ref('')
const importOverwrite = ref(false)
const importing = ref(false)
const importResult = ref<{ created: number; updated: number; skipped: number; errors: { line: number; message: string }[] } | null>(null)

async function onImportFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) importText.value = await file.text()
}

async function runImport() {
  importing.value = true
  importResult.value = null
  try {
    const result = await $fetch('/api/v1/redirects/import', {
      method: 'POST',
      body: { csv: importText.value, overwrite: importOverwrite.value },
    })
    importResult.value = result
    await refreshRedirects()
    toast.add({ title: `Imported ${result.created} new, ${result.updated} updated`, color: 'success' })
  } catch (e: unknown) {
    toast.add({ title: getErrorMessage(e, 'Import failed'), color: 'error' })
  } finally {
    importing.value = false
  }
}

const columns = [
  { accessorKey: 'from', header: 'From' },
  { accessorKey: 'to', header: 'To' },
  { accessorKey: 'statusCode', header: 'Type' },
  { id: 'actions', header: '' },
]
</script>

<template>
  <div class="space-y-4">
    <!-- Add / edit form -->
    <UCard>
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-sm font-semibold text-gray-900 dark:text-white">{{ editing ? 'Edit redirect' : 'Add redirect' }}</p>
            <p class="text-xs text-gray-400 mt-0.5">Matched case-insensitively, ignoring trailing slashes and query strings (which are passed on). Renaming a published page's slug adds its redirect automatically.</p>
          </div>
          <UButton size="sm" variant="outline" icon="i-lucide-upload" @click="showImport = true">Import CSV</UButton>
        </div>
      </template>
      <div class="space-y-3">
        <div class="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <UFormField label="From path" class="md:col-span-2">
            <UInput v-model="form.from" placeholder="/old-page" class="w-full font-mono text-sm" />
          </UFormField>
          <UFormField label="To" class="md:col-span-2">
            <UInput
              v-model="form.to"
              :disabled="form.statusCode === 410"
              :placeholder="form.statusCode === 410 ? 'No destination — page is gone' : '/new-page or https://example.com'"
              class="w-full font-mono text-sm"
            />
          </UFormField>
          <UFormField label="Type">
            <USelect v-model="form.statusCode" :items="statusOptions" class="w-full" />
          </UFormField>
        </div>
        <UAlert v-if="formError" color="error" variant="soft" :description="formError" />
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton v-if="editing" variant="ghost" color="neutral" @click="resetForm">Cancel</UButton>
          <UButton :loading="saving" :icon="editing ? 'i-lucide-check' : 'i-lucide-plus'" @click="submit">
            {{ editing ? 'Save redirect' : 'Add redirect' }}
          </UButton>
        </div>
      </template>
    </UCard>

    <!-- Redirect list -->
    <UCard>
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-sm font-semibold text-gray-900 dark:text-white">Active redirects</p>
            <p class="text-xs text-gray-400 mt-0.5">{{ redirectData?.redirects.length ?? 0 }} redirect{{ redirectData?.redirects.length === 1 ? '' : 's' }}</p>
          </div>
          <UInput v-model="search" icon="i-lucide-search" placeholder="Filter…" size="sm" class="w-48" />
        </div>
      </template>

      <div v-if="!redirects.length" class="text-center py-10 text-gray-400">
        <UIcon name="i-lucide-arrow-right-left" class="w-8 h-8 mx-auto mb-2 opacity-40" />
        <p class="text-sm">{{ search ? 'No matching redirects' : 'No redirects yet' }}</p>
      </div>

      <UTable
        v-else
        :data="redirects"
        :columns="columns"
      >
        <template #from-cell="{ row }">
          <code class="text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">{{ row.original.from }}</code>
        </template>
        <template #to-cell="{ row }">
          <code v-if="row.original.to" class="text-xs text-primary-600 dark:text-primary-400">{{ row.original.to }}</code>
          <span v-else class="text-xs text-gray-400">—</span>
        </template>
        <template #statusCode-cell="{ row }">
          <UBadge
            :color="STATUS_BADGE[row.original.statusCode as StatusCode]?.color ?? 'neutral'"
            variant="soft"
            size="sm"
          >
            {{ row.original.statusCode }} {{ STATUS_BADGE[row.original.statusCode as StatusCode]?.label }}
          </UBadge>
        </template>
        <template #actions-cell="{ row }">
          <div class="flex justify-end gap-1">
            <UButton
              variant="ghost"
              size="xs"
              icon="i-lucide-pencil"
              aria-label="Edit redirect"
              @click="startEdit(row.original)"
            />
            <UButton
              variant="ghost"
              color="error"
              size="xs"
              icon="i-lucide-trash-2"
              aria-label="Delete redirect"
              :loading="deletingId === row.original.id"
              @click="deleteRedirect(row.original.id)"
            />
          </div>
        </template>
      </UTable>
    </UCard>

    <UModal v-model:open="showImport" title="Import redirects">
      <template #body>
        <div class="space-y-3">
          <p class="text-xs text-gray-500">One redirect per line: <code>from,to[,status]</code>. Status defaults to 301 (410 when there's no destination). A header row and <code>#</code> comments are ignored; tab-separated works too.</p>
          <input type="file" accept=".csv,.tsv,.txt,text/csv" class="text-xs" @change="onImportFile">
          <UTextarea v-model="importText" :rows="8" class="w-full font-mono text-xs" placeholder="/old-page,/new-page&#10;/blog/2019/post,/post,301&#10;/discontinued,,410" />
          <UCheckbox v-model="importOverwrite" label="Replace existing redirects with the same source path" />
          <div v-if="importResult" class="text-xs space-y-1">
            <p class="text-gray-600 dark:text-gray-300">{{ importResult.created }} created · {{ importResult.updated }} updated · {{ importResult.skipped }} unchanged</p>
            <ul v-if="importResult.errors.length" class="text-red-500 max-h-32 overflow-y-auto">
              <li v-for="err in importResult.errors" :key="err.line">Line {{ err.line }}: {{ err.message }}</li>
            </ul>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton variant="ghost" color="neutral" @click="showImport = false">Close</UButton>
          <UButton :loading="importing" :disabled="!importText.trim()" icon="i-lucide-upload" @click="runImport">Import</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
