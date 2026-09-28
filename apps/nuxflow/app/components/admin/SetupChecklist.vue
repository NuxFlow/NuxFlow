<script setup lang="ts">
// "Finish setting up your site" — live checks of the settings every installation should
// have (server/utils/setup-checklist.ts). Mirrors docs/installation.md's
// After-installation checklist, which each item links to for step-by-step help.
// Admins only (the checks read admin-level settings).

interface ChecklistItem {
  id: string
  tier: 'essential' | 'recommended'
  status: 'done' | 'todo' | 'problem'
  title: string
  detail: string
  fixUrl?: string
  fixLabel?: string
  docsAnchor?: string
  skipped: boolean
}

interface ChecklistResponse {
  items: ChecklistItem[]
  summary: { essentialOpen: number; recommendedOpen: number; problems: number; total: number; done: number }
  hidden: boolean
}

const DOCS_URL = 'https://github.com/NuxFlow/NuxFlow/blob/main/docs/installation.md'

const access = await fetchAdminAccess()
const isAdmin = roleAtLeast(access?.role, 'admin') || Boolean(access?.isSuperAdmin)

const { data, refresh } = await useFetch<ChecklistResponse>('/api/v1/site-checklist', {
  immediate: isAdmin,
  headers: useRequestHeaders(['cookie', 'host']),
})

const toast = useToast()
const busy = ref(false)
const showDone = ref(false)
const showSkipped = ref(false)

const items = computed(() => data.value?.items ?? [])
const summary = computed(() => data.value?.summary)
const allEssentialDone = computed(() => (summary.value?.essentialOpen ?? 1) === 0 && (summary.value?.problems ?? 1) === 0)
// Once the essentials are done the card starts collapsed, so it stops dominating the dashboard.
const expanded = ref(!allEssentialDone.value)
watch(allEssentialDone, (v) => { if (!v) expanded.value = true })

const essential = computed(() => items.value.filter(i => i.tier === 'essential'))
const recommended = computed(() => items.value.filter(i => i.tier === 'recommended' && !i.skipped))
const skipped = computed(() => items.value.filter(i => i.skipped))
const progress = computed(() => (summary.value ? Math.round((summary.value.done / summary.value.total) * 100) : 0))

function openFirst<T extends ChecklistItem>(list: T[]) {
  // Problems first, then to-dos, then done (collapsed behind a toggle).
  const order = { problem: 0, todo: 1, done: 2 }
  return [...list].sort((a, b) => order[a.status] - order[b.status])
}

const STATUS_ICON: Record<ChecklistItem['status'], { icon: string; cls: string; label: string }> = {
  done: { icon: 'i-lucide-circle-check', cls: 'text-green-500', label: 'Done' },
  todo: { icon: 'i-lucide-circle', cls: 'text-amber-500', label: 'To do' },
  problem: { icon: 'i-lucide-circle-x', cls: 'text-red-500', label: 'Needs fixing' },
}

async function update(body: { skip?: string; unskip?: string; hidden?: boolean }) {
  busy.value = true
  try {
    await $fetch<unknown>('/api/v1/site-checklist', { method: 'PATCH', body })
    await refresh()
  } catch (e: unknown) {
    toast.add({ title: getErrorMessage(e, 'Could not update the checklist'), color: 'error' })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="isAdmin && data">
    <!-- Hidden: a single quiet link to bring it back -->
    <div v-if="data.hidden" class="text-right">
      <UButton size="xs" variant="link" color="neutral" icon="i-lucide-list-checks" :loading="busy" @click="update({ hidden: false })">
        Show setup checklist
      </UButton>
    </div>

    <div v-else class="glass rounded-2xl overflow-hidden">
      <!-- Header -->
      <button
        type="button"
        class="w-full flex items-center gap-3 p-4 text-left"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        <div
          class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          :class="allEssentialDone ? 'bg-green-500/10' : summary!.problems ? 'bg-red-500/10' : 'bg-amber-500/10'"
        >
          <UIcon
            :name="allEssentialDone ? 'i-lucide-rocket' : 'i-lucide-list-checks'"
            class="w-5 h-5"
            :class="allEssentialDone ? 'text-green-500' : summary!.problems ? 'text-red-500' : 'text-amber-500'"
          />
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold text-gray-900 dark:text-white">
            <template v-if="allEssentialDone">Your site is set up</template>
            <template v-else>Finish setting up your site</template>
          </p>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            <template v-if="summary!.problems">{{ summary!.problems }} thing{{ summary!.problems === 1 ? ' needs' : 's need' }} fixing · </template>
            <template v-if="summary!.essentialOpen">{{ summary!.essentialOpen }} essential step{{ summary!.essentialOpen === 1 ? '' : 's' }} left · </template>
            <template v-else-if="summary!.recommendedOpen">{{ summary!.recommendedOpen }} recommended step{{ summary!.recommendedOpen === 1 ? '' : 's' }} left · </template>
            {{ summary!.done }} of {{ summary!.total }} done
          </p>
          <div class="mt-2 h-1.5 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden" role="progressbar" :aria-valuenow="progress" aria-valuemin="0" aria-valuemax="100">
            <div class="h-full rounded-full transition-all" :class="allEssentialDone ? 'bg-green-500' : 'bg-primary-500'" :style="{ width: `${progress}%` }" />
          </div>
        </div>
        <UIcon :name="expanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="w-4 h-4 text-gray-400 shrink-0" />
      </button>

      <div v-if="expanded" class="border-t border-gray-100 dark:border-gray-800 px-4 pb-4">
        <p v-if="!allEssentialDone" class="text-xs text-gray-500 dark:text-gray-400 pt-3">
          Your site works without these, but it won't work <em>well</em>. They're checked live, so each one ticks itself off once it's done.
        </p>

        <template v-for="group in [{ key: 'essential', label: 'Do not skip', list: essential }, { key: 'recommended', label: 'Recommended', list: recommended }]" :key="group.key">
          <h3 v-if="group.list.length" class="mt-4 mb-1 text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
            {{ group.label }}
          </h3>
          <ul class="divide-y divide-gray-100 dark:divide-gray-800">
            <template v-for="item in openFirst(group.list)" :key="item.id">
              <li v-if="item.status !== 'done' || showDone" class="py-3 flex items-start gap-3">
                <UIcon
                  :name="STATUS_ICON[item.status].icon"
                  class="w-5 h-5 mt-0.5 shrink-0"
                  :class="item.status === 'todo' && item.tier === 'recommended' ? 'text-gray-400' : STATUS_ICON[item.status].cls"
                  :aria-label="STATUS_ICON[item.status].label"
                />
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium" :class="item.status === 'done' ? 'text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-white'">
                    {{ item.title }}
                  </p>
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{{ item.detail }}</p>
                  <div v-if="item.status !== 'done'" class="flex flex-wrap items-center gap-2 mt-2">
                    <UButton v-if="item.fixUrl" :to="item.fixUrl" size="xs" :color="item.status === 'problem' ? 'error' : 'primary'">
                      {{ item.fixLabel ?? 'Fix this' }}
                    </UButton>
                    <UButton
                      v-if="item.docsAnchor"
                      :to="`${DOCS_URL}#${item.docsAnchor}`"
                      target="_blank"
                      external
                      size="xs"
                      variant="ghost"
                      color="neutral"
                      trailing-icon="i-lucide-external-link"
                    >
                      How to
                    </UButton>
                    <UButton
                      v-if="item.tier === 'recommended' && item.status === 'todo'"
                      size="xs"
                      variant="ghost"
                      color="neutral"
                      :loading="busy"
                      @click="update({ skip: item.id })"
                    >
                      Skip
                    </UButton>
                  </div>
                </div>
              </li>
            </template>
          </ul>
        </template>

        <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap gap-3">
            <UButton v-if="summary!.done" size="xs" variant="link" color="neutral" @click="showDone = !showDone">
              {{ showDone ? 'Hide' : 'Show' }} {{ summary!.done }} done
            </UButton>
            <UButton v-if="skipped.length" size="xs" variant="link" color="neutral" @click="showSkipped = !showSkipped">
              {{ showSkipped ? 'Hide' : 'Show' }} {{ skipped.length }} skipped
            </UButton>
          </div>
          <UButton v-if="allEssentialDone" size="xs" variant="outline" color="neutral" icon="i-lucide-eye-off" :loading="busy" @click="update({ hidden: true })">
            Hide checklist
          </UButton>
        </div>

        <ul v-if="showSkipped && skipped.length" class="mt-2 space-y-1">
          <li v-for="item in skipped" :key="item.id" class="flex items-center justify-between gap-2 text-xs text-gray-500">
            <span>{{ item.title }}</span>
            <UButton size="xs" variant="link" :loading="busy" @click="update({ unskip: item.id })">Undo skip</UButton>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
