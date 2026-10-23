<script setup lang="ts">
import type { SiteMoveRow } from '~/components/admin/SiteMoveModal.vue'

definePageMeta({ layout: 'admin', middleware: ['auth'] })

// poolId: the member pool the site lives in (null = this control panel's own).
// moving: locked while being moved to another pool (Move, below).
type SiteRow = { id: string; name: string; domain: string; status: string; locale?: string; hostingPlanId: string | null; createdAt: string; poolId: string | null; moving?: boolean }
const { data, refresh } = await useFetch<{ sites: SiteRow[]; pools: string[]; unreachablePools: string[] }>('/api/v1/admin/sites')
const showPools = computed(() => (data.value?.pools.length ?? 0) > 0 || (data.value?.sites ?? []).some(s => s.poolId))
// Plans only exist while Super Admin → Platform's hosting switch is on (the API 404s otherwise).
const hostingPlatform = (await fetchAdminAccess())?.hostingPlatform ?? false
const { data: planData } = await useFetch<{ plans: { id: string; name: string }[] }>('/api/v1/admin/plans', { immediate: hostingPlatform })

// The select can't hold null, so the built-in unlimited plan is this sentinel in the form.
const UNLIMITED = 'unlimited'
const planItems = computed(() => [
  { label: 'Unlimited (built-in)', value: UNLIMITED },
  ...(planData.value?.plans ?? []).map(p => ({ label: p.name, value: p.id })),
])
// Moving a site between pools (AdminSiteMoveModal). Only with pools, which need the hosting switch.
const { data: moveData, refresh: refreshMoves } = await useFetch<{ moves: SiteMoveRow[] }>('/api/v1/admin/site-moves', { immediate: hostingPlatform })
const canMove = computed(() => hostingPlatform && (data.value?.pools.length ?? 0) > 0)
const unfinishedMoves = computed(() => (moveData.value?.moves ?? []).filter(m => !['done', 'cancelled'].includes(m.phase)))
const MOVE_FAILED_TEXT = "The copy didn't match, so nothing was switched. Open it to cancel the move."
const MOVE_PAUSED_TEXT = "The site is locked until the move finishes or is cancelled. Open it to continue."
const isMoveOpen = ref(false)
const moveSite = ref<SiteRow | null>(null)
const resumeMove = ref<SiteMoveRow | null>(null)
function openMove(site: SiteRow) {
  moveSite.value = site
  resumeMove.value = null
  isMoveOpen.value = true
}
function continueMove(move: SiteMoveRow) {
  moveSite.value = null
  resumeMove.value = move
  isMoveOpen.value = true
}
async function afterMoveChange() {
  await Promise.all([refresh(), refreshMoves()])
}

const planName = (id: string | null) => (id && planData.value?.plans.find(p => p.id === id)?.name) || 'Unlimited'

// useRequestURL() is the same on the server and in the browser. Reading window.location
// only in the browser left it blank in the server render, so the current site's delete
// button was rendered enabled and hydration never corrected it (the API still refuses).
const currentDomain = useRequestURL().hostname
const isCurrentSite = (site: SiteRow) => site.domain === currentDomain
const items = computed(() => data.value?.sites ?? [])

type Color = 'success' | 'warning' | 'error' | 'primary' | 'neutral'
const statusColor: Record<string, Color> = { active: 'success', maintenance: 'warning', suspended: 'error' }

const columns = computed(() => [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'domain', header: 'Domain' },
  ...(showPools.value ? [{ accessorKey: 'poolId', header: 'Pool' }] : []),
  { accessorKey: 'status', header: 'Status' },
  ...(hostingPlatform ? [{ accessorKey: 'hostingPlanId', header: 'Plan' }] : []),
  { accessorKey: 'createdAt', header: 'Created' },
  { id: 'actions', header: actionsHeader },
])

// Modal & Form States
const isEditOpen = ref(false)
const selectedSite = ref<SiteRow | null>(null)
const editForm = reactive({
  id: '',
  name: '',
  domain: '',
  status: 'active' as 'active' | 'maintenance' | 'suspended',
  locale: 'en',
  hostingPlanId: UNLIMITED,
})

const isDeleteOpen = ref(false)
const deleteConfirmText = ref('')
const deleting = ref(false)

const saving = ref(false)
const saveError = ref('')

function openEdit(site: SiteRow) {
  selectedSite.value = site
  editForm.id = site.id
  editForm.name = site.name
  editForm.domain = site.domain
  editForm.status = site.status as 'active' | 'maintenance' | 'suspended'
  editForm.locale = site.locale || 'en'
  editForm.hostingPlanId = site.hostingPlanId ?? UNLIMITED
  saveError.value = ''
  isEditOpen.value = true
}

function openDelete(site: SiteRow) {
  selectedSite.value = site
  deleteConfirmText.value = ''
  isDeleteOpen.value = true
}

async function saveSite() {
  saving.value = true
  saveError.value = ''
  try {
    await $fetch(`/api/v1/admin/sites/${editForm.id}`, {
      method: 'PATCH',
      body: {
        name: editForm.name,
        domain: editForm.domain,
        status: editForm.status,
        locale: editForm.locale,
        // Left out while the switch is off, so a site keeps its plan for when it's back on.
        ...(hostingPlatform ? { hostingPlanId: editForm.hostingPlanId === UNLIMITED ? null : editForm.hostingPlanId } : {}),
      },
    })
    isEditOpen.value = false
    await refresh()
  } catch (e: unknown) {
    saveError.value = getErrorMessage(e, 'Failed to save site')
  } finally {
    saving.value = false
  }
}

async function deleteSite() {
  if (!selectedSite.value) return
  deleting.value = true
  try {
    await $fetch(`/api/v1/admin/sites/${selectedSite.value.id}`, {
      method: 'DELETE',
    })
    isDeleteOpen.value = false
    await refresh()
  } catch (e: unknown) {
    alert(getErrorMessage(e, 'Failed to delete site'))
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-bold text-gray-900 dark:text-white">All sites</h1>
      <UButton to="/admin/super/sites/new" icon="i-lucide-plus">New site</UButton>
    </div>

    <UAlert
      v-if="data?.unreachablePools.length"
      color="warning"
      variant="soft"
      icon="i-lucide-triangle-alert"
      :description="`Couldn't reach ${data.unreachablePools.join(', ')}, so their sites aren't listed. See Super Admin → Pools.`"
    />

    <UAlert
      v-for="m in unfinishedMoves"
      :key="m.id"
      :color="m.phase === 'failed' ? 'error' : 'warning'"
      variant="soft"
      icon="i-lucide-arrow-right-left"
      :title="`Moving ${m.siteDomain} hasn't finished`"
      :description="m.phase === 'failed' ? MOVE_FAILED_TEXT : MOVE_PAUSED_TEXT"
      :actions="[{ label: 'Open', onClick: () => continueMove(m) }]"
    />

    <UCard>
      <UTable :data="items" :columns="columns">
        <template #poolId-cell="{ row }">
          <span class="text-sm" :class="row.original.poolId ? 'text-gray-900 dark:text-white' : 'text-gray-400'">{{ row.original.poolId ?? 'This control panel' }}</span>
        </template>
        <template #domain-cell="{ row }">
          <a :href="`https://${row.original.domain}`" target="_blank" class="text-primary-500 hover:underline text-sm">{{ row.original.domain }}</a>
        </template>
        <template #status-cell="{ row }">
          <div class="flex items-center gap-1">
            <UBadge :color="statusColor[row.original.status] ?? 'neutral'" variant="soft" size="xs" class="capitalize">{{ row.original.status }}</UBadge>
            <UBadge v-if="row.original.moving" color="warning" variant="soft" size="xs">Moving</UBadge>
          </div>
        </template>
        <template #hostingPlanId-cell="{ row }">
          <span class="text-sm" :class="row.original.hostingPlanId ? 'text-gray-900 dark:text-white' : 'text-gray-400'">{{ planName(row.original.hostingPlanId) }}</span>
        </template>
        <template #createdAt-cell="{ row }">
          <span class="text-sm text-gray-400">{{ formatLocalDate(row.original.createdAt) }}</span>
        </template>
        <template #actions-cell="{ row }">
          <div class="flex items-center gap-1.5">
            <UButton variant="ghost" size="xs" icon="i-lucide-pencil" :aria-label="`Edit ${row.original.name}`" @click="openEdit(row.original)" />
            <UButton
              v-if="canMove"
              variant="ghost"
              size="xs"
              icon="i-lucide-arrow-right-left"
              :title="isCurrentSite(row.original) ? 'The site you are signed in to cannot be moved' : row.original.moving ? 'Already being moved' : `Move ${row.original.name} to another pool`"
              :aria-label="`Move ${row.original.name}`"
              :disabled="isCurrentSite(row.original) || row.original.moving"
              @click="openMove(row.original)"
            />
            <!-- A plain title attribute rather than <UTooltip> (which needs the <UApp> root in app.vue). -->
            <UButton
              variant="ghost"
              color="error"
              size="xs"
              icon="i-lucide-trash-2"
              :title="isCurrentSite(row.original) ? 'The site you are signed in to cannot be deleted' : `Delete ${row.original.name}`"
              :aria-label="`Delete ${row.original.name}`"
              :disabled="isCurrentSite(row.original)"
              @click="openDelete(row.original)"
            />
          </div>
        </template>
      </UTable>
    </UCard>

    <!-- Edit Site Modal -->
    <UModal v-model:open="isEditOpen" title="Edit Site">
      <template #body>
        <div class="space-y-4">
          <UFormField label="Site name" required>
            <UInput v-model="editForm.name" />
          </UFormField>
          <UFormField label="Domain" required>
            <UInput v-model="editForm.domain" />
          </UFormField>
          <UFormField label="Default locale">
            <UInput v-model="editForm.locale" />
          </UFormField>
          <UFormField label="Status">
            <USelect
              v-model="editForm.status"
              :items="[
                { label: 'Active', value: 'active' },
                { label: 'Maintenance', value: 'maintenance' },
                { label: 'Suspended', value: 'suspended' }
              ]"
            />
          </UFormField>
          <UFormField v-if="hostingPlatform" label="Hosting plan" help="Limits apply within a minute. Manage plans in Super Admin → Plans.">
            <USelect v-model="editForm.hostingPlanId" :items="planItems" class="w-full" />
          </UFormField>
          <UAlert v-if="saveError" color="error" variant="soft" :description="saveError" />
        </div>
      </template>
      <template #footer>
        <UButton variant="ghost" @click="isEditOpen = false">Cancel</UButton>
        <UButton :loading="saving" :disabled="!editForm.name || !editForm.domain" @click="saveSite">Save changes</UButton>
      </template>
    </UModal>

    <AdminSiteMoveModal v-model:open="isMoveOpen" :site="moveSite" :pools="data?.pools ?? []" :resume="resumeMove" @changed="afterMoveChange" />

    <!-- Delete Site Modal -->
    <UModal v-model:open="isDeleteOpen" title="Delete Site">
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-gray-500">
            Are you absolutely sure you want to delete <strong class="text-gray-900 dark:text-white">{{ selectedSite?.name }}</strong>?
          </p>
          <p class="text-sm text-red-500 font-medium">
            Warning: This action is permanent and will delete all site pages, settings, media, and local users.
          </p>
          <div class="space-y-2">
            <label class="text-xs text-gray-400">Type the domain <strong class="text-gray-700 dark:text-gray-300">{{ selectedSite?.domain }}</strong> to confirm:</label>
            <UInput v-model="deleteConfirmText" :placeholder="selectedSite?.domain" />
          </div>
        </div>
      </template>
      <template #footer>
        <UButton variant="ghost" @click="isDeleteOpen = false">Cancel</UButton>
        <UButton
          color="error"
          variant="solid"
          class="!bg-red-600 hover:!bg-red-700 !text-white font-semibold shadow-sm transition-colors cursor-pointer"
          :loading="deleting"
          :disabled="deleteConfirmText !== selectedSite?.domain"
          @click="deleteSite"
        >
          Delete permanently
        </UButton>
      </template>
    </UModal>
  </div>
</template>
