<script setup lang="ts">
// Switching the site to a starter site (server/utils/starters/install.ts). A built-in starter
// is applied by one request; a catalog one is installed a step per request — this dialog
// keeps asking until it's done, showing how many images have been copied. Closing it pauses
// the install; the Starter sites page (and the dashboard) offer to continue it.
import type { StarterApplyResult, StarterInstallAnswer, StarterInstallView, StarterSummary } from '#shared/lib/starters'

const props = defineProps<{
  /** The starter to switch to, when starting a new install. */
  starter: StarterSummary | null
  /** An unfinished install to continue instead. */
  resume: StarterInstallView | null
}>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ changed: [] }>()

const { run, isRunning } = useAdminAction()
const toast = useToast()

const install = ref<StarterInstallView | null>(null)
const result = ref<StarterApplyResult | null>(null)
const message = ref('')
const running = ref(false)
const understood = ref(false)
const downloading = ref(false)

const name = computed(() => install.value?.starterName ?? props.starter?.name ?? 'starter site')
const done = computed(() => !!result.value || install.value?.status === 'done')
const fresh = computed(() => install.value?.mode === 'fresh')
const progress = computed(() => {
  const i = install.value
  if (!i) return 0
  if (i.status === 'done') return 100
  const steps = i.imagesTotal + 2
  const at = i.phase === 'resolve' ? 0 : i.phase === 'images' ? 1 + i.imagesDone : steps - 1
  return Math.round((at / steps) * 100)
})
const stage = computed(() => {
  const i = install.value
  if (!i) return ''
  if (i.phase === 'resolve') return 'Checking the starter site…'
  if (i.phase === 'images') return `Copying images to your storage — ${i.imagesDone} of ${i.imagesTotal}`
  if (i.phase === 'apply') return 'Adding pages, menus and the theme…'
  return 'Done'
})

watch(open, (isOpen) => {
  if (!isOpen) {
    running.value = false
    return
  }
  install.value = props.resume
  result.value = null
  understood.value = false
  message.value = props.resume?.error ?? ''
  if (props.resume && !props.resume.error) void drive()
}, { immediate: true })

onBeforeUnmount(() => { running.value = false })

async function start() {
  if (!props.starter) return
  const id = props.starter.id
  const started = await run(() => $fetch<StarterInstallAnswer>('/api/v1/starters', { method: 'POST', body: { action: 'install', starterId: id } }), {
    errorTitle: "Couldn't switch to this starter site",
    key: 'start',
  })
  if (!started) return
  emit('changed')
  if (started.result) {
    result.value = started.result
    return
  }
  install.value = started.install
  void drive()
}

// Not useAdminAction(): progress and any error are shown in the dialog, step by step.
async function drive() {
  if (!install.value || running.value) return
  running.value = true
  message.value = ''
  try {
    while (running.value && install.value && ['pending', 'running'].includes(install.value.status)) {
      const answer: StarterInstallAnswer = await $fetch<StarterInstallAnswer>('/api/v1/starters', { method: 'POST', body: { action: 'step', installId: install.value.id } })
      if (answer.install) install.value = answer.install
      if (answer.result) result.value = answer.result
      // Another tab holds this step — wait for it rather than doing the work twice.
      if (answer.busy) await new Promise(resolve => setTimeout(resolve, 3000))
    }
  }
  catch (e: unknown) {
    message.value = getErrorMessage(e, 'Installing stopped')
  }
  finally {
    running.value = false
    emit('changed')
  }
}

async function cancelInstall() {
  if (!install.value) return
  running.value = false
  const id = install.value.id
  const cancelled = await run(() => $fetch<StarterInstallAnswer>('/api/v1/starters', { method: 'POST', body: { action: 'cancel', installId: id } }), {
    successTitle: 'Install cancelled',
    errorTitle: "Couldn't cancel the install",
    key: 'cancel',
  })
  if (cancelled) {
    install.value = cancelled.install
    emit('changed')
    open.value = false
  }
}

// Not useAdminAction(): a raw fetch() download, as on Import & backup.
async function downloadBackup() {
  downloading.value = true
  try {
    const res = await fetch('/api/v1/backup')
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { message?: string } | null
      throw new Error(body?.message || 'The backup could not be created.')
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `nuxflow-backup-${new Date().toISOString().slice(0, 10)}.zip`
    a.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    toast.add({ title: "Couldn't download a backup", description: getErrorMessage(err, 'Try again from Import & backup.'), color: 'error' })
  } finally {
    downloading.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="done ? `${name} is installed` : fresh ? `Installing ${name}` : install ? `Switching to ${name}` : `Switch to ${name}?`" :dismissible="!running">
    <template #body>
      <!-- Finished -->
      <div v-if="done" class="space-y-3 text-sm text-gray-600 dark:text-gray-300" data-testid="starter-done">
        <p class="flex items-center gap-2 text-gray-900 dark:text-white">
          <UIcon name="i-lucide-circle-check" class="h-5 w-5 text-green-500" />
          Your site now uses the {{ name }} starter site.
        </p>
        <ul class="list-disc space-y-1 pl-5">
          <li v-if="result?.content.created || result?.content.updated">
            {{ (result?.content.created ?? 0) + (result?.content.updated ?? 0) }} pages and posts added.
          </li>
          <li v-if="result?.draftedItems">
            {{ result.draftedItems }} of your earlier pages and posts are kept as drafts in Content.
          </li>
          <li v-if="result?.settingsKept.length">
            Your own logo, favicon, SEO text or custom code were kept.
          </li>
          <li v-if="result?.planLimits?.length">
            Some content didn't fit your plan's limits and was skipped.
          </li>
        </ul>
      </div>

      <!-- Installing (or paused with an error) -->
      <div v-else-if="install" class="space-y-4">
        <p class="text-sm text-gray-600 dark:text-gray-300">{{ stage }}</p>
        <UProgress :model-value="progress" />
        <UAlert v-if="message" color="warning" variant="soft" icon="i-lucide-triangle-alert" :description="message" />
        <p v-if="!message && running" class="text-xs text-gray-500 dark:text-gray-400">
          Keep this window open. If you close it, you can continue from Starter sites later.
        </p>
      </div>

      <!-- Confirm -->
      <div v-else class="space-y-4 text-sm text-gray-600 dark:text-gray-300">
        <p>This changes your whole site's content and look:</p>
        <ul class="list-disc space-y-1 pl-5">
          <li><strong>Nothing is deleted.</strong> Your current pages and posts become drafts, so you can bring any of them back. Ones at the same address as a new page are renamed "(Backup — date)".</li>
          <li>The starter's pages, menus and forms are added and published.</li>
          <li v-if="starter?.source === 'catalog'">Its theme, colours and fonts become active.</li>
          <li v-if="starter?.imageCount">Its {{ starter.imageCount }} images are copied into your media library.</li>
          <li>Your logo, favicon, SEO title and any custom code you added stay as they are.</li>
          <li>Events, members, forms' past entries, users and settings like email and payments aren't touched.</li>
        </ul>
        <div class="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
          <UIcon name="i-lucide-hard-drive-download" class="h-4 w-4 text-gray-400" />
          <span class="flex-1">Want a copy of everything first?</span>
          <UButton size="sm" variant="outline" :loading="downloading" @click="downloadBackup">Download a backup</UButton>
        </div>
        <UCheckbox v-model="understood" label="I understand my current pages and posts will become drafts" />
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <template v-if="done">
          <UButton variant="outline" to="/" target="_blank">View site</UButton>
          <UButton @click="open = false">Close</UButton>
        </template>
        <template v-else-if="install">
          <UButton
            v-if="install.status !== 'done'"
            color="neutral"
            variant="ghost"
            :loading="isRunning('cancel')"
            @click="cancelInstall"
          >
            Cancel install
          </UButton>
          <UButton v-if="!running && install.status !== 'failed'" @click="drive">{{ message ? 'Try again' : 'Continue' }}</UButton>
          <UButton v-if="running" loading disabled>{{ fresh ? 'Installing' : 'Switching' }}</UButton>
        </template>
        <template v-else>
          <UButton color="neutral" variant="ghost" @click="open = false">Not now</UButton>
          <UButton :disabled="!understood" :loading="isRunning('start')" data-testid="starter-confirm" @click="start">
            Switch to {{ name }}
          </UButton>
        </template>
      </div>
    </template>
  </UModal>
</template>
