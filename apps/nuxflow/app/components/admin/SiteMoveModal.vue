<script setup lang="ts">
// Moving a site to another pool (server/utils/site-move-job.ts). The server does one step
// per request; this dialog keeps asking until the move is done, showing where it's got
// to. Closing it pauses the move (the site stays locked) — Super Admin → Sites offers to
// continue it.

export interface SiteMoveRow {
  id: string
  movedSiteId: string
  siteName: string
  siteDomain: string
  fromPool: string | null
  toPool: string | null
  phase: string
  error: string | null
}

interface StepAnswer { move: SiteMoveRow; more: boolean; waitMs?: number; message: string }

const props = defineProps<{
  site: { id: string; name: string; domain: string; poolId: string | null } | null
  pools: string[]
  /** An unfinished move to continue, instead of starting one. */
  resume: SiteMoveRow | null
}>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ changed: [] }>()

const { run, isRunning } = useAdminAction()

const CONTROL_PANEL = '__control_panel__'
const destination = ref('')
const move = ref<SiteMoveRow | null>(null)
const message = ref('')
const running = ref(false)

const destinations = computed(() => {
  const from = props.site?.poolId ?? null
  return [
    ...(from ? [{ label: 'This control panel', value: CONTROL_PANEL }] : []),
    ...props.pools.filter(p => p !== from).map(p => ({ label: `Pool: ${p}`, value: p })),
  ]
})

const STEPS = [
  { phase: 'locking', label: 'Pause changes on the site' },
  { phase: 'copying', label: 'Copy everything to its new home' },
  { phase: 'checking', label: 'Check every table matches' },
  { phase: 'switching', label: 'Switch visitors to the new home' },
  { phase: 'cleaning', label: 'Remove the old copy' },
]
const stepIndex = computed(() => {
  if (!move.value) return -1
  if (move.value.phase === 'done') return STEPS.length
  return STEPS.findIndex(s => s.phase === move.value!.phase)
})
const cancellable = computed(() => !!move.value && ['locking', 'copying', 'checking', 'failed'].includes(move.value.phase))
const finished = computed(() => !!move.value && ['done', 'cancelled'].includes(move.value.phase))
const where = (pool: string | null) => pool ? `pool ${pool}` : 'the control panel'

watch(open, (isOpen) => {
  if (!isOpen) {
    running.value = false
    return
  }
  move.value = props.resume
  message.value = props.resume?.error ?? ''
  destination.value = destinations.value[0]?.value ?? ''
  if (props.resume && !props.resume.error) void drive()
}, { immediate: true })

onBeforeUnmount(() => { running.value = false })

async function start() {
  if (!props.site || !destination.value) return
  const started = await run(() => $fetch<{ move: SiteMoveRow }>('/api/v1/admin/site-moves', {
    method: 'POST',
    body: { siteId: props.site!.id, toPool: destination.value === CONTROL_PANEL ? null : destination.value },
  }), { errorTitle: "Couldn't start the move", key: 'start' })
  if (!started) return
  move.value = started.move
  emit('changed')
  void drive()
}

// Not useAdminAction(): progress and any error are shown in the dialog, step by step.
async function drive() {
  if (!move.value || running.value) return
  running.value = true
  message.value = ''
  try {
    while (running.value && move.value) {
      const url: string = `/api/v1/admin/site-moves/${move.value.id}/step`
      const result: StepAnswer = await $fetch<StepAnswer>(url, { method: 'POST' })
      move.value = result.move
      message.value = result.message
      if (!result.more) break
      if (result.waitMs) await new Promise(resolve => setTimeout(resolve, Math.min(result.waitMs!, 5000)))
    }
  }
  catch (e: unknown) {
    message.value = getErrorMessage(e, 'The move stopped')
  }
  finally {
    running.value = false
    emit('changed')
  }
}

async function cancelMove() {
  if (!move.value) return
  running.value = false
  const id = move.value.id
  const cancelled = await run(() => $fetch<{ move: SiteMoveRow }>(`/api/v1/admin/site-moves/${id}/cancel`, { method: 'POST' }), {
    successTitle: 'Move cancelled — the site is back as it was',
    errorTitle: "Couldn't cancel the move",
    key: 'cancel',
  })
  if (cancelled) {
    move.value = cancelled.move
    emit('changed')
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="`Move ${move?.siteName ?? site?.name ?? 'site'}`" :dismissible="!running">
    <template #body>
      <div v-if="!move" class="space-y-4">
        <p class="text-sm text-gray-600 dark:text-gray-300">
          Copies <strong>{{ site?.domain }}</strong> from {{ where(site?.poolId ?? null) }} to another home, with everything
          on it, then switches visitors over. It usually takes a few minutes.
        </p>
        <ul class="text-sm text-gray-500 list-disc pl-5 space-y-1">
          <li>While it moves, visitors see the "down for maintenance" page and the site's team can look but not save.</li>
          <li>Keep this window open until it's done. If you close it, the move pauses and you can continue it from this page.</li>
          <li>If the site uses the shared email address (name+box@…), that address changes; the site's Inbox → Addresses page shows the new one.</li>
          <li>People signed in to the site will need to sign in again.</li>
        </ul>
        <UFormField label="Move to">
          <USelect v-model="destination" :items="destinations" class="w-full" />
        </UFormField>
      </div>

      <div v-else class="space-y-4">
        <p class="text-sm text-gray-500">
          {{ move.siteDomain }}: from {{ where(move.fromPool) }} to {{ where(move.toPool) }}
        </p>
        <ol class="space-y-2">
          <li v-for="(step, i) in STEPS" :key="step.phase" class="flex items-center gap-2 text-sm">
            <UIcon
              :name="i < stepIndex ? 'i-lucide-circle-check' : i === stepIndex && move.phase !== 'failed' ? 'i-lucide-loader-circle' : 'i-lucide-circle'"
              :class="[i < stepIndex ? 'text-green-500' : 'text-gray-400', i === stepIndex && running ? 'animate-spin' : '']"
            />
            <span :class="i <= stepIndex ? 'text-gray-900 dark:text-white' : 'text-gray-400'">{{ step.label }}</span>
          </li>
        </ol>
        <UAlert v-if="move.phase === 'done'" color="success" variant="soft" icon="i-lucide-circle-check" :description="`Moved. ${move.siteDomain} now lives in ${where(move.toPool)}.`" />
        <UAlert v-else-if="move.phase === 'cancelled'" color="neutral" variant="soft" description="Cancelled. The site stayed where it was and is unlocked." />
        <UAlert v-else-if="move.error" color="error" variant="soft" icon="i-lucide-triangle-alert" :description="move.error" />
        <p v-else-if="message" class="text-sm text-gray-500">{{ message }}</p>
      </div>
    </template>
    <template #footer>
      <template v-if="!move">
        <UButton variant="ghost" @click="open = false">Cancel</UButton>
        <UButton :loading="isRunning('start')" :disabled="!destination" icon="i-lucide-arrow-right-left" @click="start">Move site</UButton>
      </template>
      <template v-else>
        <UButton v-if="cancellable && !running" color="error" variant="ghost" :loading="isRunning('cancel')" @click="cancelMove">Cancel move</UButton>
        <UButton v-if="!finished && !running && move.phase !== 'failed'" icon="i-lucide-rotate-cw" @click="drive">{{ move.error ? 'Try again' : 'Continue' }}</UButton>
        <UButton v-if="finished || !running" variant="ghost" @click="open = false">Close</UButton>
      </template>
    </template>
  </UModal>
</template>
