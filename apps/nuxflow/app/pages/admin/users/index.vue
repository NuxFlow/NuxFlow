<script setup lang="ts">
import { ASSIGNABLE_ROLES, ROLE_LABELS, type AssignableRole, type Role } from '@nuxflow/db/roles'

definePageMeta({ layout: 'admin', middleware: ['auth'] })

type UserRow = { id: string; name: string; email: string; role: Role; createdAt: string; pending: boolean; invitationExpiresAt?: string }
const { data, refresh } = await useFetch<{ users: UserRow[] }>('/api/v1/users')
const users = computed(() => data.value?.users ?? [])

const { user: currentUser } = useUserSession()
const access = await fetchAdminAccess()
const isSuperAdmin = computed(() => access?.isSuperAdmin ?? false)

const showInvite = ref(false)
const inviteForm = reactive({ name: '', email: '', role: 'viewer' as Role })

const roleOptions: { label: string; value: Role }[] = ASSIGNABLE_ROLES.map(value => ({ label: ROLE_LABELS[value], value }))
// A super admin's row shows its role read-only; it's never something to pick from the list.
const superAdminOptions: { label: string; value: Role }[] = [{ label: ROLE_LABELS.super_admin, value: 'super_admin' }]

// Set when an invite/resend succeeded but its email didn't go out (e.g. the sending domain
// isn't onboarded yet) — the user is still added, so this is a warning, not an error.
const emailWarning = ref('')
type EmailDelivery = { sent: true } | { sent: false; reason: string }
const { run, isRunning, toast } = useAdminAction()
function noteEmailDelivery(email: string, delivery: EmailDelivery | undefined) {
  emailWarning.value = delivery && !delivery.sent ? `The invitation email to ${email} wasn't sent. ${delivery.reason}` : ''
  if (delivery?.sent) toast.add({ title: 'Invitation sent', description: `A fresh link is on its way to ${email}. It works for one hour.`, color: 'success', icon: 'i-lucide-mail-check' })
}
const { confirm } = useConfirm()

async function removeUser(userId: string) {
  const ok = await confirm({
    title: 'Remove this user?',
    description: 'They will lose access to this site immediately.',
    confirmLabel: 'Remove',
  })
  if (!ok) return
  await run(async () => {
    await $fetch<unknown>(`/api/v1/users/${userId}`, { method: 'DELETE' })
    await refresh()
  }, { successTitle: 'User removed', errorTitle: "Couldn't remove user", key: `remove:${userId}` })
}

async function resendInvite(userId: string) {
  const res = await run(
    () => $fetch<{ emailDelivery?: EmailDelivery }>(`/api/v1/users/${userId}/resend-invite`, { method: 'POST' }),
    { errorTitle: "Couldn't resend invite", key: `resend:${userId}` },
  )
  if (res) noteEmailDelivery(users.value.find(u => u.id === userId)?.email ?? 'this user', res.emailDelivery)
}

async function setSuperAdmin(userId: string, grant: boolean) {
  const ok = await confirm(grant
    ? {
        title: 'Grant super admin access?',
        description: 'This user will be able to manage every site in this NuxFlow instance.',
        confirmLabel: 'Grant access',
      }
    : {
        title: 'Revoke super admin access?',
        description: 'This user will be downgraded to admin on this site.',
        confirmLabel: 'Revoke access',
      })
  if (!ok) return
  await run(async () => {
    await $fetch<unknown>(`/api/v1/users/${userId}/super-admin`, { method: grant ? 'POST' : 'DELETE' })
    await refresh()
  }, {
    successTitle: grant ? 'Super admin granted' : 'Super admin revoked',
    errorTitle: grant ? "Couldn't grant super admin" : "Couldn't revoke super admin",
    key: `super-admin:${userId}`,
  })
}

async function invite() {
  const res = await run(
    () => $fetch<{ emailDelivery?: EmailDelivery }>('/api/v1/users', { method: 'POST', body: inviteForm }),
    { errorTitle: "Couldn't invite user", key: 'invite' },
  )
  if (!res) return
  noteEmailDelivery(inviteForm.email, res.emailDelivery)
  showInvite.value = false
  Object.assign(inviteForm, { name: '', email: '', role: 'viewer' })
  await refresh()
}

async function updateRole(userId: string, role: AssignableRole) {
  await run(async () => {
    await $fetch<unknown>(`/api/v1/users/${userId}`, { method: 'PATCH', body: { role } })
    await refresh()
  }, { successTitle: 'Role updated', errorTitle: "Couldn't change role", key: `role:${userId}` })
}

const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'email', header: 'Email' },
  { accessorKey: 'role', header: 'Role' },
  { id: 'status', header: 'Status' },
  { accessorKey: 'createdAt', header: 'Added' },
  { id: 'actions', header: actionsHeader },
]
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-bold text-gray-900 dark:text-white">Users</h1>
      <UButton icon="i-lucide-user-plus" @click="showInvite = true">Invite user</UButton>
    </div>

    <UCard>
      <UTable :data="users" :columns="columns">
        <template #name-cell="{ row }">
          <div class="flex items-center gap-3">
            <UAvatar :alt="row.original.name" size="sm" />
            <span class="font-medium text-gray-900 dark:text-white">{{ row.original.name }}</span>
          </div>
        </template>

        <template #email-cell="{ row }">
          <span class="text-sm text-gray-500 dark:text-gray-400">{{ row.original.email }}</span>
        </template>

        <template #role-cell="{ row }">
          <USelect
            :model-value="row.original.role"
            :items="row.original.role === 'super_admin' ? superAdminOptions : roleOptions"
            size="xs"
            class="min-w-28"
            :disabled="row.original.role === 'super_admin' || row.original.id === currentUser?.id || isRunning(`role:${row.original.id}`)"
            :title="row.original.id === currentUser?.id ? 'You cannot change your own role' : undefined"
            @update:model-value="(val) => updateRole(row.original.id, val as AssignableRole)"
          />
        </template>

        <template #status-cell="{ row }">
          <div v-if="row.original.pending" class="flex flex-col gap-0.5">
            <UBadge color="warning" variant="subtle" size="sm" icon="i-lucide-mail" class="w-fit">Invited</UBadge>
            <span class="text-xs text-gray-400">
              {{ row.original.invitationExpiresAt
                ? `Invitation open until ${formatLocalDate(row.original.invitationExpiresAt)}`
                : "Hasn't accepted yet" }}
            </span>
          </div>
          <UBadge v-else color="success" variant="subtle" size="sm" icon="i-lucide-check" class="w-fit">Active</UBadge>
        </template>

        <template #createdAt-cell="{ row }">
          <span class="text-sm text-gray-400">{{ formatLocalDate(row.original.createdAt) }}</span>
        </template>

        <template #actions-cell="{ row }">
          <div class="flex justify-end items-center gap-1">
            <UButton
              v-if="row.original.pending"
              icon="i-lucide-send"
              variant="soft"
              size="xs"
              title="Email them a fresh invitation link (links expire after one hour)"
              :loading="isRunning(`resend:${row.original.id}`)"
              @click="resendInvite(row.original.id)"
            >
              Resend invite
            </UButton>

            <template v-if="isSuperAdmin && row.original.id !== currentUser?.id">
              <UButton
                v-if="row.original.role !== 'super_admin'"
                icon="i-lucide-shield-plus"
                variant="ghost"
                color="warning"
                size="xs"
                title="Grant super admin"
                :loading="isRunning(`super-admin:${row.original.id}`)"
                @click="setSuperAdmin(row.original.id, true)"
              />
              <UButton
                v-else
                icon="i-lucide-shield-minus"
                variant="ghost"
                color="warning"
                size="xs"
                title="Revoke super admin (downgrades to admin)"
                :loading="isRunning(`super-admin:${row.original.id}`)"
                @click="setSuperAdmin(row.original.id, false)"
              />
            </template>

            <UButton
              v-if="row.original.role !== 'super_admin' && row.original.id !== currentUser?.id"
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              size="xs"
              :loading="isRunning(`remove:${row.original.id}`)"
              @click="removeUser(row.original.id)"
            />
          </div>
        </template>
      </UTable>
    </UCard>

    <UAlert
      v-if="emailWarning"
      icon="i-lucide-mail-warning"
      color="warning"
      variant="soft"
      title="User added, but no email was sent"
      :description="emailWarning"
      close
      @update:open="emailWarning = ''"
    />

    <UModal v-model:open="showInvite" title="Invite user">
      <template #body>
        <div class="space-y-4">
          <UFormField label="Full name" required>
            <UInput v-model="inviteForm.name" placeholder="Jane Smith" autofocus />
          </UFormField>

          <UFormField label="Email address" required>
            <UInput v-model="inviteForm.email" type="email" placeholder="jane@example.com" />
          </UFormField>

          <UFormField label="Role">
            <USelect v-model="inviteForm.role" :items="roleOptions" />
          </UFormField>
        </div>
      </template>

      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton variant="ghost" @click="showInvite = false">Cancel</UButton>
          <UButton
            :loading="isRunning('invite')"
            :disabled="!inviteForm.name || !inviteForm.email"
            @click="invite"
          >
            Send invite
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
