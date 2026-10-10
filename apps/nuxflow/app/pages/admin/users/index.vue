<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

type UserRow = { id: string; name: string; email: string; role: string; createdAt: string; pending: boolean; invitationExpiresAt?: string }
const { data, refresh } = await useFetch<{ users: UserRow[] }>('/api/v1/users')
const users = computed(() => data.value?.users ?? [])

const { user: currentUser } = useUserSession()
const access = await fetchAdminAccess()
const isSuperAdmin = computed(() => access?.isSuperAdmin ?? false)

const showInvite = ref(false)
const inviteForm = reactive({ name: '', email: '', role: 'viewer' as string })
const inviting = ref(false)
const inviteError = ref('')

const removingId = ref<string | null>(null)
const resendingId = ref<string | null>(null)
const superAdminActionId = ref<string | null>(null)
const actionError = ref('')
// Set when an invite/resend succeeded but its email didn't go out (e.g. the sending domain
// isn't onboarded yet) — the user is still added, so this is a warning, not an error.
const emailWarning = ref('')
type EmailDelivery = { sent: true } | { sent: false; reason: string }
const toast = useToast()
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
  removingId.value = userId
  actionError.value = ''
  try {
    await $fetch(`/api/v1/users/${userId}`, { method: 'DELETE' })
    await refresh()
  } catch (e: unknown) {
    actionError.value = getErrorMessage(e, 'Failed to remove user')
  } finally {
    removingId.value = null
  }
}

async function resendInvite(userId: string) {
  resendingId.value = userId
  actionError.value = ''
  try {
    const res = await $fetch<{ emailDelivery?: EmailDelivery }>(`/api/v1/users/${userId}/resend-invite`, { method: 'POST' })
    noteEmailDelivery(users.value.find(u => u.id === userId)?.email ?? 'this user', res.emailDelivery)
  } catch (e: unknown) {
    actionError.value = getErrorMessage(e, 'Failed to resend invite')
  } finally {
    resendingId.value = null
  }
}

async function promoteSuperAdmin(userId: string) {
  const ok = await confirm({
    title: 'Grant super admin access?',
    description: 'This user will be able to manage every site in this NuxFlow instance.',
    confirmLabel: 'Grant access',
  })
  if (!ok) return
  superAdminActionId.value = userId
  actionError.value = ''
  try {
    await $fetch(`/api/v1/users/${userId}/super-admin`, { method: 'POST' })
    await refresh()
  } catch (e: unknown) {
    actionError.value = getErrorMessage(e, 'Failed to grant super admin')
  } finally {
    superAdminActionId.value = null
  }
}

async function revokeSuperAdmin(userId: string) {
  const ok = await confirm({
    title: 'Revoke super admin access?',
    description: 'This user will be downgraded to admin on this site.',
    confirmLabel: 'Revoke access',
  })
  if (!ok) return
  superAdminActionId.value = userId
  actionError.value = ''
  try {
    await $fetch(`/api/v1/users/${userId}/super-admin`, { method: 'DELETE' })
    await refresh()
  } catch (e: unknown) {
    actionError.value = getErrorMessage(e, 'Failed to revoke super admin')
  } finally {
    superAdminActionId.value = null
  }
}

const roleOptions = [
  { label: 'Admin', value: 'admin' },
  { label: 'Editor', value: 'editor' },
  { label: 'Author', value: 'author' },
  { label: 'Viewer', value: 'viewer' },
  { label: 'Member', value: 'member' },
]

async function invite() {
  inviteError.value = ''
  inviting.value = true
  try {
    const res = await $fetch<{ emailDelivery?: EmailDelivery }>('/api/v1/users', { method: 'POST', body: inviteForm })
    noteEmailDelivery(inviteForm.email, res.emailDelivery)
    showInvite.value = false
    inviteForm.name = ''
    inviteForm.email = ''
    inviteForm.role = 'viewer'
    await refresh()
  } catch (e: unknown) {
    inviteError.value = getErrorMessage(e, 'Failed to invite user')
  } finally {
    inviting.value = false
  }
}

async function updateRole(userId: string, role: string) {
  await $fetch(`/api/v1/users/${userId}`, { method: 'PATCH', body: { role } })
  await refresh()
}

const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'email', header: 'Email' },
  { accessorKey: 'role', header: 'Role' },
  { id: 'status', header: 'Status' },
  { accessorKey: 'createdAt', header: 'Added' },
  { id: 'actions', header: '' },
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
            :items="roleOptions"
            size="xs"
            class="min-w-28"
            :disabled="row.original.role === 'super_admin' || row.original.id === currentUser?.id"
            :title="row.original.id === currentUser?.id ? 'You cannot change your own role' : undefined"
            @update:model-value="(val) => updateRole(row.original.id, val as string)"
          />
        </template>

        <template #status-cell="{ row }">
          <div v-if="row.original.pending" class="flex flex-col gap-0.5">
            <UBadge color="warning" variant="subtle" size="sm" icon="i-lucide-mail" class="w-fit">Invited</UBadge>
            <span class="text-xs text-gray-400">
              {{ row.original.invitationExpiresAt
                ? `Invitation open until ${new Date(row.original.invitationExpiresAt).toLocaleDateString()}`
                : "Hasn't accepted yet" }}
            </span>
          </div>
          <UBadge v-else color="success" variant="subtle" size="sm" icon="i-lucide-check" class="w-fit">Active</UBadge>
        </template>

        <template #createdAt-cell="{ row }">
          <span class="text-sm text-gray-400">{{ new Date(row.original.createdAt).toLocaleDateString() }}</span>
        </template>

        <template #actions-cell="{ row }">
          <div class="flex justify-end items-center gap-1">
            <UButton
              v-if="row.original.pending"
              icon="i-lucide-send"
              variant="soft"
              size="xs"
              title="Email them a fresh invitation link (links expire after one hour)"
              :loading="resendingId === row.original.id"
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
                :loading="superAdminActionId === row.original.id"
                @click="promoteSuperAdmin(row.original.id)"
              />
              <UButton
                v-else
                icon="i-lucide-shield-minus"
                variant="ghost"
                color="warning"
                size="xs"
                title="Revoke super admin (downgrades to admin)"
                :loading="superAdminActionId === row.original.id"
                @click="revokeSuperAdmin(row.original.id)"
              />
            </template>

            <UButton
              v-if="row.original.role !== 'super_admin' && row.original.id !== currentUser?.id"
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              size="xs"
              :loading="removingId === row.original.id"
              @click="removeUser(row.original.id)"
            />
          </div>
        </template>
      </UTable>
    </UCard>

    <UAlert v-if="actionError" icon="i-lucide-circle-x" color="error" variant="soft" :description="actionError" />
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

          <p v-if="inviteError" class="text-sm text-red-500">{{ inviteError }}</p>
        </div>
      </template>

      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton variant="ghost" @click="showInvite = false">Cancel</UButton>
          <UButton
            :loading="inviting"
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
