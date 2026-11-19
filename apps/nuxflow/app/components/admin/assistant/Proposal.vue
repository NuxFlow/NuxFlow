<script setup lang="ts">
import { ASSISTANT_SETTINGS, accentReadabilityWarning, assistantSettingsPatch, describeAssistantValue, type AssistantProposal } from '#shared/lib/assistant'

// One suggestion from the admin AI helper. Nothing here happens without a click: a setting
// is previewed (look-and-feel ones) and applied with the normal settings save, recorded
// as AI-assisted, with Undo to put the old value back; a page change opens the Canvas
// editor's "Change this page", which has its own preview; a link just opens a screen.

const props = defineProps<{ proposal: AssistantProposal; question: string }>()
const emit = defineEmits<{ navigate: [] }>()

const { run, isRunning } = useAdminAction()
const applied = ref(false)
const showPreview = ref(false)

const isAppearance = computed(() => props.proposal.type === 'setting' && 'appearance' in ASSISTANT_SETTINGS[props.proposal.key])
const isColor = computed(() => props.proposal.type === 'setting' && ASSISTANT_SETTINGS[props.proposal.key].kind === 'color')
const readability = computed(() => (props.proposal.type === 'setting' && props.proposal.key === 'theme.primary_color' ? accentReadabilityWarning(props.proposal.value) : null))

async function apply() {
  const p = props.proposal
  if (p.type !== 'setting') return
  const ok = await run(() => $fetch<unknown>('/api/v1/settings', {
    method: 'PATCH',
    body: {
      ...assistantSettingsPatch({ [p.key]: p.value }),
      aiAssist: { kind: 'assistant', instruction: props.question, summary: `${p.label}: ${describeAssistantValue(p.key, p.current)} → ${describeAssistantValue(p.key, p.value)}` },
    },
  }).then(() => true), { successTitle: `${p.label} changed`, errorTitle: `Couldn't change ${p.label.toLowerCase()}`, key: 'apply' })
  if (ok) applied.value = true
}

async function undo() {
  const p = props.proposal
  if (p.type !== 'setting') return
  // A plain save of the old value: undoing is the person's own change, not an AI one.
  const ok = await run(() => $fetch<unknown>('/api/v1/settings', { method: 'PATCH', body: assistantSettingsPatch({ [p.key]: p.current }) }).then(() => true), {
    successTitle: `${p.label} put back`,
    errorTitle: `Couldn't put ${p.label.toLowerCase()} back`,
    key: 'undo',
  })
  if (ok) applied.value = false
}

async function openPage() {
  const p = props.proposal
  if (p.type !== 'page') return
  emit('navigate')
  await navigateTo({ path: `/admin/content/${p.contentId}`, query: { ai: p.instruction } })
}

async function openLink() {
  if (props.proposal.type !== 'link') return
  emit('navigate')
  await navigateTo(props.proposal.to)
}
</script>

<template>
  <div class="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 space-y-2 text-sm" data-testid="assistant-proposal">
    <!-- A setting -->
    <template v-if="proposal.type === 'setting'">
      <p class="font-medium text-gray-900 dark:text-white flex items-center gap-1.5">
        <UIcon name="i-lucide-sliders-horizontal" class="w-4 h-4 text-primary-500 shrink-0" />
        {{ proposal.label }}
      </p>
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <span class="inline-flex items-center gap-1.5 text-gray-500 dark:text-gray-400 line-through decoration-gray-400/60">
          <span v-if="isColor && proposal.current" class="w-3.5 h-3.5 rounded border border-black/10" :style="{ background: String(proposal.current) }" />
          {{ describeAssistantValue(proposal.key, proposal.current) }}
        </span>
        <UIcon name="i-lucide-arrow-right" class="w-3.5 h-3.5 text-gray-400" />
        <span class="inline-flex items-center gap-1.5 font-medium text-gray-900 dark:text-white">
          <span v-if="isColor" class="w-3.5 h-3.5 rounded border border-black/10" :style="{ background: String(proposal.value) }" />
          {{ describeAssistantValue(proposal.key, proposal.value) }}
        </span>
      </div>
      <p v-if="proposal.note" class="text-xs text-gray-600 dark:text-gray-400">{{ proposal.note }}</p>
      <p v-if="readability" class="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1.5" data-testid="assistant-readability">
        <UIcon name="i-lucide-triangle-alert" class="w-3.5 h-3.5 mt-0.5 shrink-0" />
        {{ readability }}
      </p>
      <div class="flex flex-wrap items-center gap-2 pt-1">
        <template v-if="!applied">
          <UButton v-if="isAppearance" size="xs" variant="outline" color="neutral" icon="i-lucide-eye" @click="showPreview = true">Preview</UButton>
          <UButton size="xs" icon="i-lucide-check" :loading="isRunning('apply')" data-testid="assistant-apply" @click="apply">Apply</UButton>
        </template>
        <template v-else>
          <UBadge color="success" variant="soft" size="sm" icon="i-lucide-check">Applied</UBadge>
          <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-undo-2" :loading="isRunning('undo')" data-testid="assistant-undo" @click="undo">Undo</UButton>
        </template>
      </div>
      <AdminAssistantPreview v-if="showPreview" v-model:open="showPreview" :changes="{ [proposal.key]: proposal.value }" />
    </template>

    <!-- A page change -->
    <template v-else-if="proposal.type === 'page'">
      <p class="font-medium text-gray-900 dark:text-white flex items-center gap-1.5">
        <UIcon name="i-lucide-file-pen-line" class="w-4 h-4 text-primary-500 shrink-0" />
        Change "{{ proposal.title }}"
      </p>
      <p class="text-xs text-gray-600 dark:text-gray-400">“{{ proposal.instruction }}”</p>
      <p class="text-xs text-gray-500 dark:text-gray-400">Opens the page with the change shown as a preview. Nothing is saved until you keep it.</p>
      <UButton size="xs" icon="i-lucide-arrow-right" trailing @click="openPage">Open in the editor</UButton>
    </template>

    <!-- A screen -->
    <template v-else>
      <p v-if="proposal.note" class="text-xs text-gray-600 dark:text-gray-400">{{ proposal.note }}</p>
      <UButton size="xs" variant="soft" icon="i-lucide-external-link" @click="openLink">{{ proposal.label }}</UButton>
    </template>
  </div>
</template>
